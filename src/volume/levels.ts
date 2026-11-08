import { cellCount, scenePosition, sceneSpacing, type Triple, type Volume } from './format.ts'

// The body at three levels of detail: every 4 mm cell, and the 8 mm and 16 mm levels, whose cells are the 2 × 2 × 2 and
// 4 × 4 × 4 blocks of 4 mm cells that hold body. A block's cell sits at the centre of its body cells, coloured by their
// mean. Every level is in the scene's axes and millimetres, centred on the body's bounds

// The levels by their nominal spacing in millimetres, coarsest first, as the panel lists them
export const details = [16, 8, 4] as const
export type Detail = (typeof details)[number]

export const isDetail = (value: unknown): value is Detail => details.some((detail) => detail === value)

// How many 4 mm cells each level's block spans along each axis
export const blockCells: Record<Detail, number> = { 4: 1, 8: 2, 16: 4 }

// The body's bounds in the scene, in millimetres, before centring: the box its body cells fill, each reaching half a
// cell either side of its centre
export interface Bounds {
  center: Triple
  // Half the box's extent along x, y and z
  half: Triple
}

export interface Level {
  count: number
  // Each cell's centre, three floats per cell, in the scene's millimetres, centred on the body's bounds
  centers: Float32Array
  // Each cell's colour, R, G and B, as photographed
  colors: Uint8Array
  // The spacing of the level's grid in millimetres: the 4 mm cells' mean spacing times the block
  spacing: number
}

export type Levels = Record<Detail, Level>

// format.ts's mapping from grid to scene is linear, so a cell's place is i, j and k times these, the scene's
// millimetres per step along each of the grid's axes
function sceneBasis(volume: Volume) {
  return [scenePosition(volume, 1, 0, 0), scenePosition(volume, 0, 1, 0), scenePosition(volume, 0, 0, 1)] as const
}

// The index of every body cell, in index order, which is the order of their colours too. It reads the mask a byte at
// a time and skips the empty ones, since most of the grid around the body is empty
export function bodyIndices(volume: Volume): Uint32Array {
  const { mask } = volume
  const cells = cellCount(volume.size)
  const indices = new Uint32Array(volume.colors.length / 3)
  let n = 0
  for (let byte = 0; byte < mask.length; byte++) {
    let bits = mask[byte]
    while (bits !== 0 && n < indices.length) {
      // The lowest set bit, which is then cleared
      const index = byte * 8 + 31 - Math.clz32(bits & -bits)
      bits &= bits - 1
      if (index < cells) indices[n++] = index
    }
  }
  return indices
}

export function bodyBounds(volume: Volume, indices = bodyIndices(volume)): Bounds {
  if (indices.length === 0) throw new Error('The volume holds no body cells')
  const [nx, ny] = volume.size
  // The lowest and highest i and j of any body cell. Its k only grows along the indices, so the first and the last
  // body cells hold the lowest and the highest
  let lowI = nx
  let highI = 0
  let lowJ = ny
  let highJ = 0
  for (let n = 0; n < indices.length; n++) {
    const index = indices[n]
    const row = Math.floor(index / nx)
    const i = index - row * nx
    const j = row - Math.floor(row / ny) * ny
    if (i < lowI) lowI = i
    if (i > highI) highI = i
    if (j < lowJ) lowJ = j
    if (j > highJ) highJ = j
  }
  const lowK = Math.floor(indices[0] / (nx * ny))
  const highK = Math.floor(indices[indices.length - 1] / (nx * ny))

  // The grid's extreme corners in the scene; an axis that runs backwards swaps which is the lower
  const a = scenePosition(volume, lowI, lowJ, lowK)
  const b = scenePosition(volume, highI, highJ, highK)
  const spacing = sceneSpacing(volume)
  const along = (axis: number) => {
    const min = Math.min(a[axis], b[axis]) - spacing[axis] / 2
    const max = Math.max(a[axis], b[axis]) + spacing[axis] / 2
    return { center: (min + max) / 2, half: (max - min) / 2 }
  }
  const [x, y, z] = [along(0), along(1), along(2)]
  return { center: [x.center, y.center, z.center], half: [x.half, y.half, z.half] }
}

