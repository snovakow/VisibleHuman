import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js'
import { noChain, wallMiddle } from '../rig/rigFile.ts'
import type { SceneAxes, Triple } from '../volume/format.ts'
import { mappingOf, MeshBuilder, type IsosurfaceInput, type IsosurfaceMesh } from './marchingCubes.ts'

// The skin meshed for a posed body: as meshIsosurface meshes it, from the coverage at the body's isolevel, but parted
// along the walls, where a limb lies against the trunk or another limb in the scan, so that each side has its own
// surface there to carry apart. Away from any wall a cube is meshed as meshIsosurface meshes it, so the skin lies
// where the unposed skin does. A cube within a wall's reach is meshed once for each chain about it, from the lesser of
// the coverage and that chain's wall field, which crosses the isolevel at the wall: each side's skin ends there, and a
// wall face closes it, lying on the other side's at rest. A wall face is told apart from the skin by what's beyond it:
// the skin's outside is air, a wall face's another chain's flesh, or, where a wall ends in the joined flesh about a
// shoulder or a hip, the trunk's, whose faces never part. Each vertex says which chain's side it's on, so its skinning
// can follow that side alone. The shell under a posed body's skin is meshed the same way from each chain's own
// distance under the skin, which counts the far side of the chain's walls as outside, so a limb's shell closes under
// its wall faces. Pure, so a worker runs it and the tests prove it

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
  // Whether a voxel has air beside it. A wall's vertex beside the air is the skin's, not the wall's: there each side's
  // crossing of the wall is pulled toward its own flesh by the coverage, so the two sides' wall faces open into a thin
  // wedge where the wall meets the skin, which would show the air behind it if its faces were hidden as a wall's are
  const besideAir = (n: number, x: number, y: number, z: number) =>
    (x > 0 && field[n - 1] < iso) ||
    (x < nx - 1 && field[n + 1] < iso) ||
    (y > 0 && field[n - nx] < iso) ||
    (y < ny - 1 && field[n + nx] < iso) ||
    (z > 0 && field[n - nxy] < iso) ||
    (z < nz - 1 && field[n + nxy] < iso)
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
    // On a wall where what lies beyond is body, cut off by the side's field rather than the coverage, away from the air
    const outside = fa >= 0 ? b : a
    const ahead = (step: 0 | 1 | 2) => (axis === step ? 1 : 0)
    const nearAir = besideAir(a, x, y, z) || besideAir(b, x + ahead(0), y + ahead(1), z + ahead(2))
    walls[vertex] = field[outside] >= iso && !nearAir ? 1 : 0
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
        // A cube whose body is all one chain's, with no corner that records a wall, is meshed once, plain; any other,
        // once for each chain about it. So a plain cube never meets a cube meshed for each chain across a face that holds
        // two chains' flesh, where their meshes would part: as where a wall ends in the joined flesh about a shoulder
        let walled = false
        let bodyChain = noChain
        for (let corner = 0; corner < 8 && !walled; corner++) {
          const n = corners[corner]
          walled = other[n] !== noChain
          if (walled || field[n] < iso) continue
          if (bodyChain === noChain) bodyChain = chain[n]
          else walled = chain[n] !== bodyChain
        }
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

// The shell's mesher is the skin's, reading its fields through the calls below. The skin's keeps its own reads of the
// coverage inline, which these calls would slow by about a fifth at the finest Detail

// The side a cube with no wall about it is meshed for: the plain field, as meshIsosurface meshes it
const plainSide = 255

// What the sided mesher reads at each voxel of its grid. The plain field is the surface's own, less its level, so the
// surface lies where it crosses 0; a side's field is what that chain's side meshes from, which is the plain field away
// from any wall
interface Sided {
  size: Triple
  spacing: Triple
  origin: Triple
  axes: SceneAxes
  colors?: Uint8Array
  chain: Uint8Array
  other: Uint8Array
  plainAt: (n: number) => number
  // The side's field at a voxel; the plain side's is the plain field
  valueAt: (n: number, side: number) => number
  // Whether a side reads the plain field at a voxel, so a vertex there is the plain mesh's
  isPlainFor: (n: number, side: number) => boolean
  // Whether a voxel's sides may read other than the plain field, so a cube about it is meshed for each side
  recordsWall: (n: number) => boolean
  // Whether a vertex whose outside end is the voxel lies on a wall's face for the side, rather than on the surface:
  // what's beyond it is still within the plain surface, before the test for the air beside it
  beyondIsInside: (outside: number, side: number) => boolean
}

export interface RiggedShellInput {
  // Each voxel's distance under the skin, in voxels, as distanceField gives it, and each chain's own, as
  // chainDistanceField gives it, by the chain's index, or none where the chain has no wall and its distance is the plain
  // one
  distance: Float32Array
  chainDistances: readonly (Float32Array | undefined)[]
  // The shell's distance under the skin, in the field's voxels
  level: number
  size: Triple
  spacing: Triple
  origin: Triple
  axes: SceneAxes
  colors?: Uint8Array
  chain: Uint8Array
  other: Uint8Array
}

