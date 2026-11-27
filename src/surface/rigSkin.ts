import { Vector3 } from 'three'
import { sourceOfScene, type Placement } from '../rig/pose.ts'
import { noChain } from '../rig/rigFile.ts'
import { mostJoints, nearestCell, skinningAtSource, type RigGridCells } from '../rig/sampling.ts'
import type { Triple } from '../volume/format.ts'
import { mappingOf, meshIsosurface, type IsosurfaceInput, type IsosurfaceMesh } from './marchingCubes.ts'

// The skinning of a posed body's meshes, vertex by vertex, as three's skinned meshes take it: four joints a vertex and
// their shares. The skin and the shell follow the flesh about each vertex, blended from the rig file's cells, on the
// vertex's own side of any wall; a wall's vertex also carries the skinning of the side across it, so a material can
// tell how far the wall has opened there and show its faces only once it has. The bone is meshed one joint's part at a
// time and each part follows its joint alone, so a bone moves rigidly whatever the Bone threshold has meshed of it.
// Pure, so a worker runs it

// A rigidly posed mesh, the bone, meshed one joint at a time: each voxel goes to the joint it moves with, given by
// jointOf, and each joint's voxels are meshed on their own, the rest of the field read as 0, below the isolevel of any
// bone or brain. Meshed whole, a bone's triangles would join one joint's part to the next, the upper arm's to the
// forearm's, and as the pose turns one from the other, as an elbow straightens from the scan's bend, they'd stretch into
// a sheet between the two; left out, they'd leave each bone end open. Meshed apart, each part closes where its joint's
// voxels end, and no triangle joins two joints. Each part is meshed within its voxels' box grown by two, so that its
// vertices' slopes read the field as the whole grid's would. A voxel beyond the rig's reach goes with the root, as a
// skinned vertex there does. The parts follow one another in joint order
export function meshRigidParts(input: IsosurfaceInput, jointOf: (i: number, j: number, k: number) => number, jointCount: number): { mesh: IsosurfaceMesh; skinning: MeshSkinning } {
  const { field, size, spacing, origin, isolevel, axes, colors } = input
  const [nx, ny, nz] = size
  const owner = new Uint8Array(field.length)
  const low = Array.from({ length: jointCount }, () => [nx, ny, nz])
  const high = Array.from({ length: jointCount }, () => [-1, -1, -1])
  for (let k = 0, n = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++, n++) {
        const joint = Math.max(jointOf(i, j, k), 0)
        owner[n] = joint
        if (!(field[n] >= isolevel)) continue
        const l = low[joint]
        const h = high[joint]
        l[0] = Math.min(l[0], i)
        l[1] = Math.min(l[1], j)
        l[2] = Math.min(l[2], k)
        h[0] = Math.max(h[0], i)
        h[1] = Math.max(h[1], j)
        h[2] = Math.max(h[2], k)
      }
    }
  }
  const { order } = mappingOf(axes)
  const parts: { mesh: IsosurfaceMesh; joint: number }[] = []
  for (let joint = 0; joint < jointCount; joint++) {
    if (high[joint][0] < 0) continue
    const from = low[joint].map((value) => Math.max(value - 2, 0))
    const to = high[joint].map((value, axis) => Math.min(value + 2, size[axis] - 1))
    const part: Triple = [to[0] - from[0] + 1, to[1] - from[1] + 1, to[2] - from[2] + 1]
    const partField = field instanceof Float32Array ? new Float32Array(part[0] * part[1] * part[2]) : new Uint8Array(part[0] * part[1] * part[2])
    const partColors = colors ? new Uint8Array(partField.length * 3) : undefined
    for (let k = 0, m = 0; k < part[2]; k++) {
      for (let j = 0; j < part[1]; j++) {
        let n = from[0] + nx * (from[1] + j + ny * (from[2] + k))
        for (let i = 0; i < part[0]; i++, m++, n++) {
          partField[m] = owner[n] === joint ? field[n] : 0
          if (colors && partColors) partColors.set(colors.subarray(n * 3, n * 3 + 3), m * 3)
        }
      }
    }
    // The part's first voxel, placed in the scene as the whole grid places it
    const shift = (scene: number) => origin[scene] + order[scene].sign * from[order[scene].source] * spacing[order[scene].source]
    const partOrigin: Triple = [shift(0), shift(1), shift(2)]
    const mesh = meshIsosurface({ field: partField, size: part, spacing, origin: partOrigin, isolevel, axes, ...(partColors ? { colors: partColors } : {}) })
    if (mesh.indices.length > 0) parts.push({ mesh, joint })
  }
  let vertices = 0
  let indices = 0
  for (const { mesh } of parts) {
    vertices += mesh.positions.length / 3
    indices += mesh.indices.length
  }
  const mesh: IsosurfaceMesh = { positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), indices: new Uint32Array(indices) }
  if (colors) mesh.colors = new Uint8Array(vertices * 3)
  const joints = new Uint8Array(vertices * mostJoints)
  const weights = new Float32Array(vertices * mostJoints)
  let vertex = 0
  let index = 0
  for (const part of parts) {
    const count = part.mesh.positions.length / 3
    mesh.positions.set(part.mesh.positions, vertex * 3)
    mesh.normals.set(part.mesh.normals, vertex * 3)
    if (mesh.colors && part.mesh.colors) mesh.colors.set(part.mesh.colors, vertex * 3)
    for (let n = 0; n < part.mesh.indices.length; n++) mesh.indices[index + n] = part.mesh.indices[n] + vertex
    for (let v = vertex; v < vertex + count; v++) {
      joints[v * mostJoints] = part.joint
      weights[v * mostJoints] = 1
    }
    vertex += count
    index += part.mesh.indices.length
  }
  return { mesh, skinning: { joints, weights } }
}

