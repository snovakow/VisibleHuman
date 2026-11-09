import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js'
import type { SceneAxes, Triple } from '../volume/format.ts'

// Marching cubes over a field on the volume's grid, of bytes or of floats, with the tables and conventions of three's MarchingCubes:
// i varies fastest, then j, then k, as the file's blocks are laid out; corners in Paul Bourke's order; a corner's
// bit is set where its value is below the isolevel, so the triangles face outward, toward the lower values. A
// vertex sits where the field crosses the isolevel along a cube's edge, found by the straight line between the two
// ends, and neighbouring cubes share it. Its normal is minus the field's slope there, which falls outward, taken as
// central differences over each axis's own spacing and mixed between the edge's ends. Positions and normals come out
// in the scene's frame, through the volume's axes; where that mapping turns the grid inside out, the triangles are
// wound the other way round, so they still face outward. Given colours on the same grid, each vertex takes the colour
// where it lies along its edge. Pure, so a worker runs it and the tests prove it

export interface IsosurfaceInput {
  // One value per voxel in index order i + nx·(j + ny·k): a byte, such as the file's coverage or density block, or a
  // float, such as a distance from the skin
  field: Uint8Array | Float32Array
  // The grid's size along i, j and k, and the spacing of its voxels in millimetres
  size: Triple
  spacing: Triple
  // The scene's position of voxel (0, 0, 0), in millimetres: the mesh is centred where the splats are by passing
  // the negated centre of the body's bounds
  origin: Triple
  // The value the surface lies at: a voxel at or above it is inside
  isolevel: number
  // Which grid axis each scene axis follows, and whether against it
  axes: SceneAxes
  // R, G and B per voxel, interleaved, on the field's grid, where the mesh is to carry a colour per vertex. A voxel
  // whose three are 0 carries none, as outside the body's dilated colour
  colors?: Uint8Array
}

// Its arrays have their own buffers, so a worker can transfer them
export interface IsosurfaceMesh {
  positions: Float32Array<ArrayBuffer>
  normals: Float32Array<ArrayBuffer>
  indices: Uint32Array<ArrayBuffer>
  // R, G and B per vertex, where the input had colours: the colours at the two ends of the vertex's edge mixed as the
  // vertex lies between them, where both carry one, else the one that does
  colors?: Uint8Array<ArrayBuffer>
}

// Marks an edge whose vertex hasn't been made yet
const noVertex = -1

// How the scene reads the grid: for each scene axis, its grid axis and sign, and whether the mapping as a whole
// turns the grid's handedness over, which is where the winding must turn too
function mappingOf(axes: SceneAxes) {
  const order = [axes.x, axes.y, axes.z]
  // A signed permutation's determinant: the sign of the permutation times the product of the signs
  let parity = 1
  const sources = order.map((axis) => axis.source)
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (sources[a] > sources[b]) parity = -parity
  const determinant = parity * order[0].sign * order[1].sign * order[2].sign
  return { order, reversed: determinant < 0 }
}

