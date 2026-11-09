import { distanceField, skinDistance } from './distanceField.ts'
import { meshIsosurface } from './marchingCubes.ts'
import type { DistanceTiming, SurfaceReply, SurfaceRequest } from './surfaceWorker.ts'

// Answers one request per message, meshing the surface asked for, and sends the mesh back with its arrays
// transferred rather than copied. A shell is meshed from the distance under the skin, which is computed from its grid's
// coverage once and kept, so that a new depth on the same grid only meshes again

// The last distance field, with the key of the grid it was computed on
let kept: { key: string; field: Float32Array } | null = null

self.onmessage = (event: MessageEvent<SurfaceRequest>) => {
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
    const mesh = meshIsosurface({ field, size, spacing, origin, isolevel, axes, ...(colors ? { colors } : {}) })
    const reply: SurfaceReply = { kind, mesh, milliseconds: performance.now() - start, ...(distance ? { distance } : {}) }
    const transfer: ArrayBuffer[] = [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]
    if (mesh.colors) transfer.push(mesh.colors.buffer)
    self.postMessage(reply, { transfer })
  } catch (error) {
    const reply: SurfaceReply = { error: error instanceof Error ? error.message : String(error) }
    self.postMessage(reply)
  }
}
