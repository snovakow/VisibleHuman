import type { SceneAxes, Triple } from '../volume/format.ts'
import type { IsosurfaceMesh } from './marchingCubes.ts'

// The grid a surface is meshed on, and its colours there where the mesh is to carry them per vertex
interface GridRequest {
  size: Triple
  spacing: Triple
  // The scene's position of voxel (0, 0, 0)
  origin: Triple
  axes: SceneAxes
  // R, G and B per voxel, interleaved
  colors?: Uint8Array
}

// A surface meshed from a field at an isolevel: the skin from the coverage, and the mesh inside it, asked for as the
// bone, from the density or, where it's the brain's, from a body's MRI
interface FieldRequest extends GridRequest {
  kind: 'skin' | 'bone'
  field: Uint8Array
  isolevel: number
}

// The closed shell a depth under the skin, meshed from each body voxel's distance to the outside, which the worker
// computes from the coverage and keeps under the key, so that the next shell on the grid of the same key reuses it
interface ShellRequest extends GridRequest {
  kind: 'shell'
  coverage: Uint8Array
  key: string
  // How far under the skin, in the grid's voxels
  depth: number
}

// What the worker is asked for: a surface of the kind, on the grid given
export type SurfaceRequest = FieldRequest | ShellRequest

// The surfaces the worker meshes, each from its own field
export type SurfaceKind = SurfaceRequest['kind']

// For a shell, how long its distance field took, or that it was the one kept from the shell before
export interface DistanceTiming {
  reused: boolean
  milliseconds: number
}

interface SurfaceResult {
  kind: SurfaceKind
  mesh: IsosurfaceMesh
  // How long the worker took to mesh it
  milliseconds: number
  distance?: DistanceTiming
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
// waiting, so dragging the Bone threshold or the Depth meshes the latest value next instead of every step on the way,
// while a request for another kind keeps its turn: the skin and the bone are asked for together when a volume loads.
// A worker cut off loses the distance field it kept, and the next shell computes it again
let worker: Worker | null = null
let running: Job | null = null
let startedAt = 0
let cutoff: ReturnType<typeof setTimeout> | undefined
const waiting = new Map<SurfaceKind, Job>()

// The request with its arrays copied, so that the worker can take the copies' buffers and the caller's stay whole
function copied(request: SurfaceRequest): SurfaceRequest {
  const colors = request.colors ? { colors: request.colors.slice() } : {}
  if (request.kind === 'shell') return { ...request, coverage: request.coverage.slice(), ...colors }
  return { ...request, field: request.field.slice(), ...colors }
}

// The buffers the worker takes with a request
function transferOf(request: SurfaceRequest) {
  const buffers = [request.kind === 'shell' ? request.coverage.buffer : request.field.buffer]
  if (request.colors) buffers.push(request.colors.buffer)
  return buffers
}

// Resolves with the mesh, or never settles if it's replaced or cancelled before it starts, or cut off. A cancelled
// request already meshing still resolves if it finishes within its grace. Its arrays are copied as it starts, not
// when it's asked for, so that one replaced or cancelled while it waits, as most of a drag's steps are, copies
// nothing; the caller's arrays mustn't change in the meantime, and the volume's and its block grids' never do
export function requestSurface(request: SurfaceRequest) {
  let settle: Pick<Job, 'resolve' | 'reject'> = { resolve: () => undefined, reject: () => undefined }
  const result = new Promise<SurfaceResult>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const job: Job = { request, ...settle }
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
  const request = copied(job.request)
  worker.postMessage(request, { transfer: transferOf(request) })
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
