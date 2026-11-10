// The fit that places a whole scan on another grid by a rigid transform: the head's CAT on its photographs' grid,
// and its MRI on the CAT. Nothing here reads a file; the register script hands in the grids.
//
// The CAT is scored against the photographs two ways, summed. Bone: the share of the CAT's bone, sampled every two
// millimetres, that lands on pale tissue in the photographs. The fixed head's bone, scalp, fat and white matter are
// all pale, so what this term holds is the skull off the grey matter inside it and the muscle around the jaw. Body:
// the Dice overlap of the two heads' silhouettes, the CAT's sampled every four millimetres, counted where the
// photographs' grid reaches. The MRI is scored against the CAT by the mutual information of their values, since
// no tissue reads alike in the two.
//
// The search is the same for both: from a start, each of the six numbers is tried a step up and a step down, the best
// of the twelve is taken, and that repeats until none improves; then the steps shrink. It stays within a range of the
// start, so a start in the wrong basin ends with a low score instead of wandering

import type { Triple, Volume } from '../../src/volume/format.ts'
import { isBodyVoxel } from '../../src/volume/format.ts'
import {
  addPoint,
  emptyMoments,
  mapAbout,
  multiply,
  principalFrame,
  rotationMatrix,
  type Mat3,
  type PrincipalFrame,
  type RigidMap,
  type Vec3,
} from '../../src/volume/rigid.ts'
import type { DicomVolume } from './dicom.ts'

// The head's pale tissue, the look of its bone: the channels' spread at most this share of the brightest, and a
// luminance of at least this. Measured on patches of the head's slices: bone, scalp, fat and white matter spread
// 0.22–0.27 of their brightest channel whatever the lighting, grey matter and muscle 0.30–0.45. The male's rule,
// by luminance and saturation, calls nearly all of the fixed head pale
const headPaleSpread = 0.27
const headPaleLuminance = 100

// The CAT's head and its bone, in Hounsfield units
const headHounsfield = -300
export const boneHounsfield = 300

// The CAT's bone is sampled every this many voxels across a slice and every this many slices, about 2 mm each way,
// and its silhouette at twice that
const boneStep: readonly [number, number] = [4, 4]
const bodyStep: readonly [number, number] = [8, 8]
// A fit that leaves fewer than this share of the CAT's bone inside the photographs' grid scores nothing
const minInside = 0.5

// The photographs' grid as a target: a byte a voxel, bit 0 for body and bit 1 for pale, with the grid's geometry
export interface CryoTarget {
  size: Triple
  spacing: Triple
  origin: Triple
  flags: Uint8Array
  // The grid's centre and the body's centre and principal axes, in the grid's frame, millimetres
  centre: Vec3
  frame: PrincipalFrame
}

const bodyFlag = 1
const paleFlag = 2

// The target the CAT is fitted to. Mirrored, the grid's columns are taken in reverse, which is the head as it would
// be if the photographs showed it the other way round
export function cryoTarget(volume: Volume, mirrored: boolean): CryoTarget {
  const { size, spacing, origin, red, green, blue, coverage } = volume
  const [nx, ny, nz] = size
  const flags = new Uint8Array(nx * ny * nz)
  const moments = emptyMoments()
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const from = i + nx * (j + ny * k)
        if (!isBodyVoxel(coverage[from])) continue
        const column = mirrored ? nx - 1 - i : i
        const r = red[from]
        const g = green[from]
        const b = blue[from]
        const max = Math.max(r, g, b)
        const pale = max - Math.min(r, g, b) <= headPaleSpread * max && 0.299 * r + 0.587 * g + 0.114 * b >= headPaleLuminance
        flags[column + nx * (j + ny * k)] = pale ? bodyFlag | paleFlag : bodyFlag
        addPoint(moments, origin[0] + column * spacing[0], origin[1] + j * spacing[1], origin[2] + k * spacing[2])
      }
    }
  }
  const centre: Vec3 = [
    origin[0] + ((nx - 1) / 2) * spacing[0],
    origin[1] + ((ny - 1) / 2) * spacing[1],
    origin[2] + ((nz - 1) / 2) * spacing[2],
  ]
  return { size, spacing, origin, flags, centre, frame: principalFrame(moments) }
}

