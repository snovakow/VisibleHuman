import { Canvas } from '@react-three/fiber'
import { useControls } from 'leva'
import { useCallback, useEffect, useState } from 'react'
import { defaultOptions, useStore, type ViewOptions } from './store.ts'
import { createRenderer } from './viewer/renderer.ts'
import { Viewer } from './viewer/Viewer.tsx'
import { details, isDetail } from './volume/levels.ts'

// ?webgl in the page URL forces the WebGL 2 fallback
const webglRequested = new URLSearchParams(window.location.search).has('webgl')

// The body is measured in millimetres and is about 1,900 of them tall, so the camera starts far enough back to see
// all of it from the front, until the framing fits it to the window
const camera = { fov: 50, near: 1, far: 20000, position: [0, 0, 2600] as const }

// The Visible Human Project's page at the NLM, whose terms ask for the credit
const creditUrl = 'https://www.nlm.nih.gov/research/visible/visible_human.html'

// The levels as Detail lists them, such as "8 mm"
const detailOptions = Object.fromEntries(details.map((detail) => [`${detail} mm`, detail]))

// The sliders' ranges, each in steps of a hundredth, the finest leva shows
type Slider = keyof Omit<ViewOptions, 'detail'>
const sliders: Record<Slider, { label: string; min: number; max: number }> = {
  size: { label: 'Size', min: 0.5, max: 2 },
  opacity: { label: 'Opacity', min: 0, max: 1 },
  axial: { label: 'Axial', min: 0, max: 1 },
  coronal: { label: 'Coronal', min: 0, max: 1 },
  sagittal: { label: 'Sagittal', min: 0, max: 1 },
}
const sliderStep = 0.01

// The leva panel: the view options go to the store as they change, and the splats shown and the renderer come back
// read-only
function Panel({ renderer }: { renderer: string }) {
  const shown = useStore((s) => s.levels?.[s.options.detail].count)

  const [, set] = useControls(() => {
    const { setOptions } = useStore.getState()
    const slider = (option: Slider) => ({
      ...sliders[option],
      value: defaultOptions[option],
      step: sliderStep,
      onChange: (value: number) => setOptions({ [option]: value }),
    })
    return {
      detail: {
        label: 'Detail',
        options: detailOptions,
        value: defaultOptions.detail,
        onChange: (detail: unknown) => {
          if (isDetail(detail)) setOptions({ detail })
        },
      },
      size: slider('size'),
      opacity: slider('opacity'),
      axial: slider('axial'),
      coronal: slider('coronal'),
      sagittal: slider('sagittal'),
      shown: { label: 'Splats shown', value: '', editable: false },
      renderer: { label: 'Renderer', value: '', editable: false },
    }
  })

  useEffect(() => {
    set({ shown: shown === undefined ? '' : shown.toLocaleString('en'), renderer: renderer || 'Starting…' })
  }, [set, shown, renderer])

  return null
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
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const [forceWebGL, setForceWebGL] = useState(webglRequested)
  const [renderer, setRenderer] = useState('')
  // The Canvas's key follows the flag, so setting it mounts a new Canvas whose factory forces the fallback
  const gl = useCallback(
    ({ canvas }: { canvas: object }) => createRenderer(canvas, forceWebGL, () => setForceWebGL(true), setRenderer),
    [forceWebGL],
  )

  return (
    <>
      <Canvas key={forceWebGL ? 'webgl' : 'webgpu'} gl={gl} camera={camera} flat>
        <Viewer />
      </Canvas>
      <Panel renderer={renderer} />
      <LoadStatus />
      <a className="credit" href={creditUrl} target="_blank" rel="noreferrer">
        Images courtesy of the U.S. National Library of Medicine
      </a>
    </>
  )
}

export default App
