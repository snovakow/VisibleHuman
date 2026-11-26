import type { Triple } from '../volume/format.ts'
import { noChain, wallMiddle, type RigCells, type RigFile } from './rigFile.ts'

// Reading the rig file at a place: its skinning, blended from the cells about the place, and its chains and walls laid
// onto another grid, a mesh's or a level's. Shared by the warp, the mesher and the styles, so all read the file alike.
// Pure, so the worker and the tests run it

// How a place's flesh is skinned: up to four joints, by their index in jointNames, and their shares, which make a whole.
// A cell gives two joints and a share; a place between cells takes the eight cells about it, each's joints weighted by
// how near the place lies to it, as a filtered read would, so that a point's skinning, and with it the pose's warp of
// the body, runs on smoothly from one cell to the next with no step where their shares differ
export interface Skinning {
  joints: number[]
  weights: number[]
}

// Most joints a place follows, as three's skinning takes them
export const mostJoints = 4

// The rig file's cells and their grid, as much of the file as the skinning reads
export type RigGridCells = Pick<RigFile, 'size' | 'spacing' | 'origin'> & { cells: RigCells }

// The joints and shares a place's eight cells give, gathered before they're ranked: two a cell
const gatheredJoints = new Int32Array(16)
const gatheredShares = new Float64Array(16)

// The skinning at a place in the source frame, from the rig file's cells about it, or none where no cell about it is
// in the body's reach. Given a side, a chain, the place is skinned as that chain's flesh: a cell of that chain gives its
// own joints, a cell across a wall from it gives the joints of that chain's flesh beside the wall, which it keeps for
// this, and a cell of another chain with no wall between them, as in the joined flesh about a shoulder, gives its own.
// So a vertex on one side of a wall follows its own side, however near the other side's cells lie. A place on a wall's
// face is its side's flesh alone: there a cell of a third chain, which records a wall to another, gives nothing, as
// where a hand lay in the crease between a thigh and the trunk, unless no cell about it is of the side or beside it
export function skinningAtSource(file: RigGridCells, source: readonly number[], side?: number, onWall = false): Skinning | null {
  const { size, spacing, origin, cells } = file
  const [nx, ny, nz] = size
  const gx = (source[0] - origin[0]) / spacing[0]
  const gy = (source[1] - origin[1]) / spacing[1]
  const gz = (source[2] - origin[2]) / spacing[2]
  const bx = Math.floor(gx)
  const by = Math.floor(gy)
  const bz = Math.floor(gz)
  const fx = gx - bx
  const fy = gy - by
  const fz = gz - bz
  let gathered = 0
  let total = 0
  for (let corner = 0; corner < 8; corner++) {
    const ox = corner & 1
    const oy = (corner >> 1) & 1
    const oz = (corner >> 2) & 1
    const i = bx + ox
    const j = by + oy
    const k = bz + oz
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue
    const n = i + nx * (j + ny * k)
    if (cells.chain[n] === noChain) continue
    const near = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz)
    if (near === 0) continue
    const across = side !== undefined && cells.chain[n] !== side && cells.otherChain[n] === side
    if (onWall && side !== undefined && cells.chain[n] !== side && !across) continue
    const share = (across ? cells.otherWeight[n] : cells.weight[n]) / 255
    gatheredJoints[gathered] = across ? cells.otherJointA[n] : cells.jointA[n]
    gatheredShares[gathered++] = near * share
    gatheredJoints[gathered] = across ? cells.otherJointB[n] : cells.jointB[n]
    gatheredShares[gathered++] = near * (1 - share)
    total += near
  }
  if (total === 0) return onWall ? skinningAtSource(file, source, side) : null
  // Each joint's shares summed, then the largest few kept and made a whole again
  const joints: number[] = []
  const weights: number[] = []
  for (let g = 0; g < gathered; g++) {
    if (gatheredShares[g] <= 0) continue
    const at = joints.indexOf(gatheredJoints[g])
    if (at >= 0) weights[at] += gatheredShares[g]
    else {
      joints.push(gatheredJoints[g])
      weights.push(gatheredShares[g])
    }
  }
  if (joints.length > mostJoints) {
    const order = joints.map((_, n) => n).sort((a, b) => weights[b] - weights[a]).slice(0, mostJoints)
    const keptJoints = order.map((n) => joints[n])
    const keptWeights = order.map((n) => weights[n])
    joints.length = 0
    weights.length = 0
    joints.push(...keptJoints)
    weights.push(...keptWeights)
  }
  let kept = 0
  for (const weight of weights) kept += weight
  for (let n = 0; n < weights.length; n++) weights[n] /= kept
  return { joints, weights }
}