// A scan's voxel centre in its patient frame
export function scanPoint(scan: DicomVolume, i: number, j: number, k: number): Vec3 {
  const { origin, spacing, orientation } = scan
  const [a, b, c] = orientation
  return [
    origin[0] + i * spacing[0] * a[0] + j * spacing[1] * b[0] + k * spacing[2] * c[0],
    origin[1] + i * spacing[0] * a[1] + j * spacing[1] * b[1] + k * spacing[2] * c[1],
    origin[2] + i * spacing[0] * a[2] + j * spacing[1] * b[2] + k * spacing[2] * c[2],
  ]
}

// The centre of a scan's grid, in its patient frame
export const scanCentre = (scan: DicomVolume): Vec3 =>
  scanPoint(scan, (scan.size[0] - 1) / 2, (scan.size[1] - 1) / 2, (scan.size[2] - 1) / 2)

// A scan's value at a point of its patient frame, between its voxels, or `outside` where the point is off the grid
export function sampleScan(scan: DicomVolume, [x, y, z]: Vec3, outside: number) {
  const { origin, spacing, orientation, size, voxels } = scan
  const [nx, ny, nz] = size
  const dx = x - origin[0]
  const dy = y - origin[1]
  const dz = z - origin[2]
  const fi = (dx * orientation[0][0] + dy * orientation[0][1] + dz * orientation[0][2]) / spacing[0]
  const fj = (dx * orientation[1][0] + dy * orientation[1][1] + dz * orientation[1][2]) / spacing[1]
  const fk = (dx * orientation[2][0] + dy * orientation[2][1] + dz * orientation[2][2]) / spacing[2]
  if (fi < 0 || fj < 0 || fk < 0 || fi > nx - 1 || fj > ny - 1 || fk > nz - 1) return outside
  const i0 = Math.min(nx - 2, Math.floor(fi))
  const j0 = Math.min(ny - 2, Math.floor(fj))
  const k0 = Math.min(nz - 2, Math.floor(fk))
  const ti = fi - i0
  const tj = fj - j0
  const tk = fk - k0
  const at = i0 + nx * (j0 + ny * k0)
  const layer = nx * ny
  const row = (base: number) => voxels[base] * (1 - ti) + voxels[base + 1] * ti
  const plane = (base: number) => row(base) * (1 - tj) + row(base + nx) * tj
  return plane(at) * (1 - tk) + plane(at + layer) * tk
}

// The map from a frame of millimetres into a scan's voxel indices, as fractions of a voxel, given the rigid map from
// that frame into the scan's patient frame: index = rows · point + offset, a row for each of i, j and k
interface IndexMap {
  rows: Mat3
  offset: Vec3
}

export function indexMap(scan: DicomVolume, toScan: RigidMap): IndexMap {
  const { origin, spacing, orientation } = scan
  const row = (n: 0 | 1 | 2): Vec3 => {
    const [x, y, z] = orientation[n]
    const m = toScan.matrix
    return [
      (x * m[0][0] + y * m[1][0] + z * m[2][0]) / spacing[n],
      (x * m[0][1] + y * m[1][1] + z * m[2][1]) / spacing[n],
      (x * m[0][2] + y * m[1][2] + z * m[2][2]) / spacing[n],
    ]
  }
  const shift = (n: 0 | 1 | 2) => {
    const [x, y, z] = orientation[n]
    const t = toScan.offset
    return (x * (t[0] - origin[0]) + y * (t[1] - origin[1]) + z * (t[2] - origin[2])) / spacing[n]
  }
  return { rows: [row(0), row(1), row(2)], offset: [shift(0), shift(1), shift(2)] }
}

