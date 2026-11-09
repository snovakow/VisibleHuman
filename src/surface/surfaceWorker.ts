import type { SceneAxes, Triple } from '../volume/format.ts'
import type { IsosurfaceMesh } from './marchingCubes.ts'

// The surfaces the worker meshes, each from its own field: the skin from the coverage and the bone from the density,
// with the brain, from a body's MRI, still to come
export type SurfaceKind = 'skin' | 'bone' | 'brain'

// What the worker is asked for: a surface of the kind, meshed from the field at the isolevel, on the grid given
export interface SurfaceRequest {
  kind: SurfaceKind
  field: Uint8Array
  size: Triple
  spacing: Triple
  // The scene's position of voxel (0, 0, 0)
  origin: Triple
  axes: SceneAxes
  isolevel: number
}

export interface SurfaceResult {
  kind: SurfaceKind
  mesh: IsosurfaceMesh
  // How long the worker took to mesh it
  milliseconds: number
}

// The worker's reply: the mesh, or why it failed
export type SurfaceReply = SurfaceResult | { error: string }

interface Job {
  request: SurfaceRequest
  resolve: (result: SurfaceResult) => void
  reject: (error: Error) => void
}

// A cancelled job may run this long from its start before the worker is cut off for the next one, so meshes quicker
// than this still arrive, and show, while a slider is dragged
const graceMilliseconds = 1000

// Surfaces are meshed off the main thread, one at a time. A newer request for a kind replaces one of that kind still
// waiting, so dragging the Bone threshold meshes the latest value next instead of every step on the way, while a
// request for another kind keeps its turn: the skin and the bone are asked for together when a volume loads
let worker: Worker | null = null
let running: Job | null = null
let startedAt = 0
let cutoff: ReturnType<typeof setTimeout> | undefined
const waiting = new Map<SurfaceKind, Job>()

// Resolves with the mesh, or never settles if it's replaced or cancelled before it starts, or cut off. A cancelled
// request already meshing still resolves if it finishes within its grace. The field is copied, so that the worker
// can take the copy's buffer and the caller's block stays whole
export function requestSurface(request: SurfaceRequest) {
  let settle: Pick<Job, 'resolve' | 'reject'> = { resolve: () => undefined, reject: () => undefined }
  const result = new Promise<SurfaceResult>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const job: Job = { request: { ...request, field: request.field.slice() }, ...settle }
  waiting.set(request.kind, job)
  startNext()
  return {
    result,
    cancel: () => {
      if (waiting.get(request.kind) === job) waiting.delete(request.kind)
      else if (job === running) cutOff()
    },
  }
}

function startNext() {
  if (running) return
  const next = waiting.entries().next()
  if (next.done) return
  const [kind, job] = next.value
  waiting.delete(kind)
  running = job
  startedAt = performance.now()
  worker ??= createWorker()
  worker.postMessage(job.request, { transfer: [job.request.field.buffer] })
}

// Ends the running job, and any cut-off waiting on it, and returns the job
function finishRunning() {
  clearTimeout(cutoff)
  cutoff = undefined
  const job = running
  running = null
  return job
}

// Stops the cancelled running job once its grace is up, which a worker can only do by being terminated
function cutOff() {
  const remaining = startedAt + graceMilliseconds - performance.now()
  cutoff ??= setTimeout(() => {
    finishRunning()
    worker?.terminate()
    worker = null
    startNext()
  }, Math.max(0, remaining))
}

function createWorker() {
  const created = new Worker(new URL('./surface.worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<SurfaceReply>) => {
    // A reply already on its way when its worker was cut off belongs to no one
    if (created !== worker) return
    const job = finishRunning()
    if (job) {
      if ('error' in event.data) job.reject(new Error(event.data.error))
      else job.resolve(event.data)
    }
    startNext()
  }
  // A worker that fails to load or crashes fails its job, and the next request starts a new one
  created.onerror = (event) => {
    if (created !== worker) return
    const job = finishRunning()
    created.terminate()
    worker = null
    if (job) job.reject(new Error(event.message || 'the surface worker failed'))
    startNext()
  }
  return created
}