// The cell nearest a place in the source frame, or −1 outside the grid
export function nearestCell(file: Pick<RigFile, 'size' | 'spacing' | 'origin'>, source: readonly number[]): number {
  const [nx, ny, nz] = file.size
  const [i, j, k] = [0, 1, 2].map((axis) => Math.round((source[axis] - file.origin[axis]) / file.spacing[axis]))
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1
  return i + nx * (j + ny * k)
}

// A grid in the source frame: its size, its spacing and the centre of its cell (0, 0, 0), in millimetres
export interface SourceGrid {
  size: Triple
  spacing: Triple
  origin: Triple
}

export interface ChainsOnGrid {
  // Each cell's chain and the chain across its nearest wall, from the rig file's nearest cell
  chain: Uint8Array
  other: Uint8Array
  // The wall field, read between the rig file's cells as a filtered read would, among the cells that record the same
  // pair of chains as the nearest; wallMiddle where the nearest records no wall
  wall: Uint8Array
}

// How far a place lies into a side's flesh by the walls' measure, as the byte the wall field holds, for a place of the
// chain given, recording the chain across its nearest wall, with the wall field read there: in the side's own flesh
// with no wall near, 255; in its flesh or across from it near a wall, the field signed to the side, crossing
// wallMiddle at the wall; in the flesh of another chain with no wall to the side, as the trunk's in the joined flesh
// about a shoulder, 0, none of the side's
export function sideMeasure(chain: number, other: number, wall: number, side: number) {
  if (chain === side) return other === noChain ? 255 : side < other ? wall : 255 - wall
  if (other === side) return side < chain ? wall : 255 - wall
  return 0
}

// The rig file's chains and walls laid onto another grid, a mesh's or a finer level's, at each of its cells' centres.
// On the rig file's own grid, as the default level's skin at its finest Detail is meshed on, they're the file's own
export function chainsOnGrid(file: RigGridCells, grid: SourceGrid): ChainsOnGrid {
  const same = [0, 1, 2].every(
    (axis) => grid.size[axis] === file.size[axis] && Math.abs(grid.spacing[axis] - file.spacing[axis]) < 1e-4 && Math.abs(grid.origin[axis] - file.origin[axis]) < 1e-3,
  )
  if (same) return { chain: file.cells.chain.slice(), other: file.cells.otherChain.slice(), wall: file.cells.wall.slice() }
  const [nx, ny, nz] = grid.size
  const count = nx * ny * nz
  const chain = new Uint8Array(count).fill(noChain)
  const other = new Uint8Array(count).fill(noChain)
  const wall = new Uint8Array(count).fill(wallMiddle)
  const { cells } = file
  const [fx, fy, fz] = file.size
  for (let k = 0, n = 0; k < nz; k++) {
    const gz = (grid.origin[2] + k * grid.spacing[2] - file.origin[2]) / file.spacing[2]
    const rz = Math.round(gz)
    for (let j = 0; j < ny; j++) {
      const gy = (grid.origin[1] + j * grid.spacing[1] - file.origin[1]) / file.spacing[1]
      const ry = Math.round(gy)
      for (let i = 0; i < nx; i++, n++) {
        const gx = (grid.origin[0] + i * grid.spacing[0] - file.origin[0]) / file.spacing[0]
        const rx = Math.round(gx)
        if (rx < 0 || ry < 0 || rz < 0 || rx >= fx || ry >= fy || rz >= fz) continue
        const nearest = rx + fx * (ry + fy * rz)
        chain[n] = cells.chain[nearest]
        other[n] = cells.otherChain[nearest]
        if (other[n] === noChain) continue
        // The wall field between the eight cells about the place, those that record the same pair
        const pairLow = Math.min(chain[n], other[n])
        const pairHigh = Math.max(chain[n], other[n])
        const bx = Math.floor(gx)
        const by = Math.floor(gy)
        const bz = Math.floor(gz)
        let sum = 0
        let weights = 0
        for (let corner = 0; corner < 8; corner++) {
          const ox = corner & 1
          const oy = (corner >> 1) & 1
          const oz = (corner >> 2) & 1
          const a = bx + ox
          const b = by + oy
          const c = bz + oz
          if (a < 0 || b < 0 || c < 0 || a >= fx || b >= fy || c >= fz) continue
          const m = a + fx * (b + fy * c)
          if (Math.min(cells.chain[m], cells.otherChain[m]) !== pairLow || Math.max(cells.chain[m], cells.otherChain[m]) !== pairHigh) continue
          const near = (ox ? gx - bx : 1 - (gx - bx)) * (oy ? gy - by : 1 - (gy - by)) * (oz ? gz - bz : 1 - (gz - bz))
          sum += near * cells.wall[m]
          weights += near
        }
        wall[n] = weights > 0 ? Math.round(sum / weights) : cells.wall[nearest]
      }
    }
  }
  return { chain, other, wall }
}
