import { isBodyVoxel, type Triple, type Volume } from './format.ts'
import { extentOf } from './levels.ts'

// The body on the grid of a splat level's blocks, dense where the level is sparse: every block of block × block ×
// block voxels gets the mean coverage over all the voxels it spans, body or not, and the mean colour over those of
// them that carry colour, so that a surface meshed from it at the body's coverage lies where that level's splats do.
// The blocks start at the body's lowest voxel along each axis, as the levels' do, and one block more lies beyond the
// body's on every side, all of whose voxels are outside the body, so that a surface meshed from the grid closes there

export interface BlockGrid {
  // The voxels each block spans along each axis
  block: number
  // The grid's size in blocks along i, j and k, and the spacing of the blocks' centres in millimetres
  size: Triple
  spacing: Triple
  // The centre of block (0, 0, 0) in the source frame, in millimetres, as the volume's origin is its voxel's
  origin: Triple
  // The same centre in the volume's voxels along i, j and k, which needn't be whole: where the grid sits on the volume's
  first: Triple
  // One byte per block in index order: the mean coverage of the voxels it spans, voxels past the volume's grid
  // counted as uncovered, so a block is body where the mean is at least the body's 128
  coverage: Uint8Array
  // R, G and B per block, interleaved: the mean colour of the voxels it spans that carry colour, body voxels and the
  // band dilated around them, and 0 where none does
  colors: Uint8Array
}

// A voxel carries colour where it's body or where the dilation gave it a colour of its body neighbours'; the rest of
// the grid is 0
const carriesColour = (coverage: number, r: number, g: number, b: number) => isBodyVoxel(coverage) || (r | g | b) !== 0

// Each voxel's block along one axis, or −1 where the voxel lies in no block: before the padding block, or past the last
function blocksAlong(voxels: number, start: number, block: number, blocks: number) {
  const of = new Int32Array(voxels)
  for (let voxel = 0; voxel < voxels; voxel++) {
    const at = Math.floor((voxel - start) / block)
    of[voxel] = voxel >= start && at < blocks ? at : -1
  }
  return of
}

// The volume's colour, R, G and B interleaved per voxel
function interleaved(volume: Volume) {
  const { red, green, blue } = volume
  const colors = new Uint8Array(red.length * 3)
  for (let n = 0, at = 0; n < red.length; n++, at += 3) {
    colors[at] = red[n]
    colors[at + 1] = green[n]
    colors[at + 2] = blue[n]
  }
  return colors
}

export function blockGrid(volume: Volume, block: number): BlockGrid {
  if (!Number.isInteger(block) || block < 1) throw new Error(`A block of ${block} voxels isn't a whole number of them`)
  // A block of one voxel is the voxel: the volume's own grid, margin and all, nothing averaged
  if (block === 1) {
    return {
      block,
      size: volume.size,
      spacing: volume.spacing,
      origin: volume.origin,
      first: [0, 0, 0],
      coverage: volume.coverage,
      colors: interleaved(volume),
    }
  }
  const [nx, ny, nz] = volume.size
  const { low, high } = extentOf(volume)
  // The body's blocks along each axis, as the level has them, and the padding block either side
  const sizeAlong = (axis: number) => Math.floor((high[axis] - low[axis]) / block) + 3
  const size: Triple = [sizeAlong(0), sizeAlong(1), sizeAlong(2)]
  // The first voxel of block 0, the padding block before the body's first, which may lie before the grid's first
  const start = (axis: number) => low[axis] - block
  const alongI = blocksAlong(nx, start(0), block, size[0])
  const alongJ = blocksAlong(ny, start(1), block, size[1])
  const alongK = blocksAlong(nz, start(2), block, size[2])

  const [bx, by, bz] = size
  const blocks = bx * by * bz
  const coverageSums = new Uint32Array(blocks)
  const colourSums = new Uint32Array(blocks * 3)
  const coloured = new Uint32Array(blocks)
  const { red, green, blue, coverage } = volume
  for (let k = 0; k < nz; k++) {
    const bk = alongK[k]
    if (bk < 0) continue
    for (let j = 0; j < ny; j++) {
      const bj = alongJ[j]
      if (bj < 0) continue
      const row = bx * (bj + by * bk)
      const voxelRow = nx * (j + ny * k)
      for (let i = 0; i < nx; i++) {
        const bi = alongI[i]
        if (bi < 0) continue
        const b = row + bi
        const n = voxelRow + i
        const covered = coverage[n]
        coverageSums[b] += covered
        const r = red[n]
        const g = green[n]
        const bl = blue[n]
        if (!carriesColour(covered, r, g, bl)) continue
        colourSums[b * 3] += r
        colourSums[b * 3 + 1] += g
        colourSums[b * 3 + 2] += bl
        coloured[b]++
      }
    }
  }

  // Voxels a block spans past the grid add nothing, so they count as uncovered and colourless
  const blockVoxels = block * block * block
  const gridCoverage = new Uint8Array(blocks)
  const colors = new Uint8Array(blocks * 3)
  for (let b = 0; b < blocks; b++) {
    gridCoverage[b] = Math.round(coverageSums[b] / blockVoxels)
    const n = coloured[b]
    if (n === 0) continue
    for (let c = 0; c < 3; c++) colors[b * 3 + c] = Math.round(colourSums[b * 3 + c] / n)
  }

  // Block 0's centre, in voxels: its first voxel plus half the block's span between its first and last voxel centres
  const first: Triple = [start(0) + (block - 1) / 2, start(1) + (block - 1) / 2, start(2) + (block - 1) / 2]
  const { spacing } = volume
  return {
    block,
    size,
    spacing: [spacing[0] * block, spacing[1] * block, spacing[2] * block],
    origin: [
      volume.origin[0] + first[0] * spacing[0],
      volume.origin[1] + first[1] * spacing[1],
      volume.origin[2] + first[2] * spacing[2],
    ],
    first,
    coverage: gridCoverage,
    colors,
  }
}
