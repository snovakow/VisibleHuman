import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useState } from 'react'
import { Panel } from './Panel.tsx'
import { launchPreset, presetOf, presetOptions } from './presets.ts'
import { createRenderer, type Backend, type BackendReport } from './render/backend.ts'
import { pixelRatioFor } from './render/frame/plan.ts'
import { isStyle } from './render/styles/styles.ts'
import { useStore } from './store.ts'
import { frontView } from './viewer/viewAngle.ts'
import { Viewer } from './viewer/Viewer.tsx'

const search = new URLSearchParams(window.location.search)

// ?webgl in the page URL forces the WebGL 2 fallback, and ?webgpu tries WebGPU on a GPU known to fail it, to see a
// shader compiled there all the same
const requestedBackend: Backend = search.has('webgl') ? 'webgl' : search.has('webgpu') ? 'webgpu' : 'auto'

// ?preset=<id> opens on that preset, and an address that names no preset opens on the launch preset, unless it names
// a style: ?style=<id> alone opens on that style at the panel's defaults, framed from the front, as the page opened
// before it had presets, and beside a preset it takes the place of the preset's style. An unknown preset opens the
// launch one, and an unknown style is passed over, as if the address named none
const requestedPreset = search.get('preset')
const requestedStyle = search.get('style')
const preset = presetOf(requestedPreset) ?? (requestedPreset === null && isStyle(requestedStyle) ? null : launchPreset)
if (preset) useStore.getState().setOptions(presetOptions(preset))
if (isStyle(requestedStyle)) useStore.getState().setOptions({ style: requestedStyle })
// The angle every body is framed from
const framedFrom = preset?.view ?? frontView
// A page opened on a preset sways the view to and fro about the body, unless the visitor's system asks for less
// motion; one opened on a style alone holds still, as the page did before it had presets
const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
useStore.getState().setSwaying(preset !== null && !lessMotion)

// ?body=<id> opens on that body, and a body chosen in the panel is written there, so a reload or a shared link opens
// on the body shown. A page opened without it isn't given one until another body is chosen
const requestedBody = search.get('body')

// Writes the body into the page's URL, in place, without a new history entry; the first body, which a bare URL opens
// on, is written only over another
function writeBody(body: string, isFirst: boolean) {
  const written = new URLSearchParams(window.location.search).get('body')
  if (written === body || (written === null && isFirst)) return
  // The other parameters are kept as typed, as ?webgl, which URLSearchParams would write back as ?webgl=
  const others = window.location.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && !part.startsWith('body=') && part !== 'body')
  const query = [...others, `body=${encodeURIComponent(body)}`].join('&')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}${window.location.hash}`)
}

// The body is measured in millimetres and is about 1,900 of them tall, so the camera starts far enough back to see
// all of it from the front, until the framing fits it to the window
const camera = { fov: 50, near: 1, far: 20000, position: [0, 0, 2600] as const }

// The Visible Human Project's page at the NLM, whose terms ask for the credit
const creditUrl = 'https://www.nlm.nih.gov/research/visible/visible_human.html'

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
    void load(requestedBody, null, controller.signal)
    return () => controller.abort()
  }, [load])

  // The body shown goes into the URL
  const body = useStore((s) => s.body)
  const firstBody = useStore((s) => s.bodies?.[0]?.id)
  useEffect(() => {
    if (body !== null) writeBody(body, body === firstBody)
  }, [body, firstBody])

  const [backend, setBackend] = useState(requestedBackend)
  // The backend drawing, as the renderer reported it once it started
  const [started, setStarted] = useState<BackendReport | null>(null)
  const setCapabilities = useStore((s) => s.setCapabilities)
  // The Canvas's key follows the backend, so a switch to the fallback mounts a new Canvas whose factory forces it. The
  // store is told which effects the backend that started can draw, for the panel to offer those alone
  const gl = useCallback(
    ({ canvas }: { canvas: object }) =>
      createRenderer(
        canvas,
        backend,
        () => setBackend('webgl'),
        (report) => {
          setStarted(report)
          setCapabilities(report.capabilities, report.webgpu)
        },
      ),
    [backend, setCapabilities],
  )

  // The pixel ratio follows the style drawn and the backend drawing it. It's a Canvas prop, which R3F applies again
  // whenever it configures the Canvas
  const style = useStore((s) => s.options.style)
  const dpr = pixelRatioFor(style, started !== null && !started.webgpu)

  return (
    <>
      <Canvas key={backend} gl={gl} camera={camera} dpr={dpr} flat>
        <Viewer view={framedFrom} />
      </Canvas>
      <Panel renderer={started?.name ?? ''} />
      <LoadStatus />
      <a className="credit" href={creditUrl} target="_blank" rel="noreferrer">
        Images courtesy of the U.S. National Library of Medicine
      </a>
    </>
  )
}

export default App