// A scan's value at fractional voxel indices, between its voxels, or NaN off the grid. Where a floor is given, a
// value taken from any voxel below it is NaN too, as off the scan: the CT's padding outside its reconstruction
// circle, which mixed into a sample at the circle's edge would pull it far below the tissue it lies in
export function sampleIndex(scan: DicomVolume, fi: number, fj: number, fk: number, floor = -Infinity) {
  const [nx, ny, nz] = scan.size
  if (!(fi >= 0 && fj >= 0 && fk >= 0 && fi <= nx - 1 && fj <= ny - 1 && fk <= nz - 1)) return NaN
  const { voxels } = scan
  const i0 = Math.min(nx - 2, Math.floor(fi))
  const j0 = Math.min(ny - 2, Math.floor(fj))
  const k0 = Math.min(nz - 2, Math.floor(fk))
  const ti = fi - i0
  const tj = fj - j0
  const tk = fk - k0
  const at = i0 + nx * (j0 + ny * k0)
  const up = at + nx * ny
  for (const corner of [at, at + 1, at + nx, at + nx + 1, up, up + 1, up + nx, up + nx + 1]) {
    if (voxels[corner] < floor) return NaN
  }
  const near = (voxels[at] * (1 - ti) + voxels[at + 1] * ti) * (1 - tj) + (voxels[at + nx] * (1 - ti) + voxels[at + nx + 1] * ti) * tj
  const far = (voxels[up] * (1 - ti) + voxels[up + 1] * ti) * (1 - tj) + (voxels[up + nx] * (1 - ti) + voxels[up + nx + 1] * ti) * tj
  return near * (1 - tk) + far * tk
}

// The CAT as the points the fit maps: its bone, and a coarser lattice of all its voxels with which are head, each in
// the patient frame; and the head's centre and principal axes. The head is the scan from its crown down as far as the
// photographs' stack runs, since the scan goes on down the neck, which would tilt its axes
export interface CatPoints {
  bone: Float32Array
  lattice: Float32Array
  // A byte a lattice point, 1 where the CAT shows head
  head: Uint8Array
  frame: PrincipalFrame
}

export function catPoints(cat: DicomVolume, hounsfieldScale: number, stackMm: number): CatPoints {
  const [nx, ny, nz] = cat.size
  const { voxels } = cat
  const headFrom = headHounsfield / hounsfieldScale
  const boneFrom = boneHounsfield / hounsfieldScale
  // The topmost slice with a patch of head, then down the length of the stack. k rises toward the head where the
  // slices' normal points up the patient, and falls where it points down
  const up = cat.orientation[2][2] >= 0
  const slicesOfStack = Math.round(stackMm / cat.spacing[2])
  // A slice holds head when this many of its voxels, sampled every fourth each way, are: about 3 cm² of it
  const patch = 80
  const holdsHead = (k: number) => {
    let count = 0
    for (let j = 0; j < ny; j += 4) for (let i = 0; i < nx; i += 4) if (voxels[i + nx * (j + ny * k)] >= headFrom) count++
    return count >= patch
  }
  let crown = up ? nz - 1 : 0
  while (!holdsHead(crown) && (up ? crown > 0 : crown < nz - 1)) crown += up ? -1 : 1
  const [kLow, kHigh] = up ? [Math.max(0, crown - slicesOfStack), crown] : [crown, Math.min(nz - 1, crown + slicesOfStack)]

  const bone: number[] = []
  const lattice: number[] = []
  const head: number[] = []
  const moments = emptyMoments()
  for (let k = kLow; k <= kHigh; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const value = voxels[i + nx * (j + ny * k)]
        const onBone = k % boneStep[1] === 0 && j % boneStep[0] === 0 && i % boneStep[0] === 0
        const onBody = k % bodyStep[1] === 0 && j % bodyStep[0] === 0 && i % bodyStep[0] === 0
        if (!onBone) continue
        const isHead = value >= headFrom
        if (!isHead && !onBody) continue
        const [x, y, z] = scanPoint(cat, i, j, k)
        if (isHead) addPoint(moments, x, y, z)
        if (value >= boneFrom) bone.push(x, y, z)
        if (onBody) {
          lattice.push(x, y, z)
          head.push(isHead ? 1 : 0)
        }
      }
    }
  }
  return { bone: Float32Array.from(bone), lattice: Float32Array.from(lattice), head: Uint8Array.from(head), frame: principalFrame(moments) }
}

interface CatScores {
  // The share of the CAT's bone on pale tissue, the Dice overlap of the two silhouettes, and their sum
  bone: number
  body: number
  total: number
}

