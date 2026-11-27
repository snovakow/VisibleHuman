import type { Triple } from '../volume/format.ts'
import type { Placement } from './pose.ts'
import { chainNames, jointNames } from './rig.ts'
import { noChain, type RigCells, type RigGrid } from './rigFile.ts'

// Which joint each cell of the rig file moves with alone, for the styles that read the body point by point and move
// every point rigidly with one joint: the cell's first joint, which takes the greater share of its flesh, as no cell's
// share falls below a half. Packed with the cell's chain into the byte a shader fetches, and gathered into each joint's
// box, the cells it owns, so that a ray can tell which joints it may meet before it reads a cell. Pure, so the tests
// run it

// The owner byte: the joint's index in jointNames in its low five bits and the chain's in chainNames in its high three,
// each field's highest code for none, where the cell lies beyond the body's reach
const jointBits = 5
export const noOwnerJoint = (1 << jointBits) - 1
export const noOwnerChain = (1 << (8 - jointBits)) - 1

export const ownerJoint = (byte: number) => byte & noOwnerJoint
export const ownerChain = (byte: number) => byte >> jointBits

// The joint a cell moves with, or −1 beyond the body's reach. The file names a first joint there too, which no reader
// takes, so the chain decides
export function ownerOf(cells: Pick<RigCells, 'chain' | 'jointA'>, cell: number): number {
  return cells.chain[cell] === noChain ? -1 : cells.jointA[cell]
}

// Every cell's owner byte, in the file's index order
export function ownerBytes(cells: Pick<RigCells, 'chain' | 'jointA'>): Uint8Array<ArrayBuffer> {
  if (jointNames.length > noOwnerJoint || chainNames.length > noOwnerChain) throw new Error('The owner byte has no room for every joint and chain')
  const bytes = new Uint8Array(cells.chain.length)
  for (let n = 0; n < bytes.length; n++) {
    const chain = cells.chain[n]
    bytes[n] = chain === noChain ? noOwnerJoint | (noOwnerChain << jointBits) : cells.jointA[n] | (chain << jointBits)
  }
  return bytes
}

// The lowest and highest cell, along i, j and k, of those a joint owns
export interface CellBox {
  low: Triple
  high: Triple
}

// Each joint's cells' box, in jointNames' order, or none for a joint that owns no cell
export function jointCellBoxes(file: RigGrid & { cells: Pick<RigCells, 'chain' | 'jointA'> }): (CellBox | null)[] {
  const [nx, ny, nz] = file.size
  const low = jointNames.map(() => [Infinity, Infinity, Infinity])
  const high = jointNames.map(() => [-Infinity, -Infinity, -Infinity])
  for (let k = 0, n = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++, n++) {
        const joint = ownerOf(file.cells, n)
        if (joint < 0) continue
        const l = low[joint]
        const h = high[joint]
        if (i < l[0]) l[0] = i
        if (i > h[0]) h[0] = i
        if (j < l[1]) l[1] = j
        if (j > h[1]) h[1] = j
        if (k < l[2]) l[2] = k
        if (k > h[2]) h[2] = k
      }
    }
  }
  return jointNames.map((_, joint) => {
    const [li, lj, lk] = low[joint]
    const [hi, hj, hk] = high[joint]
    return li > hi ? null : { low: [li, lj, lk], high: [hi, hj, hk] }
  })
}

// A box in the scene, as its lowest and highest corners along x, y and z
export interface SceneBox {
  min: Triple
  max: Triple
}

// Each joint's box in the scene of a level placed as given, where the scan holds the body: the whole of every cell it
// owns, since a point is read at its nearest cell, clipped to the body's bounds, given as their half extents about the
// scene's origin, since nothing outside them is drawn; none where nothing is left
export function jointSceneBoxes(grid: RigGrid, boxes: readonly (CellBox | null)[], placement: Placement, half: Triple): (SceneBox | null)[] {
  const axes = [placement.axes.x, placement.axes.y, placement.axes.z]
  return boxes.map((box) => {
    if (!box) return null
    const min: number[] = []
    const max: number[] = []
    for (let scene = 0; scene < 3; scene++) {
      const { source, sign } = axes[scene]
      // The cells' outer faces in the source frame, then in the scene, where an axis that runs against its source swaps
      // which is the lower
      const from = grid.origin[source] + (box.low[source] - 0.5) * grid.spacing[source]
      const to = grid.origin[source] + (box.high[source] + 0.5) * grid.spacing[source]
      const a = sign * (from - placement.origin[source]) - placement.center[scene]
      const b = sign * (to - placement.origin[source]) - placement.center[scene]
      min[scene] = Math.max(Math.min(a, b), -half[scene])
      max[scene] = Math.min(Math.max(a, b), half[scene])
      if (min[scene] > max[scene]) return null
    }
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
  })
}
