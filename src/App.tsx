import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useState } from 'react'
import { Panel } from './Panel.tsx'
import { useStore } from './store.ts'
import { createRenderer, type Backend } from './viewer/renderer.ts'
import { isStyle } from './viewer/styles.ts'
import { Viewer } from './viewer/Viewer.tsx'

const search = new URLSearchParams(window.location.search)

// ?webgl in the page URL forces the WebGL 2 fallback, and ?webgpu tries WebGPU on a GPU known to fail it, to see a
// shader compiled there all the same
const requestedBackend: Backend = search.has('webgl') ? 'webgl' : search.has('webgpu') ? 'webgpu' : 'auto'

// ?style=<id> opens on that style
const requestedStyle = search.get('style')
if (isStyle(requestedStyle)) useStore.getState().setOptions({ style: requestedStyle })

// The body is measured in millimetres and is about 1,900 of them tall, so the camera starts far enough back to see
// all of it from the front, until the framing fits it to the window
const camera = { fov: 50, near: 1, far: 20000, position: [0, 0, 2600] as const }

// The pixel ratios the Canvas draws at: the device's, up to 2, unless a style that shades every pixel of the window
// runs on the WebGL 2 fallback, where the ratio is held at 1 to keep its frame rate
const fullDpr: [number, number] = [1, 2]
const fallbackQuadDpr = 1

// The Visible Human Project's page at the NLM, whose terms ask for the credit
const creditUrl = 'https://www.nlm.nih.gov/research/visible/visible_human.html'

// Which backend is drawing, as the renderer reported it: its name for the panel, and whether it's WebGPU
interface Drawing {
  renderer: string
  webgpu: boolean
}

// While the volume loads, the page says so, and a failed load shows why
function LoadStatus() {
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  if (status === 'ready') return null
  return (
    <div className={status === 'failed' ? 'load-status load-failed' : 'load-status'} role="status">
      {status === 'failed' ? `The body couldn't be loaded. ${error ?? ''}` : 'Loading the body…'}
    </div>
  )
}

function App() {
  // The store lives outside the Canvas, so the volume loads once and survives a switch to the fallback. The abort
  // lets StrictMode's second mount take over the load from its first
  const load = useStore((s) => s.load)
  useEffect(() => {
    const controller = new AbortController()
    void load(null, null, controller.signal)
    return () => controller.abort()
  }, [load])

  const [backend, setBackend] = useState(requestedBackend)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  // The Canvas's key follows the backend, so a switch to the fallback mounts a new Canvas whose factory forces it
  const gl = useCallback(
    ({ canvas }: { canvas: object }) =>
      createRenderer(
        canvas,
        backend,
        () => setBackend('webgl'),
        (renderer, webgpu) => setDrawing({ renderer, webgpu }),
      ),
    [backend],
  )

  // The volume and raytrace styles shade every pixel of the window from one quad, which the fallback draws at a
  // pixel ratio of 1. The ratio is a Canvas prop, which R3F applies again whenever it configures the Canvas
  const quadStyle = useStore((s) => s.options.style === 'volume' || s.options.style === 'raytrace')
  const dpr = drawing && !drawing.webgpu && quadStyle ? fallbackQuadDpr : fullDpr

  return (
    <>
      <Canvas key={backend} gl={gl} camera={camera} dpr={dpr} flat>
        <Viewer />
      </Canvas>
      <Panel renderer={drawing?.renderer ?? ''} />
      <LoadStatus />
      <a className="credit" href={creditUrl} target="_blank" rel="noreferrer">
        Images courtesy of the U.S. National Library of Medicine
      </a>
    </>
  )
}

export default App