// The scores of a map from the CAT's patient frame into the photographs' grid
export function scoreCat(points: CatPoints, target: CryoTarget, map: RigidMap): CatScores {
  const { size, spacing, origin, flags } = target
  const [nx, ny, nz] = size
  const [[a, b, c], [d, e, f], [g, h, l]] = map.matrix
  const [tx, ty, tz] = map.offset
  // The flags of the voxel a mapped point falls in, or −1 off the grid
  const at = (x: number, y: number, z: number) => {
    const i = Math.round((a * x + b * y + c * z + tx - origin[0]) / spacing[0])
    const j = Math.round((d * x + e * y + f * z + ty - origin[1]) / spacing[1])
    const k = Math.round((g * x + h * y + l * z + tz - origin[2]) / spacing[2])
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1
    return flags[i + nx * (j + ny * k)]
  }
  let inside = 0
  let onPale = 0
  const { bone, lattice, head } = points
  for (let n = 0; n < bone.length; n += 3) {
    const flag = at(bone[n], bone[n + 1], bone[n + 2])
    if (flag < 0) continue
    inside++
    if ((flag & paleFlag) !== 0) onPale++
  }
  let both = 0
  let catHead = 0
  let cryoBody = 0
  for (let n = 0, m = 0; n < lattice.length; n += 3, m++) {
    const flag = at(lattice[n], lattice[n + 1], lattice[n + 2])
    if (flag < 0) continue
    const isHead = head[m] !== 0
    const isBody = (flag & bodyFlag) !== 0
    if (isHead) catHead++
    if (isBody) cryoBody++
    if (isHead && isBody) both++
  }
  const boneShare = inside * 3 >= bone.length * minInside ? onPale / inside : 0
  const body = catHead + cryoBody > 0 ? (2 * both) / (catHead + cryoBody) : 0
  return { bone: boneShare, body, total: boneShare + body }
}

// One stage of a search: the step each angle takes, in degrees, and each shift, in millimetres
export interface Stage {
  degrees: number
  millimetres: number
}

// Where a search may go from its start: this far in each angle and each shift
export interface Reach {
  degrees: number
  millimetres: number
}

// A start: a rotation, and the two points it turns about and lands on
export interface Start {
  rotation: Mat3
  from: Vec3
  to: Vec3
}

interface Found {
  map: RigidMap
  score: number
  // The turn and shift from the start, three angles then three shifts, and whether any ended at the reach's edge
  moved: readonly number[]
  atEdge: boolean
  evaluations: number
}

// The map a start gives once turned by three more angles about its `from` and shifted
export function startMap(start: Start, moved: readonly number[]): RigidMap {
  const rotation = multiply(rotationMatrix([moved[0], moved[1], moved[2]]), start.rotation)
  return mapAbout(rotation, [moved[3], moved[4], moved[5]], start.from, start.to)
}

// The search described at the top: a climb from the start by single steps, a stage at a time, within the reach
export function searchRigid(score: (map: RigidMap) => number, start: Start, stages: readonly Stage[], reach: Reach): Found {
  const moved = [0, 0, 0, 0, 0, 0]
  let evaluations = 1
  let best = score(startMap(start, moved))
  for (const stage of stages) {
    for (;;) {
      let bestStep = -1
      let bestScore = best
      for (let n = 0; n < 12; n++) {
        const parameter = n >> 1
        const step = (parameter < 3 ? stage.degrees : stage.millimetres) * (n % 2 === 0 ? 1 : -1)
        const limit = parameter < 3 ? reach.degrees : reach.millimetres
        if (Math.abs(moved[parameter] + step) > limit + 1e-9) continue
        moved[parameter] += step
        const value = score(startMap(start, moved))
        evaluations++
        moved[parameter] -= step
        if (value > bestScore) {
          bestScore = value
          bestStep = n
        }
      }
      if (bestStep < 0) break
      const parameter = bestStep >> 1
      moved[parameter] += (parameter < 3 ? stage.degrees : stage.millimetres) * (bestStep % 2 === 0 ? 1 : -1)
      best = bestScore
    }
  }
  const atEdge = moved.some((value, n) => Math.abs(value) >= (n < 3 ? reach.degrees : reach.millimetres) - 1e-9)
  return { map: startMap(start, moved), score: best, moved, atEdge, evaluations }
}

