import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js'
import { noChain, wallMiddle } from '../rig/rigFile.ts'
import { mappingOf, MeshBuilder, type IsosurfaceInput, type IsosurfaceMesh } from './marchingCubes.ts'

// The skin meshed for a posed body: as meshIsosurface meshes it, from the coverage at the body's isolevel, but parted
// along the walls, where a limb lies against the trunk or another limb in the scan, so that each side has its own
// surface there to carry apart. Away from any wall a cube is meshed as meshIsosurface meshes it, so the skin lies
// where the unposed skin does. A cube within a wall's reach is meshed once for each chain about it, from the lesser of
// the coverage and that chain's wall field, which crosses the isolevel at the wall: each side's skin ends there, and a
// wall face closes it, lying on the other side's at rest. A wall face is told apart from the skin by what's beyond it:
// the skin's outside is air, a wall face's another chain's flesh, or, where a wall ends in the joined flesh about a
// shoulder or a hip, the trunk's, whose faces never part. Each vertex says which chain's side it's on, so its skinning
// can follow that side alone. Pure, so a worker runs it and the tests prove it

export interface RiggedInput extends IsosurfaceInput {
  // Per voxel of the field's grid: its chain, the chain across its nearest wall, and the wall field, as the rig file
  // gives them laid onto this grid
  chain: Uint8Array
  other: Uint8Array
  wall: Uint8Array
}

export interface RiggedMesh extends IsosurfaceMesh {
  // Per vertex: the chain whose side it lies on, and 1 where it lies on a wall rather than the skin
  sides: Uint8Array<ArrayBuffer>
  walls: Uint8Array<ArrayBuffer>
}

// The isolevel the walls' field and the coverage both cross: the wall's middle, the body's coverage
const iso = wallMiddle

