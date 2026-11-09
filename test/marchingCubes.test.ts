import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meshIsosurface, type IsosurfaceMesh } from '../src/surface/marchingCubes.ts'
import type { SceneAxes, Triple } from '../src/volume/format.ts'

// The mesher, checked on a byte field of a sphere built here: closed, on the sphere, facing outward, in millimetres
// through an anisotropic spacing, and still outward through an axes mapping that turns the grid over; and on a tilted
// plane, whose normal every vertex takes, along the grid's border as inside it

// The grid: 32 voxels a side, with the sphere's centre on voxel 16 along each axis
const side = 32
const centreVoxel = 16
// The sphere's radius in millimetres, and how steeply the field rises inward per millimetre, so that it crosses the
// isolevel of 128 on the sphere and saturates about six millimetres either side
const radius = 10
const slope = 20
const isolevel = 128
// How far a vertex may lie from the sphere, in voxels along the widest axis: the straight line between two voxel
// centres a voxel apart misses a sphere of this radius by far less
const radiusTolerance = 0.6
// How closely a vertex's normal must follow the direction out from the centre
const outwardShare = 0.95
// A crossing that lands on a grid point, where a byte equals the isolevel, gives a triangle with two corners at one
// point and no area, whose winding means nothing: these are passed over, and counted, since they're a few per cent
const sliverArea = 1e-9
const sliverShare = 0.1

const male: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } }
const plain: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: 1 } }
// A mapping that mirrors the grid: z against k, with x and y along i and j, whose determinant is −1
const mirrored: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: -1 } }

// A byte field of a sphere of the radius about the centre voxel, over the grid's spacing in millimetres
function sphereField(spacing: Triple) {
  const field = new Uint8Array(side * side * side)
  for (let k = 0; k < side; k++) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const r = Math.hypot((i - centreVoxel) * spacing[0], (j - centreVoxel) * spacing[1], (k - centreVoxel) * spacing[2])
        field[i + side * (j + side * k)] = Math.max(0, Math.min(255, Math.round(isolevel + (radius - r) * slope)))
      }
    }
  }
  return field
}

// The scene's position of voxel (0, 0, 0) that puts the centre voxel at the scene's origin, through the axes
function originFor(axes: SceneAxes, spacing: Triple): Triple {
  const at = (axis: { source: 0 | 1 | 2; sign: 1 | -1 }) => -axis.sign * centreVoxel * spacing[axis.source]
  return [at(axes.x), at(axes.y), at(axes.z)]
}

function meshSphere(spacing: Triple, axes: SceneAxes) {
  const size: Triple = [side, side, side]
  return meshIsosurface({ field: sphereField(spacing), size, spacing, origin: originFor(axes, spacing), isolevel, axes })
}

function position(mesh: IsosurfaceMesh, vertex: number) {
  return Array.from(mesh.positions.subarray(vertex * 3, vertex * 3 + 3))
}

function normal(mesh: IsosurfaceMesh, vertex: number) {
  return Array.from(mesh.normals.subarray(vertex * 3, vertex * 3 + 3))
}

// How many triangles each edge lies in, the edges named by their two ends
function edgeCounts(mesh: IsosurfaceMesh) {
  const counts = new Map<string, number>()
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t + e]
      const b = mesh.indices[t + ((e + 1) % 3)]
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`
      counts.set(edge, (counts.get(edge) ?? 0) + 1)
    }
  }
  return counts
}

// A closed surface has every edge in two triangles, and one sphere has V − E + F = 2
function assertClosedSphere(mesh: IsosurfaceMesh) {
  const counts = edgeCounts(mesh)
  assert.ok(counts.size > 0)
  for (const [edge, count] of counts) assert.equal(count, 2, `edge ${edge} lies in ${count} triangles`)
  const vertices = mesh.positions.length / 3
  const faces = mesh.indices.length / 3
  assert.equal(vertices - counts.size + faces, 2)
}

// A triangle's area vector: its geometric normal, twice its area long
function areaVector(mesh: IsosurfaceMesh, t: number) {
  const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map((v) => position(mesh, v))
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
}

// Every triangle's geometric normal agrees with its vertices' normals, and every vertex's normal points out from the
// centre, so the mesh faces outward however the grid is mapped
function assertOutward(mesh: IsosurfaceMesh) {
  let slivers = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [gx, gy, gz] = areaVector(mesh, t)
    if (Math.hypot(gx, gy, gz) / 2 < sliverArea) {
      slivers++
      continue
    }
    let nx = 0
    let ny = 0
    let nz = 0
    for (let e = 0; e < 3; e++) {
      const [x, y, z] = normal(mesh, mesh.indices[t + e])
      nx += x
      ny += y
      nz += z
    }
    assert.ok(gx * nx + gy * ny + gz * nz > 0, `triangle ${t / 3} winds against its normals`)
  }
  assert.ok(slivers < (sliverShare * mesh.indices.length) / 3, `${slivers} slivers`)
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const [x, y, z] = position(mesh, v)
    const [nx, ny, nz] = normal(mesh, v)
    const r = Math.hypot(x, y, z)
    assert.ok((x * nx + y * ny + z * nz) / r > outwardShare, `vertex ${v}'s normal points inward`)
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-5, `vertex ${v}'s normal isn't unit`)
  }
}

function assertOnSphere(mesh: IsosurfaceMesh, spacing: Triple) {
  const tolerance = radiusTolerance * Math.max(...spacing)
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const [x, y, z] = position(mesh, v)
    const r = Math.hypot(x, y, z)
    assert.ok(Math.abs(r - radius) < tolerance, `vertex ${v} lies ${r} mm from the centre`)
  }
}

