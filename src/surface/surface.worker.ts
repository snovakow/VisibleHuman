import { chainsOnGrid, type RigGridCells } from '../rig/sampling.ts'
import { distanceField, skinDistance } from './distanceField.ts'
import { meshIsosurface, type IsosurfaceMesh } from './marchingCubes.ts'
import { meshRigged, type RiggedMesh } from './rigMesh.ts'
import { chainNames, jointNames, skeletonShape } from '../rig/rig.ts'
import { partedTriangles, skinMesh, type MeshSkinning } from './rigSkin.ts'
import type { DistanceTiming, SurfaceMessage, SurfaceReply } from './surfaceWorker.ts'

// Answers one request per message, meshing the surface asked for, and sends the mesh back with its arrays
// transferred rather than copied. A shell is meshed from the distance under the skin, which is computed from its grid's
// coverage once and kept, so that a new depth on the same grid only meshes again

// The last distance field, with the key of the grid it was computed on
let kept: { key: string; field: Float32Array } | null = null
// The rig posed requests read, as the page last gave it
let rig: { key: string; file: RigGridCells } | null = null

self.onmessage = (event: MessageEvent<SurfaceMessage>) => {
  if ('install' in event.data) {
    rig = event.data.install
    return
  }
  try {
    const request = event.data
    const { kind, size, spacing, origin, axes, colors } = request
    let field: Uint8Array | Float32Array
    let isolevel: number
    let distance: DistanceTiming | undefined
    if (request.kind === 'shell') {
      const start = performance.now()
      const reused = kept?.key === request.key
      if (!kept || !reused) kept = { key: request.key, field: distanceField(request.coverage, size) }
      distance = { reused, milliseconds: performance.now() - start }
      field = kept.field
      isolevel = skinDistance + request.depth
    } else {
      field = request.field
      isolevel = request.isolevel
    }
    const start = performance.now()
    const input = { field, size, spacing, origin, isolevel, axes, ...(colors ? { colors } : {}) }
    const posed = request.kind !== 'shell' ? request.rig : undefined
    let mesh: IsosurfaceMesh | RiggedMesh
    let skinning: MeshSkinning | undefined
    if (posed) {
      if (rig?.key !== posed.key) throw new Error(`The worker holds no rig ${posed.key}`)
      mesh = request.kind === 'skin' ? meshRigged({ ...input, ...chainsOnGrid(rig.file, posed.grid) }) : meshIsosurface(input)
      skinning = skinMesh(mesh, rig.file, posed.placement, posed.mode)
      // A rigid mesh's triangles across two chains' bones go, which a pose would stretch apart
      if (posed.mode === 'rigid') {
        const joints = skinning.joints
        mesh = { ...mesh, indices: partedTriangles(mesh.indices, joints, (joint) => chainNames.indexOf(skeletonShape[jointNames[joint]].chain)) }
      }
    } else {
      mesh = meshIsosurface(input)
    }
    const reply: SurfaceReply = { kind, mesh, milliseconds: performance.now() - start, ...(distance ? { distance } : {}), ...(skinning ? { skinning } : {}) }
    const transfer: ArrayBuffer[] = [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]
    if (mesh.colors) transfer.push(mesh.colors.buffer)
    if (skinning) {
      transfer.push(skinning.joints.buffer, skinning.weights.buffer)
      if (skinning.otherJoints) transfer.push(skinning.otherJoints.buffer)
      if (skinning.otherWeights) transfer.push(skinning.otherWeights.buffer)
      if (skinning.walls) transfer.push(skinning.walls.buffer)
    }
    self.postMessage(reply, { transfer })
  } catch (error) {
    const reply: SurfaceReply = { error: error instanceof Error ? error.message : String(error) }
    self.postMessage(reply)
  }
}