export interface MeshSkinning {
  // Four joints a vertex, by their index in jointNames, and their shares
  joints: Uint8Array<ArrayBuffer>
  weights: Float32Array<ArrayBuffer>
  // For the skin and the shell: the side across the wall at each vertex, as joints and shares, which away from a wall
  // are the vertex's own; and 1 where the vertex lies on a wall
  otherJoints?: Uint8Array<ArrayBuffer>
  otherWeights?: Float32Array<ArrayBuffer>
  walls?: Uint8Array<ArrayBuffer>
}

// How a posed mesh moves: blended, each vertex with the flesh about it, as the skin, the shell and the caps; or rigid,
// each part with one joint, as the bone, meshed by meshRigidParts
export type SkinningMode = 'blended' | 'rigid'

export function skinMesh(mesh: IsosurfaceMesh & { sides?: Uint8Array; walls?: Uint8Array }, file: RigGridCells, placement: Placement): MeshSkinning {
  const vertices = mesh.positions.length / 3
  const joints = new Uint8Array(vertices * mostJoints)
  const weights = new Float32Array(vertices * mostJoints)
  const walled = mesh.sides !== undefined && mesh.walls !== undefined
  const otherJoints = walled ? new Uint8Array(vertices * mostJoints) : undefined
  const otherWeights = walled ? new Float32Array(vertices * mostJoints) : undefined
  const point = new Vector3()
  for (let v = 0; v < vertices; v++) {
    point.fromArray(mesh.positions, v * 3)
    const source = sourceOfScene(placement, point)
    const side = mesh.sides && mesh.sides[v] !== noChain ? mesh.sides[v] : undefined
    const onWall = mesh.walls?.[v] === 1
    const own = skinningAtSource(file, source, side, onWall)
    // A vertex beyond the rig's reach, which the meshes' don't come near, follows the root rather than none
    if (!own) {
      weights[v * mostJoints] = 1
      if (otherWeights) otherWeights[v * mostJoints] = 1
      continue
    }
    own.joints.forEach((joint, n) => {
      joints[v * mostJoints + n] = joint
      weights[v * mostJoints + n] = own.weights[n]
    })
    if (!otherJoints || !otherWeights) continue
    // Across the wall: the chain the nearest cell records on the far side, skinned as that chain's flesh
    let across = own
    if (onWall && side !== undefined) {
      const nearest = nearestCell(file, source)
      const cells = file.cells
      const far = nearest < 0 ? noChain : cells.chain[nearest] === side ? cells.otherChain[nearest] : cells.chain[nearest]
      if (far !== noChain) across = skinningAtSource(file, source, far, true) ?? own
    }
    across.joints.forEach((joint, n) => {
      otherJoints[v * mostJoints + n] = joint
      otherWeights[v * mostJoints + n] = across.weights[n]
    })
  }
  const skinning: MeshSkinning = { joints, weights }
  if (otherJoints && otherWeights && mesh.walls) {
    skinning.otherJoints = otherJoints
    skinning.otherWeights = otherWeights
    skinning.walls = mesh.walls.slice()
  }
  return skinning
}
