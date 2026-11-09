import { meshIsosurface } from './marchingCubes.ts'
import type { SurfaceReply, SurfaceRequest } from './surfaceWorker.ts'

// Answers one request per message, meshing the surface asked for, and sends the mesh back with its arrays
// transferred rather than copied
self.onmessage = (event: MessageEvent<SurfaceRequest>) => {
  try {
    const { kind, ...input } = event.data
    const start = performance.now()
    const mesh = meshIsosurface(input)
    const reply: SurfaceReply = { kind, mesh, milliseconds: performance.now() - start }
    self.postMessage(reply, { transfer: [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer] })
  } catch (error) {
    const reply: SurfaceReply = { error: error instanceof Error ? error.message : String(error) }
    self.postMessage(reply)
  }
}
