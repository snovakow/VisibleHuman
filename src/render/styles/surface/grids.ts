import { blockGrid, type BlockGrid } from '../../../volume/blockGrid.ts'
import { scenePosition, type Triple, type Volume } from '../../../volume/format.ts'
import { labelOf, type Bounds } from '../../../volume/levels.ts'

// The grids the surface's meshes are built on: the volume's voxels merged into blocks, as the splats' levels are

// The block grids of each volume shown, by block, built on the first ask: the skin, the shell and the bone's colours
// share them, and a Detail shown before is ready at once
const blockGrids = new WeakMap<Volume, Map<number, BlockGrid>>()

export function blockGridOf(volume: Volume, block: number) {
  let grids = blockGrids.get(volume)
  if (!grids) {
    grids = new Map()
    blockGrids.set(volume, grids)
  }
  let grid = grids.get(block)
  if (!grid) {
    const start = performance.now()
    grid = blockGrid(volume, block)
    grids.set(block, grid)
    console.info(
      `VisibleHuman: the block grid at ${labelOf(volume, block)}, ${grid.size.join(' × ')} blocks, built in ` +
        `${Math.round(performance.now() - start)} ms`,
    )
  }
  return grid
}

// Where a block grid sits in the scene, for the worker: its blocks' size and spacing, the scene's position of block
// (0, 0, 0), which is its centre's place in the volume's voxels carried through the volume's axes and centred on the
// body's bounds, the axes, and the blocks' colours
export function gridOf(volume: Volume, grid: BlockGrid, bounds: Bounds) {
  const at = scenePosition(volume, ...grid.first)
  const origin: Triple = [at[0] - bounds.center[0], at[1] - bounds.center[1], at[2] - bounds.center[2]]
  return { size: grid.size, spacing: grid.spacing, origin, axes: volume.axes, colors: grid.colors }
}
