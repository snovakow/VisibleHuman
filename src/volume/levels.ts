import { isBodyVoxel, scenePosition, sceneSpacing, type Triple, type Volume } from './format.ts'

// The body as splat levels: every body voxel, and the blocks of 2 × 2 × 2, 4 × 4 × 4 and 8 × 8 × 8 voxels that hold
// body. A block's cell sits at the centre of its body voxels, coloured by their mean, and covered by the mean coverage
// of all its voxels, body or not. Every level is in the scene's axes and millimetres, centred on the body's bounds

// The blocks a level may merge, in voxels along each axis, finest first. A level's Detail is its block
export const blocks = [1, 2, 4, 8] as const
export type Detail = number

// A level of more cells than this is left out. three keeps a splat in 52 bytes over four storage buffers, 16 in the
// largest, and its sort in 8 more, so a level this size takes about 120 MB, and 32 MB in its largest buffer, well
// within the 128 MB a storage binding may hold
export const maxLevelCells = 2_000_000
// The page opens on the finest level of at most this many cells, which on the male's 4 mm file is the 8 mm level of
// about 215,000, the most the WebGL 2 fallback orbits smoothly on a 2014 Intel Iris
export const defaultLevelCells = 400_000

// The body's bounds in the scene, in millimetres, before centring: the box its body voxels fill, each reaching half a
// voxel either side of its centre
export interface Bounds {
  center: Triple
  // Half the box's extent along x, y and z
  half: Triple
}

export interface Level {
  // The voxels it merges along each axis, its Detail
  block: number
  // The spacing of the level's grid in millimetres: the voxels' mean spacing times the block
  spacing: number
  // As the panel lists it, such as "8 mm"
  label: string
  count: number
  // Each cell's centre, three floats per cell, in the scene's millimetres, centred on the body's bounds
  centers: Float32Array
  // Each cell's colour, R, G and B, as photographed
  colors: Uint8Array
  // Each cell's coverage, the share of it that's body scaled to 255: a body voxel's own, at least 128, and a block's
  // the mean over every voxel it spans, so a block the skin runs through is partly covered. The splats' alpha is
  // weighted by it, so a partly covered cell fades instead of standing a whole cell proud of the surface
  coverage: Uint8Array
}

// Finest first
export type Levels = readonly Level[]

export interface Body {
  bounds: Bounds
  levels: Levels
  // The level the page opens on
  defaultDetail: Detail
}

// The lowest and highest i, j and k of any body voxel
interface Extent {
  low: Triple
  high: Triple
}

// The index of every body voxel, in index order
export function bodyIndices(volume: Volume): Uint32Array {
  const { coverage } = volume
  let count = 0
  for (let index = 0; index < coverage.length; index++) if (isBodyVoxel(coverage[index])) count++
  const indices = new Uint32Array(count)
  let n = 0
  for (let index = 0; index < coverage.length; index++) if (isBodyVoxel(coverage[index])) indices[n++] = index
  return indices
}

function extentOf(volume: Volume, indices: Uint32Array): Extent {
  if (indices.length === 0) throw new Error('The volume holds no body voxels')
  const [nx, ny] = volume.size
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
  // k only grows along the indices, so the first and the last body voxels hold the lowest and the highest
  const lowK = Math.floor(indices[0] / (nx * ny))
  const highK = Math.floor(indices[indices.length - 1] / (nx * ny))
  return { low: [lowI, lowJ, lowK], high: [highI, highJ, highK] }
}

export function bodyBounds(volume: Volume, indices = bodyIndices(volume), extent = extentOf(volume, indices)): Bounds {
  const { low, high } = extent
  // The extreme voxels' centres in the scene; an axis that runs backwards swaps which is the lower
  const a = scenePosition(volume, ...low)
  const b = scenePosition(volume, ...high)
  const spacing = sceneSpacing(volume)
  const along = (axis: number) => {
    const min = Math.min(a[axis], b[axis]) - spacing[axis] / 2
    const max = Math.max(a[axis], b[axis]) + spacing[axis] / 2
    return { center: (min + max) / 2, half: (max - min) / 2 }
  }
  const [x, y, z] = [along(0), along(1), along(2)]
  return { center: [x.center, y.center, z.center], half: [x.half, y.half, z.half] }
}

// format.ts's mapping from grid to scene is linear, so a voxel's place is i, j and k times these, the scene's
// millimetres per step along each of the grid's axes
function sceneBasis(volume: Volume) {
  return [scenePosition(volume, 1, 0, 0), scenePosition(volume, 0, 1, 0), scenePosition(volume, 0, 0, 1)] as const
}

// The panel's name for a level: the voxels' mean spacing to a tenth of a millimetre, times the block, so the male's
// 3.96 × 3.96 × 4 mm voxels make "4 mm", "8 mm" and so on
function labelOf(volume: Volume, block: number) {
  const [sx, sy, sz] = volume.spacing
  const nominal = Math.round(((sx + sy + sz) / 3) * 10) / 10
  return `${Number((nominal * block).toFixed(1))} mm`
}

