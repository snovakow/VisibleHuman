// The volume file: a header, a bitmask of which cells are body, then R, G and B for each body cell
// in index order. Little-endian. Shared by the data script, which writes it, and the app, which reads it

// The grid keeps the source's axes: i across the image, j down it, k down the slices from the head.
// Cell (i, j, k) has index i + nx·(j + ny·k)
export type Triple = readonly [number, number, number]

export interface Volume {
  // The grid's size in cells along i, j and k
  size: Triple
  // The spacing between cells' centres along i, j and k, in millimetres
  spacing: Triple
  // Where the grid's first cell sits in the full grid of every slice, in cells along i, j and k
  offset: Triple
  // The first and last slice numbers read
  firstSlice: number
  lastSlice: number
  // One bit per cell: cell n is body when bit (n & 7) of byte (n >> 3) is set
  mask: Uint8Array
  // Three bytes, R, G and B, for each body cell, in index order
  colors: Uint8Array
}

export const magic = 'VHV1'
export const formatVersion = 1
// Magic 4, version 2, size 3 × 2, spacing 3 × 4, offset 3 × 2, slices 2 × 2, body count 4
export const headerBytes = 38

const maxU16 = 0xffff

export const cellCount = (size: Triple) => size[0] * size[1] * size[2]
export const maskBytes = (cells: number) => Math.ceil(cells / 8)
export const cellIndex = (size: Triple, i: number, j: number, k: number) => i + size[0] * (j + size[1] * k)
export const isBodyCell = (mask: Uint8Array, index: number) => (mask[index >> 3] & (1 << (index & 7))) !== 0

// The number of set bits among the mask's first `cells` bits
export function countBody(mask: Uint8Array, cells: number) {
  let count = 0
  for (let index = 0; index < cells; index++) if (isBodyCell(mask, index)) count++
  return count
}

export function writeVolume(volume: Volume): Uint8Array {
  const { size, spacing, offset, firstSlice, lastSlice, mask, colors } = volume
  for (const value of [...size, ...offset, firstSlice, lastSlice]) {
    if (!Number.isInteger(value) || value < 0 || value > maxU16) {
      throw new Error(`Volume file: ${value} doesn't fit the header's 16-bit fields`)
    }
  }
  const cells = cellCount(size)
  if (mask.length !== maskBytes(cells)) {
    throw new Error(`Volume file: the mask has ${mask.length} bytes, but ${cells} cells need ${maskBytes(cells)}`)
  }
  const bodyCount = countBody(mask, cells)
  if (colors.length !== bodyCount * 3) {
    throw new Error(`Volume file: ${colors.length} colour bytes for ${bodyCount} body cells, which need ${bodyCount * 3}`)
  }

  const bytes = new Uint8Array(headerBytes + mask.length + colors.length)
  const view = new DataView(bytes.buffer)
  for (let n = 0; n < magic.length; n++) bytes[n] = magic.charCodeAt(n)
  view.setUint16(4, formatVersion, true)
  size.forEach((value, axis) => view.setUint16(6 + axis * 2, value, true))
  spacing.forEach((value, axis) => view.setFloat32(12 + axis * 4, value, true))
  offset.forEach((value, axis) => view.setUint16(24 + axis * 2, value, true))
  view.setUint16(30, firstSlice, true)
  view.setUint16(32, lastSlice, true)
  view.setUint32(34, bodyCount, true)
  bytes.set(mask, headerBytes)
  bytes.set(colors, headerBytes + mask.length)
  return bytes
}

// Reads a volume file, throwing a clear error if it isn't one or its parts disagree
export function readVolume(bytes: Uint8Array): Volume {
  if (bytes.length < headerBytes) {
    throw new Error(`Not a volume file: ${bytes.length} bytes is shorter than the ${headerBytes}-byte header`)
  }
  const found = String.fromCharCode(...bytes.subarray(0, magic.length))
  if (found !== magic) throw new Error(`Not a volume file: it starts with ${JSON.stringify(found)} rather than ${magic}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(4, true)
  if (version !== formatVersion) {
    throw new Error(`Volume file version ${version} isn't supported; this app reads version ${formatVersion}`)
  }
  const triple = (start: number, read: (offset: number) => number, width: number): Triple => [
    read(start),
    read(start + width),
    read(start + width * 2),
  ]
  const u16 = (at: number) => view.getUint16(at, true)
  const size = triple(6, u16, 2)
  const spacing = triple(12, (at) => view.getFloat32(at, true), 4)
  const offset = triple(24, u16, 2)
  const firstSlice = u16(30)
  const lastSlice = u16(32)
  const bodyCount = view.getUint32(34, true)

  const cells = cellCount(size)
  const expected = headerBytes + maskBytes(cells) + bodyCount * 3
  if (bytes.length !== expected) {
    throw new Error(
      `Volume file is ${bytes.length} bytes, but its header (${size.join(' × ')} cells, ${bodyCount} body) needs ${expected}`,
    )
  }
  const mask = bytes.slice(headerBytes, headerBytes + maskBytes(cells))
  const masked = countBody(mask, cells)
  if (masked !== bodyCount) {
    throw new Error(`Volume file: the header counts ${bodyCount} body cells, but the mask has ${masked}`)
  }
  const colors = bytes.slice(headerBytes + mask.length)
  return { size, spacing, offset, firstSlice, lastSlice, mask, colors }
}

// The scene's axes: the head up (+y), the front towards +z and the body's left on +x. Each follows one of the
// grid's axes, i (0), j (1) or k (2), in the direction of its sign (read from slice 1500)
export const sceneAxes = {
  // Columns run from the body's right to its left
  x: { source: 0, sign: 1 },
  // Slices run down from the head
  y: { source: 2, sign: -1 },
  // Rows run from the body's back to its front
  z: { source: 1, sign: 1 },
} as const

// A cell's place along the scene's axes, in whole cells: x, y and z, each signed as sceneAxes says
export function sceneCell(i: number, j: number, k: number): Triple {
  const grid = [i, j, k]
  // Subtracting from 0 rather than multiplying by −1 gives 0 rather than −0 at the origin
  const along = (axis: { source: number; sign: number }) =>
    axis.sign < 0 ? 0 - grid[axis.source] : grid[axis.source]
  const { x, y, z } = sceneAxes
  return [along(x), along(y), along(z)]
}

// The spacing along the scene's x, y and z, in millimetres
export function sceneSpacing(volume: Volume): Triple {
  const { x, y, z } = sceneAxes
  return [volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source]]
}

// A cell's centre in the scene, in millimetres, before centring on the body's bounds
export function scenePosition(volume: Volume, i: number, j: number, k: number): Triple {
  const [x, y, z] = sceneCell(i, j, k)
  const [sx, sy, sz] = sceneSpacing(volume)
  return [x * sx, y * sy, z * sz]
}
