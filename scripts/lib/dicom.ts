// Reading a scan from its DICOM files, through dicom-parser: the head's CAT and its MRI, one gzipped file a slice.
// A series becomes one grid of voxels with its place in the scanner's patient frame, the slices ordered by where they
// lie along the scan rather than by their file names.
//
// The patient frame is DICOM's, in millimetres: x toward the patient's left, y toward the back, z toward the head.
// Voxel (i, j, k), i along an image's columns, j down its rows and k from slice to slice, has its centre at
//
//   origin + i · spacing[0] · orientation[0] + j · spacing[1] · orientation[1] + k · spacing[2] · orientation[2]

import dicomParser from 'dicom-parser'
import type { Triple } from '../../src/volume/format.ts'
import { requireDataFile, setFolder } from './data.ts'
import { gunzipFile } from './decode.ts'
import { setNames } from './sets.ts'

export interface DicomVolume {
  // CT or MR, and the scanner's own description of the series, where it gives one
  modality: string
  description: string
  // Columns, rows and slices
  size: Triple
  // Millimetres between voxel centres along i, j and k
  spacing: Triple
  // The centre of voxel (0, 0, 0) in the patient frame
  origin: Triple
  // The patient-frame directions of i, j and k, each a unit vector; k is the slices' normal, toward the later slices
  orientation: readonly [Triple, Triple, Triple]
  // How the patient lay, as HFS for head first and supine
  position: string
  // The frame of reference the positions are given in: two scans share a frame only where these match
  frameUID: string
  // The values in index order, i + nx·(j + ny·k), each the stored value through the file's rescale: Hounsfield units
  // for a CT, by the scanner's own scale, and the scanner's intensity for an MRI
  voxels: Int16Array | Uint16Array
  // The layers the series has no file for, by their k: their values are their neighbours', mixed by distance
  absent: readonly number[]
  // The stored-value rescale the files give, the same in every slice: value = stored · slope + intercept
  rescale: { slope: number; intercept: number }
}

// Tags, as dicom-parser names them
const tag = {
  modality: 'x00080060',
  description: 'x0008103e',
  patientPosition: 'x00185100',
  imagePosition: 'x00200032',
  imageOrientation: 'x00200037',
  frameUID: 'x00200052',
  samples: 'x00280002',
  rows: 'x00280010',
  columns: 'x00280011',
  pixelSpacing: 'x00280030',
  bitsAllocated: 'x00280100',
  signed: 'x00280103',
  intercept: 'x00281052',
  slope: 'x00281053',
  pixelData: 'x7fe00010',
}

const dot = (a: Triple, b: Triple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Triple, b: Triple): Triple => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// Positions and directions agree between slices to this many millimetres, or this much of a unit vector
const geometryTolerance = 0.01
// A gap between slices is a whole number of steps to within this share of a step
const stepTolerance = 0.02

// One file's slice: its geometry and its stored values
export interface DicomSlice {
  name: string
  modality: string
  description: string
  columns: number
  rows: number
  // Millimetres between columns and between rows
  pixel: readonly [number, number]
  position: Triple
  across: Triple
  down: Triple
  patientPosition: string
  frameUID: string
  slope: number
  intercept: number
  signed: boolean
  // The stored values, 16 bits each, little-endian, as the file holds them
  pixels: Uint8Array
}

// One slice from a DICOM file's bytes, gzip already undone; name is the file's, for the errors
export function parseDicomSlice(name: string, bytes: Uint8Array): DicomSlice {
  const data = dicomParser.parseDicom(bytes)
  const fail = (what: string): never => {
    throw new Error(`${name}: ${what}`)
  }
  const numbers = (key: string, count: number) => {
    const values: number[] = []
    for (let n = 0; n < count; n++) {
      const value = data.floatString(key, n)
      if (value === undefined || !Number.isFinite(value)) return fail(`no ${count} numbers under ${key}`)
      values.push(value)
    }
    return values
  }
  const whole = (key: string) => data.uint16(key) ?? fail(`no number under ${key}`)
  if (whole(tag.samples) !== 1 || whole(tag.bitsAllocated) !== 16) {
    return fail(`${whole(tag.samples)} sample(s) of ${whole(tag.bitsAllocated)} bits a pixel, where a scan slice has one of 16`)
  }
  const columns = whole(tag.columns)
  const rows = whole(tag.rows)
  const element = data.elements[tag.pixelData]
  if (!element || element.encapsulatedPixelData) return fail('its pixels are missing or compressed')
  if (element.length !== columns * rows * 2) return fail(`${element.length} bytes of pixels for ${columns} × ${rows}`)
  // PixelSpacing gives the rows' spacing first, then the columns'
  const [betweenRows, betweenColumns] = numbers(tag.pixelSpacing, 2)
  const [px, py, pz] = numbers(tag.imagePosition, 3)
  const [ax, ay, az, dx, dy, dz] = numbers(tag.imageOrientation, 6)
  return {
    name,
    modality: data.string(tag.modality) ?? '',
    description: data.string(tag.description) ?? '',
    columns,
    rows,
    pixel: [betweenColumns, betweenRows],
    position: [px, py, pz],
    across: [ax, ay, az],
    down: [dx, dy, dz],
    patientPosition: data.string(tag.patientPosition) ?? '',
    frameUID: data.string(tag.frameUID) ?? fail('no frame of reference'),
    slope: data.floatString(tag.slope) ?? 1,
    intercept: data.floatString(tag.intercept) ?? 0,
    signed: whole(tag.signed) === 1,
    pixels: bytes.subarray(element.dataOffset, element.dataOffset + element.length),
  }
}