// A level of blocks of `block` voxels along each axis, listing the blocks that hold body in index order. The blocks
// start at the body's lowest voxel along each axis, not at the grid's first, which lies in the margin, so they group
// the body as they always have. The body voxels come in index order, so they fill one layer of blocks after another,
// and the sums only ever hold one layer
export function buildLevel(
  volume: Volume,
  bounds: Bounds,
  block: number,
  indices = bodyIndices(volume),
  extent = extentOf(volume, indices),
): Level {
  const [nx, ny, nz] = volume.size
  const { red, green, blue, coverage } = volume
  const { low, high } = extent
  const bx = Math.floor((high[0] - low[0]) / block) + 1
  const by = Math.floor((high[1] - low[1]) / block) + 1
  const layerBlocks = bx * by
  const blockLayers = Math.floor((high[2] - low[2]) / block) + 1
  const layerCells = nx * ny
  // A level has at most one cell per body voxel, and one per block
  const most = Math.min(indices.length, layerBlocks * blockLayers)
  const centers = new Float32Array(most * 3)
  const levelColors = new Uint8Array(most * 3)
  const levelCoverage = new Uint8Array(most)
  const [cx, cy, cz] = bounds.center
  const [ei, ej, ek] = sceneBasis(volume)
  let count = 0

  // Adds a cell at a place in the grid, in voxels, which needn't be whole, with its colour and coverage
  const emit = (i: number, j: number, k: number, r: number, g: number, b: number, covered: number) => {
    const at = count * 3
    centers[at] = i * ei[0] + j * ej[0] + k * ek[0] - cx
    centers[at + 1] = i * ei[1] + j * ej[1] + k * ek[1] - cy
    centers[at + 2] = i * ei[2] + j * ej[2] + k * ek[2] - cz
    levelColors[at] = r
    levelColors[at + 1] = g
    levelColors[at + 2] = b
    levelCoverage[count] = covered
    count++
  }

  if (block === 1) {
    for (let n = 0; n < indices.length; n++) {
      const index = indices[n]
      const k = Math.floor(index / layerCells)
      const inLayer = index - k * layerCells
      const j = Math.floor(inLayer / nx)
      emit(inLayer - j * nx, j, k, red[index], green[index], blue[index], coverage[index])
    }
  } else {
    // Per block of the layer: the sums of its body voxels' i, j and k, and of their R, G and B, then how many there are
    const sums = new Float64Array(layerBlocks * 6)
    const counts = new Uint32Array(layerBlocks)
    // And the coverage of every voxel each block spans, body or not. A block past the grid's last voxel along an axis
    // spans voxels that aren't there, which count as uncovered, as the margin's voxels are
    const coverageSums = new Uint32Array(layerBlocks)
    const blockVoxels = block * block * block
    const iEnd = Math.min(nx, low[0] + bx * block)
    const jEnd = Math.min(ny, low[1] + by * block)
    const flush = (blockLayer: number) => {
      const kStart = low[2] + blockLayer * block
      for (let k = kStart; k < Math.min(nz, kStart + block); k++) {
        for (let j = low[1]; j < jEnd; j++) {
          const row = bx * Math.floor((j - low[1]) / block)
          const start = nx * (j + ny * k)
          for (let i = low[0]; i < iEnd; i++) coverageSums[row + Math.floor((i - low[0]) / block)] += coverage[start + i]
        }
      }
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
          Math.round(coverageSums[b] / blockVoxels),
        )
      }
      sums.fill(0)
      counts.fill(0)
      coverageSums.fill(0)
    }
    let layer = -1
    for (let n = 0; n < indices.length; n++) {
      const index = indices[n]
      const k = Math.floor(index / layerCells)
      const inLayer = index - k * layerCells
      const j = Math.floor(inLayer / nx)
      const i = inLayer - j * nx
      const blockLayer = Math.floor((k - low[2]) / block)
      if (blockLayer !== layer) {
        if (layer >= 0) flush(layer)
        layer = blockLayer
      }
      const b = Math.floor((i - low[0]) / block) + bx * Math.floor((j - low[1]) / block)
      const s = b * 6
      sums[s] += i
      sums[s + 1] += j
      sums[s + 2] += k
      sums[s + 3] += red[index]
      sums[s + 4] += green[index]
      sums[s + 5] += blue[index]
      counts[b]++
    }
    flush(layer)
  }

  const [sx, sy, sz] = volume.spacing
  return {
    block,
    spacing: ((sx + sy + sz) / 3) * block,
    label: labelOf(volume, block),
    count,
    centers: count === most ? centers : centers.slice(0, count * 3),
    colors: count === most ? levelColors : levelColors.slice(0, count * 3),
    coverage: count === most ? levelCoverage : levelCoverage.slice(0, count),
  }
}

export interface LevelLimits {
  maxCells: number
  defaultCells: number
}

// The body's bounds and its levels, from the body voxels listed once: every block of `blocks` whose level holds at
// most maxCells cells, finest first, and as the default the finest of those with at most defaultCells, else the
// coarsest
export function buildBody(
  volume: Volume,
  limits: LevelLimits = { maxCells: maxLevelCells, defaultCells: defaultLevelCells },
): Body {
  const indices = bodyIndices(volume)
  const extent = extentOf(volume, indices)
  const bounds = bodyBounds(volume, indices, extent)
  const levels: Level[] = []
  for (const block of blocks) {
    // The finest level has a cell per body voxel, so it's known too large before it's built
    if (block === 1 && indices.length > limits.maxCells) continue
    const level = buildLevel(volume, bounds, block, indices, extent)
    if (level.count <= limits.maxCells) levels.push(level)
  }
  if (levels.length === 0) throw new Error(`Every level of the ${volume.body} holds more than ${limits.maxCells} cells`)
  const opening = levels.find((level) => level.count <= limits.defaultCells) ?? levels[levels.length - 1]
  return { bounds, levels, defaultDetail: opening.block }
}

// The level of a Detail, if the body has one
export const levelOf = (levels: Levels, detail: Detail) => levels.find((level) => level.block === detail)