export function meshIsosurface({ field, size, spacing, origin, isolevel, axes, colors }: IsosurfaceInput): IsosurfaceMesh {
  const [nx, ny, nz] = size
  const nxy = nx * ny
  if (field.length !== nxy * nz) {
    throw new Error(`The field has ${field.length} values, but a ${size.join(' × ')} grid needs ${nxy * nz}`)
  }
  if (colors && colors.length !== field.length * 3) {
    throw new Error(`The colours have ${colors.length} bytes, but a ${size.join(' × ')} grid needs ${field.length * 3}`)
  }
  if (nx < 2 || ny < 2 || nz < 2) return emptyMesh(colors !== undefined)
  const { order, reversed } = mappingOf(axes)
  const builder = new MeshBuilder(colors !== undefined)

  // The field's slope at a grid point along each axis, per millimetre: the difference between the neighbours either
  // side over the two voxels between them, or, at the grid's border, between the point and its one neighbour over one
  const gradient = [0, 0, 0]
  const slopeAt = (n: number, at: number, count: number, stride: number, step: number) => {
    const ahead = at < count - 1 ? 1 : 0
    const behind = at > 0 ? 1 : 0
    return (field[n + ahead * stride] - field[n - behind * stride]) / ((ahead + behind) * step)
  }
  const gradientAt = (n: number, x: number, y: number, z: number) => {
    gradient[0] = slopeAt(n, x, nx, 1, spacing[0])
    gradient[1] = slopeAt(n, y, ny, nx, spacing[1])
    gradient[2] = slopeAt(n, z, nz, nxy, spacing[2])
  }

  // The vertex where the surface crosses the edge from grid point (x, y, z) to the next point along the axis
  const grid = [0, 0, 0]
  const normal = [0, 0, 0]
  const addVertex = (x: number, y: number, z: number, axis: 0 | 1 | 2) => {
    const a = x + nx * (y + ny * z)
    const b = axis === 0 ? a + 1 : axis === 1 ? a + nx : a + nxy
    const fa = field[a]
    const fb = field[b]
    const t = (isolevel - fa) / (fb - fa)
    gradientAt(a, x, y, z)
    const gx = gradient[0]
    const gy = gradient[1]
    const gz = gradient[2]
    gradientAt(b, x + (axis === 0 ? 1 : 0), y + (axis === 1 ? 1 : 0), z + (axis === 2 ? 1 : 0))
    // The field rises inward, so the normal is minus its slope, mixed between the two ends
    grid[0] = -(gx + t * (gradient[0] - gx))
    grid[1] = -(gy + t * (gradient[1] - gy))
    grid[2] = -(gz + t * (gradient[2] - gz))
    const length = Math.hypot(grid[0], grid[1], grid[2]) || 1
    for (let scene = 0; scene < 3; scene++) normal[scene] = (order[scene].sign * grid[order[scene].source]) / length
    // The point in grid coordinates, then along the scene's axes
    grid[0] = x + (axis === 0 ? t : 0)
    grid[1] = y + (axis === 1 ? t : 0)
    grid[2] = z + (axis === 2 ? t : 0)
    const position = (scene: number) => {
      const { source, sign } = order[scene]
      return origin[scene] + sign * grid[source] * spacing[source]
    }
    const vertex = builder.addVertex(position(0), position(1), position(2), normal[0], normal[1], normal[2])
    if (colors) {
      const ca = a * 3
      const cb = b * 3
      const aColoured = (colors[ca] | colors[ca + 1] | colors[ca + 2]) !== 0
      const bColoured = (colors[cb] | colors[cb + 1] | colors[cb + 2]) !== 0
      // Where one end lies outside the colour, the other's is the vertex's whole, so the surface never darkens toward
      // the uncoloured outside
      const share = aColoured && bColoured ? t : bColoured ? 1 : 0
      builder.setColour(
        vertex,
        Math.round(colors[ca] + share * (colors[cb] - colors[ca])),
        Math.round(colors[ca + 1] + share * (colors[cb + 1] - colors[ca + 1])),
        Math.round(colors[ca + 2] + share * (colors[cb + 2] - colors[ca + 2])),
      )
    }
    return vertex
  }

  // Vertices on x and y edges are cached for the layer of cells below and above, and on z edges for the current one,
  // so neighbouring cells share them
  const xEdges = [new Int32Array(nxy).fill(noVertex), new Int32Array(nxy).fill(noVertex)]
  const yEdges = [new Int32Array(nxy).fill(noVertex), new Int32Array(nxy).fill(noVertex)]
  const zEdges = new Int32Array(nxy)
  const edgeVertex = (cache: Int32Array, x: number, y: number, z: number, axis: 0 | 1 | 2) => {
    const key = y * nx + x
    if (cache[key] === noVertex) cache[key] = addVertex(x, y, z, axis)
    return cache[key]
  }
  const cubeEdges = new Int32Array(12)

  for (let z = 0; z < nz - 1; z++) {
    const below = z * nxy
    const above = below + nxy
    const slab = z & 1
    xEdges[slab ^ 1].fill(noVertex)
    yEdges[slab ^ 1].fill(noVertex)
    zEdges.fill(noVertex)
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const i = y * nx + x
        let cube = 0
        if (field[below + i] < isolevel) cube |= 1
        if (field[below + i + 1] < isolevel) cube |= 2
        if (field[below + i + 1 + nx] < isolevel) cube |= 4
        if (field[below + i + nx] < isolevel) cube |= 8
        if (field[above + i] < isolevel) cube |= 16
        if (field[above + i + 1] < isolevel) cube |= 32
        if (field[above + i + 1 + nx] < isolevel) cube |= 64
        if (field[above + i + nx] < isolevel) cube |= 128
        const edges = edgeTable[cube]
        if (edges === 0) continue

        // Bourke's edges 0 to 11, from the corners they join
        if (edges & 1) cubeEdges[0] = edgeVertex(xEdges[slab], x, y, z, 0)
        if (edges & 2) cubeEdges[1] = edgeVertex(yEdges[slab], x + 1, y, z, 1)
        if (edges & 4) cubeEdges[2] = edgeVertex(xEdges[slab], x, y + 1, z, 0)
        if (edges & 8) cubeEdges[3] = edgeVertex(yEdges[slab], x, y, z, 1)
        if (edges & 16) cubeEdges[4] = edgeVertex(xEdges[slab ^ 1], x, y, z + 1, 0)
        if (edges & 32) cubeEdges[5] = edgeVertex(yEdges[slab ^ 1], x + 1, y, z + 1, 1)
        if (edges & 64) cubeEdges[6] = edgeVertex(xEdges[slab ^ 1], x, y + 1, z + 1, 0)
        if (edges & 128) cubeEdges[7] = edgeVertex(yEdges[slab ^ 1], x, y, z + 1, 1)
        if (edges & 256) cubeEdges[8] = edgeVertex(zEdges, x, y, z, 2)
        if (edges & 512) cubeEdges[9] = edgeVertex(zEdges, x + 1, y, z, 2)
        if (edges & 1024) cubeEdges[10] = edgeVertex(zEdges, x + 1, y + 1, z, 2)
        if (edges & 2048) cubeEdges[11] = edgeVertex(zEdges, x, y + 1, z, 2)

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
  return builder.finish()
}

// Collects the mesh in typed arrays that double as they fill, since a fine surface can have millions of vertices
class MeshBuilder {
  private positions = new Float32Array(3 << 12)
  private normals = new Float32Array(3 << 12)
  private indices = new Uint32Array(3 << 13)
  // Only where the mesh is coloured
  private colors: Uint8Array<ArrayBuffer> | null
  private vertexCount = 0
  private indexCount = 0

  constructor(coloured: boolean) {
    this.colors = coloured ? new Uint8Array(3 << 12) : null
  }

  addVertex(x: number, y: number, z: number, normalX: number, normalY: number, normalZ: number) {
    if (this.vertexCount * 3 === this.positions.length) {
      this.positions = growFloats(this.positions)
      this.normals = growFloats(this.normals)
      if (this.colors) this.colors = growBytes(this.colors)
    }
    const v = this.vertexCount * 3
    this.positions[v] = x
    this.positions[v + 1] = y
    this.positions[v + 2] = z
    this.normals[v] = normalX
    this.normals[v + 1] = normalY
    this.normals[v + 2] = normalZ
    return this.vertexCount++
  }

  setColour(vertex: number, r: number, g: number, b: number) {
    if (!this.colors) return
    const v = vertex * 3
    this.colors[v] = r
    this.colors[v + 1] = g
    this.colors[v + 2] = b
  }

  addTriangle(a: number, b: number, c: number) {
    if (this.indexCount + 3 > this.indices.length) this.indices = growIndices(this.indices)
    this.indices[this.indexCount++] = a
    this.indices[this.indexCount++] = b
    this.indices[this.indexCount++] = c
  }

  // Each array cut to what's filled, in a buffer of its own
  finish(): IsosurfaceMesh {
    const mesh: IsosurfaceMesh = {
      positions: this.positions.slice(0, this.vertexCount * 3),
      normals: this.normals.slice(0, this.vertexCount * 3),
      indices: this.indices.slice(0, this.indexCount),
    }
    if (this.colors) mesh.colors = this.colors.slice(0, this.vertexCount * 3)
    return mesh
  }
}

function growFloats(array: Float32Array<ArrayBuffer>) {
  const larger = new Float32Array(array.length * 2)
  larger.set(array)
  return larger
}

function growBytes(array: Uint8Array<ArrayBuffer>) {
  const larger = new Uint8Array(array.length * 2)
  larger.set(array)
  return larger
}

function growIndices(array: Uint32Array<ArrayBuffer>) {
  const larger = new Uint32Array(array.length * 2)
  larger.set(array)
  return larger
}

function emptyMesh(coloured: boolean): IsosurfaceMesh {
  const mesh: IsosurfaceMesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) }
  if (coloured) mesh.colors = new Uint8Array(0)
  return mesh
}