// The farthest a vertex reaches along each scene axis, either way
function extents(mesh: IsosurfaceMesh) {
  const reach = [0, 0, 0]
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    position(mesh, v).forEach((value, axis) => {
      reach[axis] = Math.max(reach[axis], Math.abs(value))
    })
  }
  return reach
}

void test('a sphere meshes closed, on the sphere and facing outward, through the male\'s axes', () => {
  const spacing: Triple = [1, 1, 1]
  const mesh = meshSphere(spacing, male)
  assertClosedSphere(mesh)
  assertOnSphere(mesh, spacing)
  assertOutward(mesh)
  // A sphere of radius 10 has about 4πr² × 2 triangles at a voxel's spacing
  assert.ok(mesh.indices.length / 3 > 2000 && mesh.indices.length / 3 < 5000, `${mesh.indices.length / 3} triangles`)
  // The vertices are shared: far fewer than three per triangle
  assert.ok(mesh.positions.length / 3 < mesh.indices.length / 2)
})

void test('the empty field gives the empty mesh, and a field all inside has no surface either', () => {
  const size: Triple = [8, 8, 8]
  const empty = meshIsosurface({ field: new Uint8Array(512), size, spacing: [1, 1, 1], origin: [0, 0, 0], isolevel, axes: plain })
  assert.deepEqual([empty.positions.length, empty.normals.length, empty.indices.length], [0, 0, 0])
  const full = meshIsosurface({ field: new Uint8Array(512).fill(255), size, spacing: [1, 1, 1], origin: [0, 0, 0], isolevel, axes: plain })
  assert.equal(full.indices.length, 0)
  assert.throws(() => meshIsosurface({ field: new Uint8Array(100), size, spacing: [1, 1, 1], origin: [0, 0, 0], isolevel, axes: plain }))
})

void test('an anisotropic spacing keeps the sphere\'s proportions in millimetres', () => {
  const spacing: Triple = [1, 2, 0.8]
  const mesh = meshSphere(spacing, plain)
  assertClosedSphere(mesh)
  assertOnSphere(mesh, spacing)
  assertOutward(mesh)
  // The sphere reaches the radius along every scene axis, whatever the voxels' shape along it
  const tolerance = radiusTolerance * Math.max(...spacing)
  for (const reach of extents(mesh)) assert.ok(Math.abs(reach - radius) < tolerance, `reaches ${reach} mm`)
})

void test('an axes mapping with a negative determinant still winds outward', () => {
  const spacing: Triple = [1, 1, 1]
  const mesh = meshSphere(spacing, mirrored)
  assertClosedSphere(mesh)
  assertOnSphere(mesh, spacing)
  assertOutward(mesh)
  // The same sphere through the plain mapping has the same triangles, wound the other way
  const plainMesh = meshSphere(spacing, plain)
  assert.equal(mesh.indices.length, plainMesh.indices.length)
  const { indices } = plainMesh
  for (let t = 0; t < indices.length; t += 3) {
    const reversed = [indices[t], indices[t + 2], indices[t + 1]]
    assert.deepEqual(Array.from(mesh.indices.subarray(t, t + 3)), reversed, `triangle ${t / 3} isn't wound the other way`)
  }
})

void test('the origin places voxel (0, 0, 0) in the scene, so the sphere sits where the origin says', () => {
  const spacing: Triple = [1, 1, 1]
  const size: Triple = [side, side, side]
  const origin: Triple = [100, -50, 7]
  const mesh = meshIsosurface({ field: sphereField(spacing), size, spacing, origin, isolevel, axes: plain })
  // Every vertex lies on the sphere about the centre voxel, which the origin puts at (116, −34, 23)
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const [x, y, z] = position(mesh, v)
    const r = Math.hypot(x - (origin[0] + centreVoxel), y - (origin[1] + centreVoxel), z - (origin[2] + centreVoxel))
    assert.ok(Math.abs(r - radius) < radiusTolerance, `vertex ${v} lies ${r} mm from the centre`)
  }
})

void test('a tilted plane gives every vertex the plane\'s normal, along the grid\'s border as inside it', () => {
  // A field rising evenly along i and j, so that its slope is the same at every grid point, whether taken across
  // the point's two neighbours inside the grid or to its one neighbour at the border; the plane it crosses the
  // isolevel on runs out through the border along x and y
  const size: Triple = [6, 6, 3]
  const spacing: Triple = [1, 2, 1]
  const field = new Uint8Array(size[0] * size[1] * size[2])
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) field[i + size[0] * (j + size[1] * k)] = 50 + 24 * i + 12 * j
    }
  }
  const mesh = meshIsosurface({ field, size, spacing, origin: [0, 0, 0], isolevel, axes: plain })
  // The field rises 24 a millimetre along x and 6 along y, inward, so the normal points the other way
  const expected = [-24, -6, 0].map((value) => value / Math.hypot(24, 6))
  const vertices = mesh.positions.length / 3
  assert.ok(vertices > 0)
  for (let v = 0; v < vertices; v++) {
    const [x, y, z] = normal(mesh, v)
    assert.ok(Math.hypot(x - expected[0], y - expected[1], z - expected[2]) < 1e-6, `vertex ${v}'s normal is ${[x, y, z].join(', ')}`)
  }
  // Vertices lie on both border rows along y, where the slope across y is taken one-sided
  const heights = Array.from({ length: vertices }, (_, v) => position(mesh, v)[1])
  assert.ok(heights.includes(0) && heights.includes((size[1] - 1) * spacing[1]))
})
