import type { Placement } from '../rig/pose.ts'
import { noChain } from '../rig/rigFile.ts'
import { chainsOnGrid, sideMeasure, type RigGridCells, type SourceGrid } from '../rig/sampling.ts'
import type { Triple } from '../volume/format.ts'

// The cap on a posed body's cut: the section through the body where the scan holds it, which the pose then carries as
// it carries the skin. A cut's plane runs through limbs that the pose turns apart, so the section is a grid in the
// plane as it lies in the scan, one for each chain the plane meets, each vertex skinned as its own chain's flesh. Every
// vertex carries its chain's side of the walls' measure as the skin's mesher reads it, so that the pixel stage can end
// each chain's section where its flesh meets another's across a wall, as the coverage ends it at the skin; where a limb
// is one flesh with the trunk, about a shoulder or a hip, its section meets the trunk's along the cells' border, each
// side's measure the other's complement there, and the vertices about the border skinned as their own cell's flesh in
// both, so that the pose carries the two alike and they leave no gap. The grid's vertices are the rig file's cells'
// centres in the plane, where the file's chains are its own. Pure, so the tests prove it

// A chain's section in a cut's plane
export interface CapGrid {
  // The chain, by its index in chainNames
  chain: number
  // Each vertex's place in the scene, at rest, and the plane's normal there
  positions: Float32Array<ArrayBuffer>
  normals: Float32Array<ArrayBuffer>
  // Two triangles for each cell of the grid where the chain's measure reaches the middle at a corner
  indices: Uint32Array<ArrayBuffer>
  // Each vertex's measure on the chain's side, from 0 to 255 as the wall field's byte: above the middle in the chain's
  // flesh, crossing it at a wall or where the chain's flesh gives way to another's
  measures: Float32Array<ArrayBuffer>
  // The chain each vertex is skinned as: the grid's own, or, at a vertex wholly another chain's flesh, where the
  // grid's measure is 0 and that chain's is whole, that chain's, as its own grid skins it
  sides: Uint8Array<ArrayBuffer>
}

export interface CapInput {
  file: RigGridCells
  placement: Placement
  // The scene's axis the plane runs across, 0 for x, 1 for y, 2 for z, and where it lies along it, in the scene's
  // millimetres
  axis: 0 | 1 | 2
  level: number
}

// The measure's middle, which a chain's section shows from: halfway between the bytes a wall's two sides read, so that
// the two sides' sections meet exactly
export const capMiddle = 127.5

const sceneAxisNames = ['x', 'y', 'z'] as const

