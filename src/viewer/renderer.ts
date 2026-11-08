import { WebGPURenderer } from 'three/webgpu'

// R3F types its renderer as a WebGLRenderer, though the Canvas's factory always makes a WebGPURenderer
export function asWebGPU(renderer: unknown): WebGPURenderer {
  if (!(renderer instanceof WebGPURenderer)) throw new Error('Expected a WebGPURenderer')
  return renderer
}

// GPUs that offer WebGPU but can't compile the splat sort's shaders, and take Chrome's GPU process down trying.
// Haswell's Intel Iris (gen-7) fails on CountingSortReset
const failingGPUs = [{ vendor: 'intel', architecture: 'gen-7' }] as const

// The fallback's start is retried while a crashed GPU process restarts, as its WebGL 2 context comes back null till then
const fallbackAttempts = 5
const fallbackRetryDelay = 1000

// The Canvas's renderer: WebGPU where the browser offers it and the GPU isn't known to fail it, and otherwise three's
// WebGL 2 fallback, which forceWebGL also asks for. A WebGPU failure after the start calls fallBack
export async function createRenderer(canvas: object, forceWebGL: boolean, fallBack: () => void) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected an HTMLCanvasElement')
  const failingGPU = forceWebGL ? null : await knownFailingGPU()
  if (failingGPU) {
    console.info(`VisibleHuman: this GPU (${failingGPU}) is known to fail WebGPU, so starting on the WebGL 2 fallback`)
  }
  const renderer =
    forceWebGL || failingGPU ? await startFallback(canvas) : await new WebGPURenderer({ canvas, antialias: true }).init()
  const webgpu = 'isWebGPUBackend' in renderer.backend
  console.info(`VisibleHuman: rendering with ${webgpu ? 'WebGPU' : 'the WebGL 2 fallback'}`)
  if (webgpu) watchForFailure(renderer, fallBack)
  return renderer
}

// Names the adapter if it's in failingGPUs, or returns null
async function knownFailingGPU() {
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null)
  // Chrome offered WebGPU before adapter.info, which the DOM library types as always there
  const info = adapter?.info
  if (!info) return null
  const { vendor, architecture } = info
  const failing = failingGPUs.some((gpu) => gpu.vendor === vendor && gpu.architecture === architecture)
  return failing ? `${vendor} ${architecture}` : null
}

async function startFallback(canvas: HTMLCanvasElement) {
  for (let attempt = 1; ; attempt++) {
    const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: true })
    try {
      return await renderer.init()
    } catch (error) {
      // dispose() rethrows the failed init's error and frees nothing, so three's context-lost listener stays on the canvas
      await renderer.dispose().catch(() => undefined)
      if (attempt === fallbackAttempts) throw error
      console.warn(`VisibleHuman: the WebGL 2 fallback failed to start (${String(error)}), so retrying`)
      await new Promise((resolve) => setTimeout(resolve, fallbackRetryDelay))
    }
  }
}

// Some GPUs offer WebGPU but can't compile three's shaders, such as the splat sort's on a 2014 Intel Iris.
// A GPUInternalError or a lost device switches to the WebGL 2 fallback; validation errors are bugs, so they don't
function watchForFailure(renderer: WebGPURenderer, fallBack: () => void) {
  const logError = renderer.onError
  const logDeviceLost = renderer.onDeviceLost
  let switching = false
  const switchToWebGL = (reason: string) => {
    if (switching) return
    switching = true
    console.warn(`VisibleHuman: ${reason}, so switching to the WebGL 2 fallback`)
    fallBack()
  }

  renderer.onError = (info) => {
    logError.call(renderer, info)
    // @types/three 0.187 types the argument as a string, but three passes { api, type, message, originalEvent }
    const details: unknown = info
    if (typeof details === 'object' && details !== null && 'type' in details && details.type === 'GPUInternalError') {
      switchToWebGL('WebGPU hit a GPUInternalError')
    }
  }
  renderer.onDeviceLost = (info) => {
    logDeviceLost.call(renderer, info)
    switchToWebGL(`the WebGPU device was lost (${info.message})`)
  }
}
