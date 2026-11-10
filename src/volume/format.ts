// The volume file, version 2: a 64-byte header, then planar blocks of the whole grid, one byte per voxel in index
// order, each delta-coded along i: green, red − green, blue − green, the density, the coverage and, for a body with
// one, the MRI. The grid is dense, the body's bounds plus a one-voxel margin on every face, so the app can upload a
// block straight into a 3D texture. The file is gzipped on disk; this module reads and writes the bytes inside.
// Little-endian. Shared by the data script, which writes it, and the app, which reads it

import { correlate, decorrelate, deltaDecode, deltaEncode } from './codec.ts'

// The grid keeps the source's axes: i across the slice image, j down it, k along the slices from the first.
// Voxel (i, j, k) has index i + nx·(j + ny·k)
export type Triple = readonly [number, number, number]

// A scene axis follows one of the grid's axes, i (0), j (1) or k (2), with it or against it
interface SceneAxis {
  source: 0 | 1 | 2
  sign: 1 | -1
}

// The scene's axes: x from the body's right to its left, y up, z towards the front. Each body says which grid axis
// each follows, since the bodies were photographed in different poses
export interface SceneAxes {
  x: SceneAxis
  y: SceneAxis
  z: SceneAxis
}

export interface Volume {
  // The grid's size in voxels along i, j and k
  size: Triple
  // The spacing between voxel centres along i, j and k, in millimetres
  spacing: Triple
  // The centre of voxel (0, 0, 0) in the source frame, in millimetres: i and j from the slice image's top-left pixel
  // centre, k from the plane of the body's first slice. The margin puts it half a voxel or more outside the body
  origin: Triple
  // The first and last slice numbers of the layers that hold body, the margin excluded
  firstSlice: number
  lastSlice: number
  axes: SceneAxes
  // The body's id, up to 16 ASCII characters, such as "male"
  body: string
  // The blocks, one byte per voxel in index order. The colour is the photographs' sRGB: a body voxel's is the mean of
  // its body pixels, and a voxel outside the body takes the mean of its body neighbours within one voxel, else 0
  red: Uint8Array
  green: Uint8Array
  blue: Uint8Array
  // The share of the voxel's pixels that are body, scaled to 255, with the body decision folded in: at least 128
  // where the voxel is body, at most 127 where it isn't
  coverage: Uint8Array
  // Density on the CT's scale, (HU + 1000) / 16: 0 outside the body and at least 1 inside
  density?: Uint8Array
  // The MRI's intensity, 0 outside the body or the MRI's reach, else 1 to 255
  mri?: Uint8Array
}

const magic = 'VHV2'
const formatVersion = 2
export const headerBytes = 64
// The body id's field in the header: ASCII, zero-padded
const bodyBytes = 16
// The channels byte: a bit for each kind of block a file may hold. Every file holds colour and coverage
const colorBit = 1
const densityBit = 2
const coverageBit = 4
const mriBit = 8
const knownBits = colorBit | densityBit | coverageBit | mriBit
// The coding byte: 0 leaves the blocks as they are, 1 delta-codes each along i
const rawCoding = 0
const deltaCoding = 1
// A voxel is body when its coverage is at least this
export const bodyCoverage = 128

const maxU16 = 0xffff

export const cellCount = (size: Triple) => size[0] * size[1] * size[2]
export const cellIndex = (size: Triple, i: number, j: number, k: number) => i + size[0] * (j + size[1] * k)
export const isBodyVoxel = (coverage: number) => coverage >= bodyCoverage

// An axis byte: bits 0 and 1 the source axis, bit 7 set where the scene axis runs against it
const againstBit = 0x80

const axisByte = (axis: SceneAxis) => axis.source | (axis.sign < 0 ? againstBit : 0)

function axisFromByte(byte: number): SceneAxis {
  const source = byte & 3
  if ((source !== 0 && source !== 1 && source !== 2) || (byte & ~(3 | againstBit)) !== 0) {
    throw new Error(`Volume file: ${byte} isn't an axis byte`)
  }
  return { source, sign: (byte & againstBit) !== 0 ? -1 : 1 }
}

const axesBytes = (axes: SceneAxes): Triple => [axisByte(axes.x), axisByte(axes.y), axisByte(axes.z)]

// The scene's three axes from their bytes, each source axis used once, so the mapping can be inverted
export function axesFromBytes(bytes: Triple): SceneAxes {
  const [x, y, z] = bytes.map(axisFromByte)
  const sources = new Set([x.source, y.source, z.source])
  if (sources.size !== 3) {
    throw new Error(`Volume file: the axes ${bytes.join(', ')} don't use each of i, j and k once`)
  }
  return { x, y, z }
}