// A series' slices as one grid. The slices are ordered along their normal, the direction across an image crossed
// with the direction down it, so k runs that way whatever order they come in; every slice must share the first's
// size, pixel spacing, directions, frame and rescale, and sit a whole number of steps from the last, or the series
// isn't one grid and this stops. `folder` names the series in the errors
export function assembleSeries(unordered: readonly DicomSlice[], folder: string): DicomVolume {
  if (unordered.length === 0) throw new Error(`${folder} holds no DICOM files`)
  const normal = cross(unordered[0].across, unordered[0].down)
  const along = (slice: DicomSlice) => dot(slice.position, normal)
  const slices = unordered.toSorted((a, b) => along(a) - along(b))
  const base = slices[0]
  const near = (a: number, b: number) => Math.abs(a - b) <= geometryTolerance
  for (const slice of slices) {
    const same =
      slice.columns === base.columns &&
      slice.rows === base.rows &&
      slice.modality === base.modality &&
      slice.frameUID === base.frameUID &&
      slice.slope === base.slope &&
      slice.intercept === base.intercept &&
      slice.signed === base.signed &&
      slice.pixel.every((value, n) => near(value, base.pixel[n])) &&
      slice.across.every((value, n) => near(value, base.across[n])) &&
      slice.down.every((value, n) => near(value, base.down[n]))
    if (!same) throw new Error(`${folder}: ${slice.name} isn't a slice of the grid ${base.name} starts`)
    // A slice's corner lies on the line through the first's corner along the normal
    const offset = along(slice) - along(base)
    const expected = base.position.map((value, n) => value + offset * normal[n])
    if (!slice.position.every((value, n) => Math.abs(value - expected[n]) <= 10 * geometryTolerance)) {
      throw new Error(`${folder}: ${slice.name} is shifted across the scan from ${base.name}`)
    }
  }
  // The slices sit on a lattice along the normal, a step apart: the middle one of the gaps between neighbours. A gap
  // of several steps means the series lacks the slices between, as the head's CAT does three near the crown
  const gaps = slices.slice(1).map((slice, n) => along(slice) - along(slices[n]))
  const usual = gaps.length > 0 ? gaps.toSorted((a, b) => a - b)[Math.floor(gaps.length / 2)] : 1
  if (!(usual > 0)) throw new Error(`${folder}: two slices share a position`)
  // Each slice's layer on the lattice
  const layers = [0]
  gaps.forEach((gap, n) => {
    const steps = Math.round(gap / usual)
    if (steps < 1 || Math.abs(gap - steps * usual) > stepTolerance * usual) {
      throw new Error(`${folder}: ${slices[n].name} and ${slices[n + 1].name} are ${gap.toFixed(3)} mm apart, not a multiple of the series' ${usual.toFixed(3)}`)
    }
    layers.push(layers[n] + steps)
  })
  const count = layers[layers.length - 1] + 1
  const step = count > 1 ? (along(slices[slices.length - 1]) - along(base)) / (count - 1) : usual

  const { columns, rows, slope, intercept } = base
  const layer = columns * rows
  // A CT's values run below zero once rescaled; an MRI's don't
  const voxels = intercept < 0 || base.signed ? new Int16Array(layer * count) : new Uint16Array(layer * count)
  const [low, high] = voxels instanceof Int16Array ? [-32768, 32767] : [0, 65535]
  slices.forEach((slice, n) => {
    const view = new DataView(slice.pixels.buffer, slice.pixels.byteOffset, slice.pixels.byteLength)
    const at = layers[n] * layer
    for (let p = 0; p < layer; p++) {
      const stored = slice.signed ? view.getInt16(p * 2, true) : view.getUint16(p * 2, true)
      voxels[at + p] = Math.max(low, Math.min(high, Math.round(stored * slope + intercept)))
    }
  })
  // A layer with no slice lies between two that have one, and takes their values in proportion to its distance
  const absent: number[] = []
  for (let n = 1; n < slices.length; n++) {
    const below = layers[n - 1]
    const above = layers[n]
    for (let k = below + 1; k < above; k++) {
      absent.push(k)
      const t = (k - below) / (above - below)
      for (let p = 0; p < layer; p++) {
        voxels[k * layer + p] = Math.round((1 - t) * voxels[below * layer + p] + t * voxels[above * layer + p])
      }
    }
  }
  return {
    modality: base.modality,
    description: base.description,
    size: [columns, rows, count],
    spacing: [base.pixel[0], base.pixel[1], step],
    origin: base.position,
    orientation: [base.across, base.down, normal],
    position: base.patientPosition,
    frameUID: base.frameUID,
    voxels,
    absent,
    rescale: { slope, intercept },
  }
}

// A set of the data root as one series, every file of it one gzipped slice. The files are the set's by name, so that
// one missing from the local copy stops the read and says how to fetch it, where a folder's listing would leave a gap
// that reads like the layers a series really lacks, and a download left half done isn't taken for a slice
export async function readDicomSeries(root: string, id: string): Promise<DicomVolume> {
  const slices: DicomSlice[] = []
  for (const name of setNames(id)) slices.push(parseDicomSlice(name, await gunzipFile(await requireDataFile(root, id, name))))
  return assembleSeries(slices, setFolder(root, id))
}