// The mutual information of two readings of the same points, from the count of points in each pair of bins: how
// much knowing one reading tells of the other, in nats; 0 where they're independent
export function mutualInformation(joint: Float64Array | Uint32Array, bins: number) {
  const rows = new Float64Array(bins)
  const columns = new Float64Array(bins)
  let total = 0
  for (let a = 0; a < bins; a++) {
    for (let b = 0; b < bins; b++) {
      const count = joint[a * bins + b]
      rows[a] += count
      columns[b] += count
      total += count
    }
  }
  if (total === 0) return 0
  let information = 0
  for (let a = 0; a < bins; a++) {
    for (let b = 0; b < bins; b++) {
      const count = joint[a * bins + b]
      if (count > 0) information += (count / total) * Math.log((count * total) / (rows[a] * columns[b]))
    }
  }
  return information
}

// The MRI's points for its fit to the CAT: a lattice of its voxels, about 3 mm apart, that show signal, each with its
// value's bin; and the head's centre and principal axes in the MRI's frame
interface MriPoints {
  points: Float32Array
  bins: Uint8Array
  frame: PrincipalFrame
  // The value signal starts at, and the value the top bin starts at
  signalFrom: number
  top: number
}

const informationBins = 32
// The MRI is sampled every this many voxels across a slice and every this many slices
const mriStep: readonly [number, number] = [6, 3]
// A voxel shows signal from this share of the scan's 99th percentile value, which leaves the air and its noise out
const signalShare = 0.1
// The CAT's values are binned from this to this, in Hounsfield units: air to the densest bone
const catBinRange: readonly [number, number] = [-1100, 2100]

export function mriPoints(mri: DicomVolume): MriPoints {
  const [nx, ny, nz] = mri.size
  const { voxels } = mri
  const sampled: number[] = []
  for (let n = 0; n < voxels.length; n += 97) sampled.push(voxels[n])
  sampled.sort((a, b) => a - b)
  const top = sampled[Math.floor(0.99 * (sampled.length - 1))]
  const signalFrom = signalShare * top
  const points: number[] = []
  const bins: number[] = []
  const moments = emptyMoments()
  for (let k = 0; k < nz; k += mriStep[1]) {
    for (let j = 0; j < ny; j += mriStep[0]) {
      for (let i = 0; i < nx; i += mriStep[0]) {
        const value = voxels[i + nx * (j + ny * k)]
        if (value < signalFrom) continue
        const [x, y, z] = scanPoint(mri, i, j, k)
        points.push(x, y, z)
        bins.push(Math.min(informationBins - 1, Math.floor((value / top) * informationBins)))
        addPoint(moments, x, y, z)
      }
    }
  }
  return { points: Float32Array.from(points), bins: Uint8Array.from(bins), frame: principalFrame(moments), signalFrom, top }
}

// The mutual information between the MRI's values and the CAT's at the MRI's points, under a map from the MRI's
// patient frame to the CAT's. A point the map puts off the CAT's grid reads as air there
export function scoreMri(points: MriPoints, cat: DicomVolume, hounsfieldScale: number, map: RigidMap) {
  const joint = new Uint32Array(informationBins * informationBins)
  const [[a, b, c], [d, e, f], [g, h, l]] = map.matrix
  const [tx, ty, tz] = map.offset
  const [low, high] = catBinRange
  const width = (high - low) / informationBins
  const air = low / hounsfieldScale
  const { points: p, bins } = points
  for (let n = 0, m = 0; n < p.length; n += 3, m++) {
    const x = p[n]
    const y = p[n + 1]
    const z = p[n + 2]
    const value = sampleScan(cat, [a * x + b * y + c * z + tx, d * x + e * y + f * z + ty, g * x + h * y + l * z + tz], air) * hounsfieldScale
    const bin = Math.max(0, Math.min(informationBins - 1, Math.floor((value - low) / width)))
    joint[bins[m] * informationBins + bin]++
  }
  return mutualInformation(joint, informationBins)
}

// The CAT's head as its own centre and axes, over the whole scan: what the MRI's head is matched to at its start
export function catHeadFrame(cat: DicomVolume, hounsfieldScale: number): PrincipalFrame {
  const [nx, ny, nz] = cat.size
  const headFrom = headHounsfield / hounsfieldScale
  const moments = emptyMoments()
  for (let k = 0; k < nz; k += 4) {
    for (let j = 0; j < ny; j += 6) {
      for (let i = 0; i < nx; i += 6) {
        if (cat.voxels[i + nx * (j + ny * k)] < headFrom) continue
        const [x, y, z] = scanPoint(cat, i, j, k)
        addPoint(moments, x, y, z)
      }
    }
  }
  return principalFrame(moments)
}