// A level of blocks of `block` cells along each axis, listing the blocks that hold body in index order. The body cells
// come in index order, so they fill one layer of blocks after another, and the sums only ever hold one layer
export function buildLevel(volume: Volume, bounds: Bounds, block: number, indices = bodyIndices(volume)): Level {
  const [nx, ny] = volume.size
  const { colors } = volume
  const bx = Math.ceil(nx / block)
  const layerBlocks = bx * Math.ceil(ny / block)
  const layerCells = nx * ny
  // A level has at most one cell per body cell
  const bodyCells = indices.length
  const centers = new Float32Array(bodyCells * 3)
  const levelColors = new Uint8Array(bodyCells * 3)
  const [cx, cy, cz] = bounds.center
  const [ei, ej, ek] = sceneBasis(volume)
  let count = 0

  // Adds a cell at a place in the grid, in cells, which needn't be whole, with its colour
  const emit = (i: number, j: number, k: number, r: number, g: number, b: number) => {
    const at = count * 3
    centers[at] = i * ei[0] + j * ej[0] + k * ek[0] - cx
    centers[at + 1] = i * ei[1] + j * ej[1] + k * ek[1] - cy
    centers[at + 2] = i * ei[2] + j * ej[2] + k * ek[2] - cz
    levelColors[at] = r
    levelColors[at + 1] = g
    levelColors[at + 2] = b
    count++
  }

  if (block === 1) {
    for (let n = 0; n < bodyCells; n++) {
      const index = indices[n]
      const k = Math.floor(index / layerCells)
      const inLayer = index - k * layerCells
      const j = Math.floor(inLayer / nx)
      emit(inLayer - j * nx, j, k, colors[n * 3], colors[n * 3 + 1], colors[n * 3 + 2])
    }
  } else {
    // Per block of the layer: the sums of its body cells' i, j and k, and of their R, G and B, then how many there are
    const sums = new Float64Array(layerBlocks * 6)
    const counts = new Uint32Array(layerBlocks)
    const flush = () => {
      for (let b = 0; b < layerBlocks; b++) {
        const n = counts[b]
        if (n === 0) continue
        const s = b * 6
        emit(
          sums[s] / n,
          sums[s + 1] / n,
          sums[s + 2] / n,
          Math.round(sums[s + 3] / n),
          Math.round(sums[s + 4] / n),
          Math.round(sums[s + 5] / n),
        )
      }
      sums.fill(0)
      counts.fill(0)
    }
    let layer = -1
    for (let n = 0; n < bodyCells; n++) {
      const index = indices[n]
      const k = Math.floor(index / layerCells)
      const inLayer = index - k * layerCells
      const j = Math.floor(inLayer / nx)
      const i = inLayer - j * nx
      const blockLayer = Math.floor(k / block)
      if (blockLayer !== layer) {
        if (layer >= 0) flush()
        layer = blockLayer
      }
      const b = Math.floor(i / block) + bx * Math.floor(j / block)
      const s = b * 6
      sums[s] += i
      sums[s + 1] += j
      sums[s + 2] += k
      sums[s + 3] += colors[n * 3]
      sums[s + 4] += colors[n * 3 + 1]
      sums[s + 5] += colors[n * 3 + 2]
      counts[b]++
    }
    flush()
  }

  const [sx, sy, sz] = volume.spacing
  return {
    count,
    centers: count === bodyCells ? centers : centers.slice(0, count * 3),
    colors: count === bodyCells ? levelColors : levelColors.slice(0, count * 3),
    spacing: ((sx + sy + sz) / 3) * block,
  }
}

// The body's bounds and its three levels, from the body cells listed once
export function buildBody(volume: Volume): { bounds: Bounds; levels: Levels } {
  const indices = bodyIndices(volume)
  const bounds = bodyBounds(volume, indices)
  const level = (detail: Detail) => buildLevel(volume, bounds, blockCells[detail], indices)
  return { bounds, levels: { 4: level(4), 8: level(8), 16: level(16) } }
}