// The number of body voxels, for reports; the app finds them through the coverage block directly
export function countBody(coverage: Uint8Array) {
  let count = 0
  for (let n = 0; n < coverage.length; n++) if (isBodyVoxel(coverage[n])) count++
  return count
}

// The blocks a volume holds, in the file's order, with the channels byte that says which are there
function blocksOf(volume: Volume) {
  const { red, green, blue, density, coverage, mri } = volume
  const blocks = [green, decorrelate(red.slice(), green), decorrelate(blue.slice(), green)]
  let channels = colorBit | coverageBit
  if (density) {
    blocks.push(density)
    channels |= densityBit
  }
  blocks.push(coverage)
  if (mri) {
    blocks.push(mri)
    channels |= mriBit
  }
  return { blocks, channels }
}

const blockCountOf = (channels: number) =>
  ((channels & colorBit) !== 0 ? 3 : 0) +
  ((channels & densityBit) !== 0 ? 1 : 0) +
  ((channels & coverageBit) !== 0 ? 1 : 0) +
  ((channels & mriBit) !== 0 ? 1 : 0)

export function writeVolume(volume: Volume): Uint8Array {
  const { size, spacing, origin, firstSlice, lastSlice, axes, body } = volume
  for (const value of [...size, firstSlice, lastSlice]) {
    if (!Number.isInteger(value) || value < 0 || value > maxU16) {
      throw new Error(`Volume file: ${value} doesn't fit the header's 16-bit fields`)
    }
  }
  if (size.some((value) => value < 1)) throw new Error(`Volume file: a grid of ${size.join(' × ')} voxels is empty`)
  if (spacing.some((value) => !(value > 0))) throw new Error(`Volume file: the spacing ${spacing.join(', ')} isn't positive`)
  // Writing the axes as bytes and back checks them as the reader will
  axesFromBytes(axesBytes(axes))
  if (body.length > bodyBytes || !/^[\x20-\x7e]*$/.test(body)) {
    throw new Error(`Volume file: the body id ${JSON.stringify(body)} isn't up to ${bodyBytes} ASCII characters`)
  }
  const cells = cellCount(size)
  const { blocks, channels } = blocksOf(volume)
  for (const block of blocks) {
    if (block.length !== cells) {
      throw new Error(`Volume file: a block has ${block.length} bytes, but ${size.join(' × ')} voxels need ${cells}`)
    }
  }

  const bytes = new Uint8Array(headerBytes + blocks.length * cells)
  const view = new DataView(bytes.buffer)
  for (let n = 0; n < magic.length; n++) bytes[n] = magic.charCodeAt(n)
  view.setUint16(4, formatVersion, true)
  view.setUint16(6, headerBytes, true)
  size.forEach((value, axis) => view.setUint16(8 + axis * 2, value, true))
  spacing.forEach((value, axis) => view.setFloat32(14 + axis * 4, value, true))
  origin.forEach((value, axis) => view.setFloat32(26 + axis * 4, value, true))
  view.setUint16(38, firstSlice, true)
  view.setUint16(40, lastSlice, true)
  axesBytes(axes).forEach((value, axis) => {
    bytes[42 + axis] = value
  })
  bytes[45] = channels
  bytes[46] = deltaCoding
  bytes[47] = 0
  for (let n = 0; n < body.length; n++) bytes[48 + n] = body.charCodeAt(n)
  blocks.forEach((block, n) => bytes.set(deltaEncode(block, size[0]), headerBytes + n * cells))
  return bytes
}

