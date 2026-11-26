import { folder, Leva, levaStore, useControls } from 'leva'
import { createPlugin, styled, useInputContext } from 'leva/plugin'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  isOption,
  isShown,
  optionKeys,
  viewOptions,
  type Capabilities,
  type Capability,
  type Choice,
  type Folder,
  type ViewOptions,
} from './options.ts'
import { presetOptions, presets, type Preset } from './presets.ts'
import { isStyle, styles } from './render/styles/styles.ts'
import { levelKey, motionMoves, noMotion, scanMotion, styleMoves, useStore, type Status } from './store.ts'
import { levelOf } from './volume/levels.ts'

const statusText: Record<Status, string> = { loading: 'Loading…', ready: 'Ready', failed: '' }

// What a folder holds, as leva types it, which it exports only through folder itself
type FolderSchema = Parameters<typeof folder>[0]

// What a select shows before the list it chooses from has loaded
const loadingOption = { 'Loading…': '' }

// Wide enough for the longest label inside a folder beside the scrollbar a panel taller than the window shows
const panelTheme = { sizes: { rootWidth: '340px' } }

// A layer's control by the motion it mixes in, unique among the panel's keys, and its path in the panel
const layerKey = (id: string) => `layer:${id}`
const layerPath = (id: string) => `Motion.Layers.${layerKey(id)}`
// The fastest a clip plays, as a multiple of how it was written
const fastest = 2

// The full path in the panel of an option's control, its folder and its key, which a render test reads it by, as it
// reads nothing from a bare key inside a folder
const pathOf = (option: keyof ViewOptions) => `${viewOptions[option].folder}.${option}`
const stylePath = pathOf('style')

// The styles by their labels in the panel
const styleOptions = Object.fromEntries(styles.map((style) => [style.label, style.id]))

// The options a preset sets, every one but the Detail
const presetOptionKeys = optionKeys.filter((option) => option !== 'detail')

// Puts a preset's options in the store, and every control it sets at the store's option, as drawn. The useControls
// hook's set knows by name only the controls the panel names, so the panel's store is set by their paths, which calls
// no control's onChange as a pick, so nothing goes back to the store
function choose(preset: Preset) {
  useStore.getState().setOptions(presetOptions(preset))
  const { options } = useStore.getState()
  levaStore.set(Object.fromEntries(presetOptionKeys.map((option) => [pathOf(option), options[option]])), false)
}

// A row of buttons across the panel, each an equal share of it, drawn as leva draws its own buttons. leva's button
// group sets its buttons as bare text at the row's end, which doesn't read as buttons, and its single button takes a
// row each
interface RowButton {
  label: string
  onClick: () => void
}
const ButtonRowGrid = styled('div', { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', columnGap: '$colGap' })
const ButtonRowButton = styled('button', {
  $reset: '',
  fontWeight: '$button',
  height: '$rowHeight',
  borderStyle: 'none',
  borderRadius: '$sm',
  color: '$highlight3',
  backgroundColor: '$accent2',
  cursor: 'pointer',
  $hover: '$accent3',
  $active: '$accent3 $accent1',
  $focus: '',
})
function ButtonRowInput() {
  const { settings } = useInputContext<{ settings: { buttons: readonly RowButton[] } }>()
  return (
    <ButtonRowGrid>
      {settings.buttons.map(({ label, onClick }) => (
        <ButtonRowButton key={label} type="button" onClick={onClick}>
          {label}
        </ButtonRowButton>
      ))}
    </ButtonRowGrid>
  )
}
// Its value is nothing: a press acts, and leaves nothing set
const buttonRow = createPlugin<readonly RowButton[], string, { buttons: readonly RowButton[] }>({
  normalize: (buttons) => ({ value: '', settings: { buttons } }),
  component: ButtonRowInput,
})

// Whether the backend, or the body shown, has what a control or a choice needs; most need nothing
function capable(need: Capability | undefined, capabilities: Capabilities) {
  return need === undefined || capabilities[need]
}

// A choice's values by their labels, less those whose need the backend or the body shown lacks
function offeredChoices(entry: Choice<string | number>, capabilities: Capabilities): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(entry.choices).filter(([, value]) => capable(entry.choiceNeeds?.[value], capabilities)),
  )
}