// The shell a distance under a posed body's skin. Each chain's side meshes its own distance, where a voxel of its chain
// or recording a wall to it lies; a voxel of another chain with no wall to the side is nothing of the side's, as for
// the skin. A face that closes a side's shell under its wall is the shell's own, drawn at rest as after, since each
// side's shell lies its depth from the wall; a face where a side gives way to another chain's flesh with no wall
// between them, as about a shoulder, lies inside the shell and is marked as a wall's, to be hidden as one until the
// pose parts it
export function meshRiggedShell(input: RiggedShellInput): RiggedMesh {
  const { distance, chainDistances, level, size, chain, other } = input
  checkSizes(size, { distance, chain, other })
  const own = (n: number, side: number) => (chainDistances[side] ?? distance)[n]
  return meshSided({
    ...input,
    plainAt: (n) => distance[n] - level,
    valueAt: (n, side) => {
      const shell = distance[n] - level
      if (side === plainSide || shell < 0) return shell
      if (chain[n] === side || other[n] === side) return own(n, side) - level
      return -level
    },
    isPlainFor: (n, side) => side === plainSide || distance[n] < level || (chain[n] === side && own(n, side) === distance[n]),
    recordsWall: (n) => other[n] !== noChain || (chain[n] !== noChain && own(n, chain[n]) !== distance[n]),
    beyondIsInside: (outside, side) => distance[outside] >= level && chain[outside] !== side && other[outside] !== side,
  })
}

function checkSizes(size: Triple, blocks: Record<string, ArrayLike<number>>) {
  const count = size[0] * size[1] * size[2]
  for (const [name, block] of Object.entries(blocks)) {
    if (block.length !== count) throw new Error(`The ${name} has ${block.length} values, but a ${size.join(' × ')} grid needs ${count}`)
  }
}

function meshSided(input: Sided): RiggedMesh {
  const { size, spacing, origin, axes, colors, chain, other, plainAt, valueAt, isPlainFor, recordsWall, beyondIsInside } = input
  const [nx, ny, nz] = size
  const nxy = nx * ny
  const { order, reversed } = mappingOf(axes)
  const builder = new MeshBuilder(colors !== undefined)
  let sides = new Uint8Array(1 << 12)
  let walls = new Uint8Array(1 << 12)

  // The vertices made so far. Those on an edge that's plain to the side meshing it are the plain mesh's, cached as
  // meshIsosurface caches its own, in the layers of cubes about the current one, so a plain cube and a side's cube
  // beside it share them. The rest, on a wall's edges, are cached by their edge and their side: an edge's lower voxel's
  // index times three plus its axis, times eight plus the side's chain
  const xEdges = [new Int32Array(nxy).fill(-1), new Int32Array(nxy).fill(-1)]
  const yEdges = [new Int32Array(nxy).fill(-1), new Int32Array(nxy).fill(-1)]
  const zEdges = new Int32Array(nxy)
  const made = new Map<number, number>()
  // Whether a voxel has the plain surface's outside beside it. A wall's vertex beside the air is the skin's, not the
  // wall's: there each side's crossing of the wall is pulled toward its own flesh by the coverage, so the two sides'
  // wall faces open into a thin wedge where the wall meets the skin, which would show the air behind it if its faces
  // were hidden as a wall's are
  const besideAir = (n: number, x: number, y: number, z: number) =>
    (x > 0 && plainAt(n - 1) < 0) ||
    (x < nx - 1 && plainAt(n + 1) < 0) ||
    (y > 0 && plainAt(n - nx) < 0) ||
    (y < ny - 1 && plainAt(n + nx) < 0) ||
    (z > 0 && plainAt(n - nxy) < 0) ||
    (z < nz - 1 && plainAt(n + nxy) < 0)
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
    // On a wall where what lies beyond is still inside, cut off by the side's field rather than the plain one, away
    // from the plain surface's outside
    const outside = fa >= 0 ? b : a
    const ahead = (step: 0 | 1 | 2) => (axis === step ? 1 : 0)
    const nearAir = besideAir(a, x, y, z) || besideAir(b, x + ahead(0), y + ahead(1), z + ahead(2))
    walls[vertex] = beyondIsInside(outside, side) && !nearAir ? 1 : 0
    return vertex
  }
  const vertexOn = (cache: Int32Array, x: number, y: number, z: number, axis: 0 | 1 | 2, side: number): number => {
    const a = x + nx * (y + ny * z)
    const b = axis === 0 ? a + 1 : axis === 1 ? a + nx : a + nxy
    if (isPlainFor(a, side) && isPlainFor(b, side)) {
      const slot = y * nx + x
      if (cache[slot] < 0) {
        const inside = plainAt(a) >= 0 ? a : b
        cache[slot] = makeVertex(a, b, x, y, z, axis, plainSide, chain[inside])
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
  const plainSides = [plainSide]
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
        // A cube whose inside is all one chain's, with no corner that records a wall, is meshed once, plain; any other,
        // once for each chain about it. So a plain cube never meets a cube meshed for each chain across a face that holds
        // two chains' flesh, where their meshes would part: as where a wall ends in the joined flesh about a shoulder
        let walled = false
        let bodyChain = noChain
        for (let corner = 0; corner < 8 && !walled; corner++) {
          const n = corners[corner]
          walled = recordsWall(n)
          if (walled || plainAt(n) < 0) continue
          if (bodyChain === noChain) bodyChain = chain[n]
          else walled = chain[n] !== bodyChain
        }
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
          if (side === plainSide) {
            for (let corner = 0; corner < 8; corner++) if (plainAt(corners[corner]) < 0) cube |= 1 << corner
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