// Reads a volume file's bytes, gzip already undone, throwing a clear error if they aren't one or its parts disagree
export function readVolume(bytes: Uint8Array): Volume {
  if (bytes.length < headerBytes) {
    throw new Error(`Not a volume file: ${bytes.length} bytes is shorter than the ${headerBytes}-byte header`)
  }
  const found = String.fromCharCode(...bytes.subarray(0, magic.length))
  if (found === 'VHV1') throw new Error('Not a volume file this app reads: it is version 1, which was retired')
  if (found !== magic) throw new Error(`Not a volume file: it starts with ${JSON.stringify(found)} rather than ${magic}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(4, true)
  if (version !== formatVersion) {
    throw new Error(`Volume file version ${version} isn't supported; this app reads version ${formatVersion}`)
  }
  const header = view.getUint16(6, true)
  if (header !== headerBytes) {
    throw new Error(`Volume file: a ${header}-byte header, where version ${formatVersion} has ${headerBytes}`)
  }
  const triple = (start: number, read: (offset: number) => number, width: number): Triple => [
    read(start),
    read(start + width),
    read(start + width * 2),
  ]
  const u16 = (at: number) => view.getUint16(at, true)
  const f32 = (at: number) => view.getFloat32(at, true)
  const size = triple(8, u16, 2)
  const spacing = triple(14, f32, 4)
  const origin = triple(26, f32, 4)
  const firstSlice = u16(38)
  const lastSlice = u16(40)
  const axes = axesFromBytes(triple(42, (at) => bytes[at], 1))
  const channels = bytes[45]
  const coding = bytes[46]
  if (size.some((value) => value < 1)) throw new Error(`Volume file: a grid of ${size.join(' × ')} voxels is empty`)
  if (spacing.some((value) => !(value > 0))) throw new Error(`Volume file: the spacing ${spacing.join(', ')} isn't positive`)
  if ((channels & colorBit) === 0 || (channels & coverageBit) === 0) {
    throw new Error(`Volume file: channels ${channels} lack the colour or the coverage every file has`)
  }
  if ((channels & ~knownBits) !== 0) throw new Error(`Volume file: channels ${channels} include some this app doesn't know`)
  if (coding !== rawCoding && coding !== deltaCoding) throw new Error(`Volume file: coding ${coding} isn't known`)
  let bodyEnd = 48
  while (bodyEnd < 48 + bodyBytes && bytes[bodyEnd] !== 0) bodyEnd++
  const body = String.fromCharCode(...bytes.subarray(48, bodyEnd))

  const cells = cellCount(size)
  const expected = headerBytes + blockCountOf(channels) * cells
  if (bytes.length !== expected) {
    throw new Error(
      `Volume file is ${bytes.length} bytes, but its header (${size.join(' × ')} voxels, channels ${channels}) needs ${expected}`,
    )
  }
  let next = headerBytes
  // A block's bytes decoded, and for red and blue green added back
  const block = (green?: Uint8Array) => {
    const coded = bytes.subarray(next, next + cells)
    next += cells
    if (coding === deltaCoding) return deltaDecode(coded, size[0], green)
    return green ? correlate(coded.slice(), green) : coded.slice()
  }
  const green = block()
  const red = block(green)
  const blue = block(green)
  const density = (channels & densityBit) !== 0 ? block() : undefined
  const coverage = block()
  const mri = (channels & mriBit) !== 0 ? block() : undefined
  const volume: Volume = { size, spacing, origin, firstSlice, lastSlice, axes, body, red, green, blue, coverage }
  if (density) volume.density = density
  if (mri) volume.mri = mri
  return volume
}

// The bytes of an RGBA texture, R, G, B and density per voxel in index order. The density is the GPU's body test,
// so a file without a density block gets 1 inside the body and 0 outside. Asked for the MRI, the fourth byte is the
// MRI block's instead, 0 outside the body and where the MRI doesn't reach, so whatever reads the density reads the MRI
export function rgbaBytes(volume: Volume, fourth: 'density' | 'mri' = 'density'): Uint8Array {
  const { red, green, blue, density, coverage, mri } = volume
  if (fourth === 'mri' && !mri) throw new Error(`The ${volume.body}'s volume has no MRI block`)
  const bytes = new Uint8Array(red.length * 4)
  for (let n = 0, at = 0; n < red.length; n++, at += 4) {
    bytes[at] = red[n]
    bytes[at + 1] = green[n]
    bytes[at + 2] = blue[n]
    bytes[at + 3] = fourth === 'mri' && mri ? mri[n] : density ? density[n] : isBodyVoxel(coverage[n]) ? 1 : 0
  }
  return bytes
}

// A voxel's place along the scene's axes, in whole voxels: x, y and z, each signed as the volume's axes say
export function sceneCell(volume: Volume, i: number, j: number, k: number): Triple {
  const grid = [i, j, k]
  // Subtracting from 0 rather than multiplying by −1 gives 0 rather than −0 at the origin
  const along = (axis: SceneAxis) => (axis.sign < 0 ? 0 - grid[axis.source] : grid[axis.source])
  const { x, y, z } = volume.axes
  return [along(x), along(y), along(z)]
}

// The spacing along the scene's x, y and z, in millimetres
export function sceneSpacing(volume: Volume): Triple {
  const { x, y, z } = volume.axes
  return [volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source]]
}

// A voxel's centre in the scene, in millimetres, before centring on the body's bounds
export function scenePosition(volume: Volume, i: number, j: number, k: number): Triple {
  const [x, y, z] = sceneCell(volume, i, j, k)
  const [sx, sy, sz] = sceneSpacing(volume)
  return [x * sx, y * sy, z * sz]
}