export function capGrids({ file, placement, axis, level }: CapInput): CapGrid[] {
  const { source: normalAxis, sign } = placement.axes[sceneAxisNames[axis]]
  // The plane in the source frame: the cells' centres along the two other axes, at the plane's level along its own
  const size: [number, number, number] = [file.size[0], file.size[1], file.size[2]]
  const origin: [number, number, number] = [file.origin[0], file.origin[1], file.origin[2]]
  size[normalAxis] = 1
  origin[normalAxis] = placement.origin[normalAxis] + sign * (level + placement.center[axis])
  const plane: SourceGrid = { size, spacing: file.spacing, origin }
  const { chain, other, wall } = chainsOnGrid(file, plane)
  const count = size[0] * size[1] * size[2]

  // The two axes the plane spans, in the source frame, and the step between neighbours along each
  const [u, v] = [0, 1, 2].filter((n) => n !== normalAxis)
  const strides = [1, size[0], size[0] * size[1]]
  const [nu, nv] = [size[u], size[v]]
  const [su, sv] = [strides[u], strides[v]]

  // Where a vertex lies in the scene: along each scene axis, a step for each cell along its source axis from the
  // plane's first vertex, which is where the source frame's origin puts it
  const sceneSteps = sceneAxisNames.map((name) => {
    const { source, sign: towards } = placement.axes[name]
    return { source, step: towards * file.spacing[source], first: towards * (origin[source] - placement.origin[source]) }
  })
  const firstAt = sceneAxisNames.map((_, at) => sceneSteps[at].first - placement.center[at])

  // The chains the plane meets: those a vertex lies in, or lies across a wall from
  const met = new Set<number>()
  for (let n = 0; n < count; n++) {
    if (chain[n] !== noChain) met.add(chain[n])
    if (other[n] !== noChain) met.add(other[n])
  }

  const normal: Triple = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]
  const grids: CapGrid[] = []
  const measure = new Float32Array(count)
  const index = new Int32Array(count)
  // Whether the grid's cell at a and b along the plane's two axes is drawn for the side: where a corner's measure is
  // past the middle, so some of it is the side's, and no corner lies beyond the body's reach. A corner with no chain
  // lies in the air, which the rig spreads two cells into, so the whole cell is air, where the coverage ends the
  // section; and it has no flesh to be skinned as, so the pose would stretch the cell from it to the body
  const drawn = (p: number) => {
    const q = p + su
    const r = q + sv
    const t = p + sv
    if (Math.max(measure[p], measure[q], measure[r], measure[t]) <= capMiddle) return false
    return chain[p] !== noChain && chain[q] !== noChain && chain[r] !== noChain && chain[t] !== noChain
  }
  for (const side of [...met].sort((a, b) => a - b)) {
    for (let n = 0; n < count; n++) measure[n] = sideMeasure(chain[n], other[n], wall[n], side)
    // Counted first, then written, numbering the vertices in the plane's order
    index.fill(-1)
    let cells = 0
    for (let b = 0; b < nv - 1; b++) {
      for (let a = 0; a < nu - 1; a++) {
        const p = a * su + b * sv
        if (!drawn(p)) continue
        cells++
        index[p] = index[p + su] = index[p + su + sv] = index[p + sv] = 0
      }
    }
    if (cells === 0) continue
    let vertices = 0
    for (let n = 0; n < count; n++) if (index[n] === 0) index[n] = ++vertices
    const positions = new Float32Array(vertices * 3)
    const normals = new Float32Array(vertices * 3)
    const measures = new Float32Array(vertices)
    const sides = new Uint8Array(vertices)
    const cell = [0, 0, 0]
    for (let n = 0; n < count; n++) {
      const at = index[n] - 1
      if (at < 0) continue
      cell[0] = n % size[0]
      cell[1] = Math.floor(n / size[0]) % size[1]
      cell[2] = Math.floor(n / (size[0] * size[1]))
      for (let scene = 0; scene < 3; scene++) {
        const { source, step } = sceneSteps[scene]
        positions[at * 3 + scene] = firstAt[scene] + (source === normalAxis ? 0 : cell[source] * step)
        normals[at * 3 + scene] = normal[scene]
      }
      measures[at] = measure[n]
      sides[at] = measure[n] === 0 ? wholeChain(chain[n], other[n], wall[n], side) : side
    }
    const indices = new Uint32Array(cells * 6)
    let corner = 0
    for (let b = 0; b < nv - 1; b++) {
      for (let a = 0; a < nu - 1; a++) {
        const p = a * su + b * sv
        if (!drawn(p)) continue
        const vp = index[p] - 1
        const vr = index[p + su + sv] - 1
        indices[corner++] = vp
        indices[corner++] = index[p + su] - 1
        indices[corner++] = vr
        indices[corner++] = vp
        indices[corner++] = vr
        indices[corner++] = index[p + sv] - 1
      }
    }
    grids.push({ chain: side, positions, normals, indices, measures, sides })
  }
  return grids
}

// The chain whose flesh a place wholly is, by the walls' measure, among its own chain and the one across its wall, or
// the side given where neither is: where a section's grid meets another's away from any wall, about a shoulder or a
// hip, or where a wall's field runs out beside another chain's flesh, both grids then skin their shared vertices alike
function wholeChain(chain: number, other: number, wall: number, side: number) {
  if (chain !== noChain && sideMeasure(chain, other, wall, chain) === 255) return chain
  if (other !== noChain && sideMeasure(chain, other, wall, other) === 255) return other
  return side
}

// A cut's sections as one mesh, each vertex with the chain it's skinned as
export function capMesh(input: CapInput) {
  const grids = capGrids(input)
  const vertices = grids.reduce((sum, grid) => sum + grid.measures.length, 0)
  const triangles = grids.reduce((sum, grid) => sum + grid.indices.length, 0)
  const positions = new Float32Array(vertices * 3)
  const normals = new Float32Array(vertices * 3)
  const measures = new Float32Array(vertices)
  const sides = new Uint8Array(vertices)
  const indices = new Uint32Array(triangles)
  let vertex = 0
  let corner = 0
  for (const grid of grids) {
    positions.set(grid.positions, vertex * 3)
    normals.set(grid.normals, vertex * 3)
    measures.set(grid.measures, vertex)
    sides.set(grid.sides, vertex)
    for (const at of grid.indices) indices[corner++] = vertex + at
    vertex += grid.measures.length
  }
  return { positions, normals, indices, measures, sides, chains: grids.length }
}