export function meshRigged(input: RiggedInput): RiggedMesh {
  const { field, size, spacing, origin, isolevel, axes, colors, chain, other, wall } = input
  if (isolevel !== iso) throw new Error(`A rigged mesh is the skin's, at the coverage's ${iso}, not at ${isolevel}`)
  const [nx, ny, nz] = size
  const nxy = nx * ny
  const count = nxy * nz
  for (const [name, block] of [
    ['field', field],
    ['chain', chain],
    ['other', other],
    ['wall', wall],
  ] as const) {
    if (block.length !== count) throw new Error(`The ${name} has ${block.length} values, but a ${size.join(' × ')} grid needs ${count}`)
  }
  const { order, reversed } = mappingOf(axes)
  const builder = new MeshBuilder(colors !== undefined)
  let sides = new Uint8Array(1 << 12)
  let walls = new Uint8Array(1 << 12)

  // The field a side meshes from at a voxel, less the isolevel: the coverage, and where the voxel is body near a wall,
  // the lesser of it and the side's wall field. A voxel of the side's chain that records a wall takes the field on its
  // own side of the wall; one across the wall from the side, the field on the far side, below the isolevel; one of
  // another chain with no wall to the side, as the trunk's in the joined flesh, nothing of the side's. The air is the
  // air to every side, so the skin's crossing beside a wall lies where the plain coverage puts it. A side of none is the
  // plain coverage, for a cube with no wall about it
  const plain = 255
  const valueAt = (n: number, side: number): number => {
    const coverage = field[n] - iso
    if (side === plain || coverage < 0) return coverage
    const own = chain[n]
    const across = other[n]
    let margin: number
    if (own === side) margin = across === noChain ? 255 - iso : (side < across ? wall[n] : 255 - wall[n]) - iso
    else if (across === side) margin = (side < own ? wall[n] : 255 - wall[n]) - iso
    else margin = -iso
    return Math.min(coverage, margin)
  }

  // The vertices made so far. Most lie on an edge that's plain to the side meshing it: neither end records a wall, and
  // each end is air or the side's own flesh, so the side reads the plain coverage there and the vertex is the plain
  // mesh's. Those are cached as meshIsosurface caches its own, in the layers of cubes about the current one, so a plain
  // cube and a side's cube beside it share them. The rest, on a wall's edges, are cached by their edge and their side:
  // an edge's lower voxel's index times three plus its axis, times eight plus the side's chain
  const xEdges = [new Int32Array(nxy).fill(-1), new Int32Array(nxy).fill(-1)]
  const yEdges = [new Int32Array(nxy).fill(-1), new Int32Array(nxy).fill(-1)]
  const zEdges = new Int32Array(nxy)
  const made = new Map<number, number>()
  const isPlainFor = (n: number, side: number) => other[n] === noChain && (side === plain || field[n] < iso || chain[n] === side)
  const gradient = [0, 0, 0]
  const point = [0, 0, 0]
  const normal = [0, 0, 0]
  const slopeAt = (n: number, at: number, length: number, stride: number, step: number, side: number) => {
    const ahead = at < length - 1 ? 1 : 0
    const behind = at > 0 ? 1 : 0
    return (valueAt(n + ahead * stride, side) - valueAt(n - behind * stride, side)) / ((ahead + behind) * step)
  }
  const gradientAt = (n: number, x: number, y: number, z: number, side: number) => {
    gradient[0] = slopeAt(n, x, nx, 1, spacing[0], side)
    gradient[1] = slopeAt(n, y, ny, nx, spacing[1], side)
    gradient[2] = slopeAt(n, z, nz, nxy, spacing[2], side)
  }
  const makeVertex = (a: number, b: number, x: number, y: number, z: number, axis: 0 | 1 | 2, side: number, owner: number): number => {
    const fa = valueAt(a, side)
    const fb = valueAt(b, side)
    const t = fa === fb ? 0.5 : fa / (fa - fb)
    gradientAt(a, x, y, z, side)
    const gx = gradient[0]
    const gy = gradient[1]
    const gz = gradient[2]
    gradientAt(b, x + (axis === 0 ? 1 : 0), y + (axis === 1 ? 1 : 0), z + (axis === 2 ? 1 : 0), side)
    point[0] = -(gx + t * (gradient[0] - gx))
    point[1] = -(gy + t * (gradient[1] - gy))
    point[2] = -(gz + t * (gradient[2] - gz))
    const length = Math.hypot(point[0], point[1], point[2]) || 1
    for (let scene = 0; scene < 3; scene++) normal[scene] = (order[scene].sign * point[order[scene].source]) / length
    point[0] = x + (axis === 0 ? t : 0)
    point[1] = y + (axis === 1 ? t : 0)
    point[2] = z + (axis === 2 ? t : 0)
    const position = (scene: number) => {
      const { source, sign } = order[scene]
      return origin[scene] + sign * point[source] * spacing[source]
    }
    const vertex = builder.addVertex(position(0), position(1), position(2), normal[0], normal[1], normal[2])
    if (colors) {
      const ca = a * 3
      const cb = b * 3
      const aColoured = (colors[ca] | colors[ca + 1] | colors[ca + 2]) !== 0
      const bColoured = (colors[cb] | colors[cb + 1] | colors[cb + 2]) !== 0
      const share = aColoured && bColoured ? t : bColoured ? 1 : 0
      builder.setColour(
        vertex,
        Math.round(colors[ca] + share * (colors[cb] - colors[ca])),
        Math.round(colors[ca + 1] + share * (colors[cb + 1] - colors[ca + 1])),
        Math.round(colors[ca + 2] + share * (colors[cb + 2] - colors[ca + 2])),
      )
    }
    if (vertex >= sides.length) {
      sides = grown(sides)
      walls = grown(walls)
    }
    sides[vertex] = owner
    // On a wall where what lies beyond is body, cut off by the side's field rather than the coverage
    const outside = fa >= 0 ? b : a
    walls[vertex] = field[outside] >= iso ? 1 : 0
    return vertex
  }
  const vertexOn = (cache: Int32Array, x: number, y: number, z: number, axis: 0 | 1 | 2, side: number): number => {
    const a = x + nx * (y + ny * z)
    const b = axis === 0 ? a + 1 : axis === 1 ? a + nx : a + nxy
    if (isPlainFor(a, side) && isPlainFor(b, side)) {
      const slot = y * nx + x
      if (cache[slot] < 0) {
        const inside = field[a] >= iso ? a : b
        cache[slot] = makeVertex(a, b, x, y, z, axis, plain, chain[inside])
      }
      return cache[slot]
    }
    const key = (a * 3 + axis) * 8 + side
    const found = made.get(key)
    if (found !== undefined) return found
    const vertex = makeVertex(a, b, x, y, z, axis, side, side)
    made.set(key, vertex)
    return vertex
  }

  const corners = new Int32Array(8)
  const cubeEdges = new Int32Array(12)
  const sidesHere = new Set<number>()
  const plainSides = [plain]
  for (let z = 0; z < nz - 1; z++) {
    const slab = z & 1
    xEdges[slab ^ 1].fill(-1)
    yEdges[slab ^ 1].fill(-1)
    zEdges.fill(-1)
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const base = x + nx * (y + ny * z)
        corners[0] = base
        corners[1] = base + 1
        corners[2] = base + 1 + nx
        corners[3] = base + nx
        corners[4] = base + nxy
        corners[5] = base + 1 + nxy
        corners[6] = base + 1 + nx + nxy
        corners[7] = base + nx + nxy
        // A cube with no corner that records a wall is meshed once, plain; one with, once for each chain about it
        let walled = false
        for (let corner = 0; corner < 8 && !walled; corner++) walled = other[corners[corner]] !== noChain
        let meshed = plainSides
        if (walled) {
          sidesHere.clear()
          for (const n of corners) {
            if (chain[n] !== noChain) sidesHere.add(chain[n])
            if (other[n] !== noChain) sidesHere.add(other[n])
          }
          meshed = [...sidesHere]
        }
        for (const side of meshed) {
          let cube = 0
          if (side === plain) {
            for (let corner = 0; corner < 8; corner++) if (field[corners[corner]] < iso) cube |= 1 << corner
          } else {
            for (let corner = 0; corner < 8; corner++) if (valueAt(corners[corner], side) < 0) cube |= 1 << corner
          }
          const edges = edgeTable[cube]
          if (edges === 0) continue
          if (edges & 1) cubeEdges[0] = vertexOn(xEdges[slab], x, y, z, 0, side)
          if (edges & 2) cubeEdges[1] = vertexOn(yEdges[slab], x + 1, y, z, 1, side)
          if (edges & 4) cubeEdges[2] = vertexOn(xEdges[slab], x, y + 1, z, 0, side)
          if (edges & 8) cubeEdges[3] = vertexOn(yEdges[slab], x, y, z, 1, side)
          if (edges & 16) cubeEdges[4] = vertexOn(xEdges[slab ^ 1], x, y, z + 1, 0, side)
          if (edges & 32) cubeEdges[5] = vertexOn(yEdges[slab ^ 1], x + 1, y, z + 1, 1, side)
          if (edges & 64) cubeEdges[6] = vertexOn(xEdges[slab ^ 1], x, y + 1, z + 1, 0, side)
          if (edges & 128) cubeEdges[7] = vertexOn(yEdges[slab ^ 1], x, y, z + 1, 1, side)
          if (edges & 256) cubeEdges[8] = vertexOn(zEdges, x, y, z, 2, side)
          if (edges & 512) cubeEdges[9] = vertexOn(zEdges, x + 1, y, z, 2, side)
          if (edges & 1024) cubeEdges[10] = vertexOn(zEdges, x + 1, y + 1, z, 2, side)
          if (edges & 2048) cubeEdges[11] = vertexOn(zEdges, x, y + 1, z, 2, side)
          for (let t = cube * 16; triTable[t] !== -1; t += 3) {
            const a = cubeEdges[triTable[t]]
            const b = cubeEdges[triTable[t + 1]]
            const c = cubeEdges[triTable[t + 2]]
            if (reversed) builder.addTriangle(a, c, b)
            else builder.addTriangle(a, b, c)
          }
        }
      }
    }
  }
  const mesh = builder.finish()
  const vertices = mesh.positions.length / 3
  return { ...mesh, sides: sides.slice(0, vertices), walls: walls.slice(0, vertices) }
}

function grown(array: Uint8Array<ArrayBuffer>) {
  const larger = new Uint8Array(array.length * 2)
  larger.set(array)
  return larger
}
