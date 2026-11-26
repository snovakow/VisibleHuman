import { chainsOnGrid, type ChainsOnGrid, type RigGridCells } from '../rig/sampling.ts'
import { chainDistanceField, distanceField, hasWallsTo, skinDistance } from './distanceField.ts'
import { meshIsosurface, type IsosurfaceMesh } from './marchingCubes.ts'
import { meshRigged, meshRiggedShell, type RiggedMesh } from './rigMesh.ts'
import { chainNames, jointNames, skeletonShape } from '../rig/rig.ts'
import { capMesh } from './capGrid.ts'
import { partedTriangles, skinMesh, type MeshSkinning } from './rigSkin.ts'
import { isCapRequest, type CapRequest, type DistanceTiming, type SurfaceMessage, type SurfaceReply } from './surfaceWorker.ts'

// Answers one request per message, meshing the surface asked for, and sends the mesh back with its arrays
// transferred rather than copied. A shell is meshed from the distance under the skin, which is computed from its grid's
// coverage once and kept, so that a new depth on the same grid only meshes again

// The last distance field, with the key of the grid it was computed on, and for a posed body the rig's chains on that
// grid and each chain's own distance, with the rig's key
interface Kept {
  key: string
  field: Float32Array
  posed?: { rig: string; chains: ChainsOnGrid; distances: (Float32Array | undefined)[] }
}
let kept: Kept | null = null
// The rig posed requests read, as the page last gave it
let rig: { key: string; file: RigGridCells } | null = null

self.onmessage = (event: MessageEvent<SurfaceMessage>) => {
  if ('install' in event.data) {
    rig = event.data.install
    return
  }
  try {
    const request = event.data
    if (isCapRequest(request)) {
      answerCap(request)
      return
    }
    const { kind, size, spacing, origin, axes, colors } = request
    let field: Uint8Array | Float32Array
    let isolevel: number
    let distance: DistanceTiming | undefined
    if (request.kind === 'shell') {
      const start = performance.now()
      const shellRig = request.rig
      const reused = kept?.key === request.key && (!shellRig || kept.posed?.rig === shellRig.key)
      if (!kept || !reused) {
        const plainField = kept?.key === request.key ? kept.field : distanceField(request.coverage, size)
        kept = { key: request.key, field: plainField }
        if (shellRig) {
          if (rig?.key !== shellRig.key) throw new Error(`The worker holds no rig ${shellRig.key}`)
          const chains = chainsOnGrid(rig.file, shellRig.grid)
          const distances = chainNames.map((_, side) => (hasWallsTo(chains, side) ? chainDistanceField(request.coverage, size, chains, side) : undefined))
          kept.posed = { rig: shellRig.key, chains, distances }
        }
      }
      distance = { reused, milliseconds: performance.now() - start }
      field = kept.field
      isolevel = skinDistance + request.depth
    } else {
      field = request.field
      isolevel = request.isolevel
    }
    const start = performance.now()
    const input = { field, size, spacing, origin, isolevel, axes, ...(colors ? { colors } : {}) }
    const posed = request.rig
    let mesh: IsosurfaceMesh | RiggedMesh
    let skinning: MeshSkinning | undefined
    if (posed) {
      if (rig?.key !== posed.key) throw new Error(`The worker holds no rig ${posed.key}`)
      if (request.kind === 'shell') {
        const shell = kept?.posed
        if (!kept || !shell || shell.rig !== posed.key) throw new Error(`The worker holds no chains' distances for the rig ${posed.key}`)
        const { chain, other } = shell.chains
        const fields = { distance: kept.field, chainDistances: shell.distances, level: isolevel, chain, other }
        mesh = meshRiggedShell({ ...fields, size, spacing, origin, axes, ...(colors ? { colors } : {}) })
      } else {
        mesh = request.kind === 'skin' ? meshRigged({ ...input, ...chainsOnGrid(rig.file, posed.grid) }) : meshIsosurface(input)
      }
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

// A cap's sections, skinned, sent back with their arrays transferred
function answerCap(request: CapRequest) {
  if (rig?.key !== request.rig.key) throw new Error(`The worker holds no rig ${request.rig.key}`)
  const start = performance.now()
  const { placement } = request.rig
  const built = capMesh({ file: rig.file, placement, axis: request.axis, level: request.level })
  const skinning = skinMesh(built, rig.file, placement, 'blended')
  const mesh = { positions: built.positions, normals: built.normals, indices: built.indices }
  const cap = { measures: built.measures, chains: built.chains }
  const reply: SurfaceReply = { kind: request.kind, mesh, milliseconds: performance.now() - start, skinning, cap }
  const transfer = [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, built.measures.buffer, skinning.joints.buffer, skinning.weights.buffer]
  self.postMessage(reply, { transfer })
}