// leva calls a control's onChange when it's built and rebuilt, with initial set and the value it held before, as well
// as when it's picked, and when set gives it a value, with fromPanel clear; only a pick is the user's
interface ChangeContext {
  initial: boolean
  fromPanel: boolean
}

// The leva panel's root, rendered outside StrictMode, whose second run of a folder's effects pins the folder at its
// first height, so a control a style shows would draw over the folder below. It comes before the app, so that it's in
// place before the panel's controls look for a panel and would otherwise mount one of their own.
// A value typed into a control is committed by Enter: leva updates the value on Enter but ends the edit only when the
// field loses focus, and a control that acts when an edit ends, Size among them, would wait for a click elsewhere, so
// Enter takes the focus from the field
export function PanelRoot() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const commitOnEnter = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur()
    }
    element.addEventListener('keydown', commitOnEnter)
    return () => element.removeEventListener('keydown', commitOnEnter)
  }, [])

  return (
    <div ref={root}>
      <Leva theme={panelTheme} />
    </div>
  )
}

// The leva panel: a preset's button at the top sets every view option but the Detail at once, the switch under them
// sways the view, and the view options go to the store as they're picked, Size when a drag or an edit ends, since a
// new Size rebuilds every splat. The Body, Level and Detail selects list what the store has loaded, a control the
// backend or the body shown can't use is hidden and a choice it can't draw left out, and the renderer, the grid, the
// splats shown, the surface's triangles and the load's status come back read-only
export function Panel({ renderer }: { renderer: string }) {
  const { level, detail, blend, density, trace, inner, oit, style, notBuilt, status, error } = useStore(
    useShallow((s) => ({
      level: s.level,
      detail: s.options.detail,
      blend: s.options.blend,
      density: s.options.density,
      trace: s.options.trace,
      inner: s.options.inner,
      oit: s.options.oit,
      style: s.options.style,
      notBuilt: s.notBuilt,
      status: s.status,
      error: s.error,
    })),
  )
  const capabilities = useStore((s) => s.capabilities)
  const bodies = useStore((s) => s.bodies)
  const body = useStore((s) => s.bodies?.find((candidate) => candidate.id === s.body))
  const levels = useStore((s) => s.levels)
  const details = useStore((s) => s.details)
  // The label of a Detail picked before its level was built, while the build goes on
  const waiting = useStore((s) => s.details?.find((each) => each.block === s.waiting)?.label)
  const grid = useStore((s) => s.volume?.size)
  const triangles = useStore((s) => s.triangles)
  const swaying = useStore((s) => s.swaying)
  const motion = useStore((s) => s.motion)
  const showJoints = useStore((s) => s.showJoints)
  const motions = useStore((s) => s.motions)
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const layers = useStore((s) => s.layers)
  // Whether what the body is drawn in changes over time, which Play, Speed and Step act on alone
  const moves = useStore(motionMoves)
  // A body with limbs has a rig, and can move; the head can't
  const rigged = body?.rig !== undefined
  // The splats shown, while the splats are the style drawn: the shown Detail's level is always built
  const shown = levels && style === 'splats' ? levelOf(levels, detail)?.count : undefined
  // The surface's triangles, each mesh's by name, while the surface is the style drawn
  const meshed =
    style === 'surface'
      ? Object.entries(triangles)
          .map(([kind, count]) => `${count.toLocaleString('en')} ${kind}`)
          .join(', ')
      : ''

  // The selects' options: the bodies, the body's levels, each marked where the host hasn't got its file, and its
  // Details by their spacing, coarsest first, every one the body has whether its level is built yet or not
  const bodyOptions = useMemo(
    () => (bodies ? Object.fromEntries(bodies.map((each) => [each.label, each.id])) : loadingOption),
    [bodies],
  )
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
    () => (details ? Object.fromEntries(details.toReversed().map((each) => [each.label, each.block])) : null),
    [details],
  )
  // The motions: none, as the body has always been drawn, the pose it was scanned in, and the library's, once its index
  // is in
  const motionOptions = useMemo(
    () => ({ none: noMotion, 'as scanned': scanMotion, ...Object.fromEntries((motions ?? []).map((each) => [each.label, each.id])) }),
    [motions],
  )
  // The motions the library offers as layers, once its index is in
  const layerEntries = useMemo(() => (motions ?? []).filter((each) => each.layer), [motions])
  useEffect(() => {
    useStore.getState().loadMotions()
  }, [])

  const [, set] = useControls(() => {
    const { load, setOptions, options } = useStore.getState()
    // Whether a motion is drawn, which the motion's controls act on: the body has limbs, the style moves them and a
    // motion is picked; and whether, besides, what it's drawn in changes over time
    const posing = (get: (path: string) => unknown) => rigged && styleMoves(get(stylePath)) && get('Motion.motion') !== noMotion
    const moving = (get: (path: string) => unknown) => posing(get) && moves
    // A slider for each layer the library offers, its weight as the store has it. Each is shown by its own rule, and
    // the folder with them: leva keeps a folder's settings from the first time it meets it, so a rule of the folder's
    // own would go on reading what the panel held then
    const layerControls = (): FolderSchema =>
      Object.fromEntries(
        layerEntries.map((entry) => [
          layerKey(entry.id),
          {
            label: entry.label,
            value: useStore.getState().layers[entry.id] ?? 0,
            min: 0,
            max: 1,
            step: 0.05,
            transient: false,
            render: (get: (path: string) => unknown) => posing(get),
            onChange: (picked: unknown, _path: string, context: ChangeContext) => {
              if (context.initial || !context.fromPanel || typeof picked !== 'number') return
              useStore.getState().setLayer(entry.id, picked)
            },
          },
        ]),
      )

    // The control of one option, which sets the option as it's picked, shown for the styles its entry names and while
    // the controls its entry depends on allow. Its value is the store's, so that a rebuilt panel keeps what's set. A
    // control the backend or the body shown can't use, as Inner on a body without an MRI, stays in the panel hidden,
    // so that it keeps its place among the others and takes the store's value as set echoes it; the others' rules
    // read it at its default, which the store draws then
    const control = <K extends keyof ViewOptions>(option: K) => {
      const entry = viewOptions[option]
      const render =
        entry.shownFor !== 'every' || entry.shownWhile || entry.needs !== undefined
          ? (get: (path: string) => unknown) => {
              if (!capable(entry.needs, capabilities)) return false
              const drawn = get(stylePath)
              const valueOf = (key: string) => {
                if (!isOption(key)) throw new Error(`No option is named ${key}`)
                return capable(viewOptions[key].needs, capabilities) ? get(pathOf(key)) : viewOptions[key].default
              }
              return isShown(entry, isStyle(drawn) ? drawn : viewOptions.style.default, valueOf)
            }
          : undefined
      // Only a pick goes to the store: leva also calls this as it builds a control, with the value it held, and as set
      // echoes the store's value, which would hand a value the store drew in place of a pick back to it as one
      const onChange = (value: ViewOptions[K], _path?: string, context?: ChangeContext) => {
        if (context && (context.initial || !context.fromPanel)) return
        const changes: Partial<ViewOptions> = {}
        changes[option] = value
        setOptions(changes)
      }
      // Whether a value leva hands back is the option's kind of value, which a slider's number is
      const ofOption = (value: unknown): value is ViewOptions[K] => typeof value === typeof entry.default
      const visible = render ? { render } : {}
      // Inside a folder, leva's types leave a control with an onChange out of set unless it's told not to be transient
      const common = { label: entry.label, transient: false as const, ...visible }
      const current = options[option]
      if (entry.kind === 'slider') {
        const value = typeof current === 'number' ? current : entry.default
        const range = { value, min: entry.min, max: entry.max, step: entry.step }
        // A deferred slider has no onChange: its value is committed when the drag or the edit ends, and nothing sets it
        if (entry.deferred) {
          return {
            label: entry.label,
            ...visible,
            ...range,
            onEditEnd: (ended: unknown) => {
              if (ofOption(ended)) onChange(ended)
            },
          }
        }
        return { ...common, ...range, onChange }
      }
      if (entry.kind === 'detail') {
        return {
          ...common,
          options: detailOptions ?? loadingOption,
          value: detailOptions ? options.detail : '',
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (!context.initial && context.fromPanel && ofOption(picked)) onChange(picked)
          },
        }
      }
      if (entry.kind === 'switch') {
        return { ...common, value: typeof current === 'boolean' ? current : entry.default, onChange }
      }
      if (entry.kind === 'choice') {
        const offered = offeredChoices(entry, capabilities)
        const choices: readonly unknown[] = Object.values(offered)
        return { ...common, options: offered, value: choices.includes(current) ? current : entry.default, onChange }
      }
      return { ...common, options: styleOptions, value: isStyle(current) ? current : entry.default, onChange }
    }
    // A folder's controls, in the table's order, as leva's schema, so that the keys set below stay typed by name
    const controls = (name: Folder): FolderSchema =>
      Object.fromEntries(optionKeys.filter((option) => viewOptions[option].folder === name).map((option) => [option, control(option)]))

    return {
      // The presets come first, as the quickest way to a finished look: a button each, in one row across the panel. A
      // press sets every option but the Detail, those the preset doesn't name at their defaults, so pressed again it
      // puts back what's been moved since; the view stays where it was left. Under them, the sway's switch, which the
      // visitor's first move of the view turns off
      Presets: folder({
        presets: buttonRow(presets.map((preset) => ({ label: preset.id, onClick: () => choose(preset) }))),
        sway: {
          label: 'Sway',
          value: useStore.getState().swaying,
          transient: false,
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel || typeof picked !== 'boolean') return
            useStore.getState().setSwaying(picked)
          },
        },
      }),
      // The motion the body is drawn in, while it has limbs to move and the style draws them moving; for a motion that
      // changes over time, whether it plays and how fast, or, held, a step a frame on; whether its joints are drawn
      // over it; and the layers mixed over it, each by a weight
      Motion: folder({
        motion: {
          label: 'Motion',
          options: motionOptions,
          value: useStore.getState().motion,
          transient: false,
          render: (get) => rigged && styleMoves(get(stylePath)),
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel || typeof picked !== 'string') return
            useStore.getState().setMotion(picked)
          },
        },
        play: {
          label: 'Play',
          value: useStore.getState().playing,
          transient: false,
          render: (get) => moving(get),
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel || typeof picked !== 'boolean') return
            useStore.getState().setPlaying(picked)
          },
        },
        speed: {
          label: 'Speed',
          value: useStore.getState().speed,
          min: 0,
          max: fastest,
          step: 0.05,
          transient: false,
          render: (get) => moving(get) && get('Motion.play') === true,
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel || typeof picked !== 'number') return
            useStore.getState().setSpeed(picked)
          },
        },
        step: {
          ...buttonRow([{ label: 'Step', onClick: () => useStore.getState().step() }]),
          render: (get) => moving(get) && get('Motion.play') === false,
        },
        joints: {
          label: 'Joints',
          value: useStore.getState().showJoints,
          transient: false,
          render: (get) => posing(get),
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel || typeof picked !== 'boolean') return
            useStore.getState().setShowJoints(picked)
          },
        },
        Layers: folder(layerControls()),
      }),
      Body: folder({
        body: {
          label: 'Body',
          options: bodyOptions,
          value: useStore.getState().body ?? '',
          transient: false,
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            if (context.initial || !context.fromPanel) return
            if (typeof picked === 'string' && picked !== '' && picked !== useStore.getState().body) {
              void load(picked, null)
            }
          },
        },
        level: {
          label: 'Level',
          options: levelOptions,
          value: useStore.getState().level ?? '',
          transient: false,
          onChange: (picked: unknown, _path: string, context: ChangeContext) => {
            const state = useStore.getState()
            if (context.initial || !context.fromPanel || typeof picked !== 'string' || picked === state.level || !state.body) return
            void state.load(state.body, picked)
          },
        },
      }),
      // Detail, Blend, Density, Trace, Inner and OIT are named beside the table's controls, which hold them already in
      // their places, so that set below knows them by name
      Look: folder({
        ...controls('Look'),
        detail: control('detail'),
        blend: control('blend'),
        density: control('density'),
        trace: control('trace'),
        inner: control('inner'),
      }),
      Cuts: folder(controls('Cuts')),
      // Scene starts folded: it holds what's drawn around the body, which a visitor reaches for after the look
      Scene: folder({ ...controls('Scene'), oit: control('oit') }, { collapsed: true }),
      // The splats shown and the surface's triangles are read out only for the style that draws them
      Info: folder({
        renderer: { label: 'Renderer', value: '', editable: false },
        grid: { label: 'Grid', value: '', editable: false },
        shown: { label: 'Splats shown', value: '', editable: false, render: (get) => get(stylePath) === 'splats' },
        triangles: { label: 'Triangles', value: '', editable: false, render: (get) => get(stylePath) === 'surface' },
        status: { label: 'Status', value: '', editable: false },
      }),
    }
  }, [bodyOptions, levelOptions, detailOptions, motionOptions, layerEntries, rigged, moves, capabilities])

  // The store's choices go back to the controls, after leva has taken each rebuilt list, since a rebuilt control keeps
  // the value it held: a load picks its body, its level and its Detail, a level found not built goes back to the
  // one shown, and an option the backend or the body can't draw shows the default the store draws in its place, and
  // its pick again once it can: Blend and OIT on a backend without them, and Density, Trace and Inner on a body
  // without an MRI. set is new whenever the lists are
  useEffect(() => {
    if (body) set({ body: body.id })
  }, [set, body])
  useEffect(() => {
    if (level !== null && body) set({ level })
  }, [set, level, body])
  useEffect(() => {
    if (detailOptions) set({ detail })
  }, [set, detail, detailOptions])
  useEffect(() => {
    set({ blend })
  }, [set, blend])
  useEffect(() => {
    set({ density })
  }, [set, density])
  useEffect(() => {
    set({ trace })
  }, [set, trace])
  useEffect(() => {
    set({ inner })
  }, [set, inner])
  useEffect(() => {
    set({ oit })
  }, [set, oit])
  // The sway stops when the visitor moves the view, which the switch shows
  useEffect(() => {
    set({ sway: swaying })
  }, [set, swaying])
  // The motion as the store has it, after leva has taken each rebuilt list: a motion the library turned out not to
  // have goes back to none
  useEffect(() => {
    set({ motion, joints: showJoints, play: playing, speed })
  }, [set, motion, showJoints, playing, speed])
  // The layers' weights, set by their paths, as set knows by name only the controls the panel names
  useEffect(() => {
    if (layerEntries.length > 0) levaStore.set(Object.fromEntries(layerEntries.map((entry) => [layerPath(entry.id), layers[entry.id] ?? 0])), false)
  }, [layerEntries, layers])
  useEffect(() => {
    set({
      renderer: renderer || 'Starting…',
      grid: grid ? `${grid.join(' × ')} voxels` : '',
      shown: shown === undefined ? '' : shown.toLocaleString('en'),
      triangles: meshed,
      status: error ?? (waiting && status === 'ready' ? `Building the ${waiting} level…` : statusText[status]),
    })
  }, [set, renderer, grid, shown, meshed, status, error, waiting])

  return null
}
