import { Canvas } from '@react-three/fiber'
import { useControls } from 'leva'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { levelKey, useStore, type ViewOptions } from './store.ts'
import { createRenderer } from './viewer/renderer.ts'
import { Viewer } from './viewer/Viewer.tsx'
import { levelOf } from './volume/levels.ts'

// ?webgl in the page URL forces the WebGL 2 fallback
const webglRequested = new URLSearchParams(window.location.search).has('webgl')

// The body is measured in millimetres and is about 1,900 of them tall, so the camera starts far enough back to see
// all of it from the front, until the framing fits it to the window
const camera = { fov: 50, near: 1, far: 20000, position: [0, 0, 2600] as const }

// The Visible Human Project's page at the NLM, whose terms ask for the credit
const creditUrl = 'https://www.nlm.nih.gov/research/visible/visible_human.html'

// What a select shows before the list it chooses from has loaded
const loadingOption = { 'Loading…': '' }

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

// leva calls a select's onChange when it's built and rebuilt, with initial set, as well as when it's picked; only a
// pick is the user's
interface ChangeContext {
  initial: boolean
}

// The leva panel: the view options go to the store as they change, Size when a drag or an edit ends, since a new
// Size rebuilds every splat. The Level and Detail selects list what the store has loaded, and the splats shown and
// the renderer come back read-only
function Panel({ renderer }: { renderer: string }) {
  const { level, detail, notBuilt } = useStore(
    useShallow((s) => ({ level: s.level, detail: s.options.detail, notBuilt: s.notBuilt })),
  )
  const body = useStore((s) => s.bodies?.find((candidate) => candidate.id === s.body))
  const levels = useStore((s) => s.levels)
  const shown = levels ? levelOf(levels, detail)?.count : undefined

  // The selects' options: the body's levels, each marked where the host hasn't got its file, and its splat levels
  // by their spacing, coarsest first
  const levelOptions = useMemo(
    () =>
      body
        ? Object.fromEntries(
            body.levels.map((each) => [
              notBuilt.includes(levelKey(body.id, each.id)) ? `${each.label}, not built` : each.label,
              each.id,
            ]),
          )
        : loadingOption,
    [body, notBuilt],
  )
  const detailOptions = useMemo(
    () => (levels ? Object.fromEntries(levels.toReversed().map((each) => [each.label, each.block])) : null),
    [levels],
  )

  const [, set] = useControls(() => {
    const { setOptions, options } = useStore.getState()
    const slider = (option: Slider) => ({
      ...sliders[option],
      value: options[option],
      step: sliderStep,
      onChange: (value: number) => setOptions({ [option]: value }),
    })
    return {
      level: {
        label: 'Level',
        options: levelOptions,
        value: useStore.getState().level ?? '',
        onChange: (picked: unknown, _path: string, context: ChangeContext) => {
          const state = useStore.getState()
          if (context.initial || typeof picked !== 'string' || picked === state.level || !state.body) return
          void state.load(state.body, picked)
        },
      },
      detail: {
        label: 'Detail',
        options: detailOptions ?? loadingOption,
        value: detailOptions ? options.detail : '',
        onChange: (picked: unknown, _path: string, context: ChangeContext) => {
          if (!context.initial && typeof picked === 'number') setOptions({ detail: picked })
        },
      },
      // No onChange: the value is committed when the drag or the edit ends
      size: {
        ...sliders.size,
        value: options.size,
        step: sliderStep,
        onEditEnd: (value: unknown) => {
          if (typeof value === 'number') setOptions({ size: value })
        },
      },
      opacity: slider('opacity'),
      axial: slider('axial'),
      coronal: slider('coronal'),
      sagittal: slider('sagittal'),
      shown: { label: 'Splats shown', value: '', editable: false },
      renderer: { label: 'Renderer', value: '', editable: false },
    }
  }, [levelOptions, detailOptions])

  // The store's choices go back to the selects, after leva has taken each rebuilt list: a load picks its Detail, and
  // a level found not built goes back to the one shown. set is new whenever the lists are
  useEffect(() => {
    if (detailOptions) set({ detail })
  }, [set, detail, detailOptions])
  useEffect(() => {
    if (level !== null && body) set({ level })
  }, [set, level, body])
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
    void load(null, null, controller.signal)
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
