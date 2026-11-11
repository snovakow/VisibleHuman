import { folder, Leva, useControls } from 'leva'
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
import { levelKey, useStore, type Status } from './store.ts'
import { isStyle, styles } from './viewer/styles.ts'
import { levelOf } from './volume/levels.ts'

const statusText: Record<Status, string> = { loading: 'Loading…', ready: 'Ready', failed: '' }

// What a folder holds, as leva types it, which it exports only through folder itself
type FolderSchema = Parameters<typeof folder>[0]

// What a select shows before the list it chooses from has loaded
const loadingOption = { 'Loading…': '' }

// Wide enough for the longest label inside a folder beside the scrollbar a panel taller than the window shows
const panelTheme = { sizes: { rootWidth: '340px' } }

// The full path in the panel of an option's control, its folder and its key, which a render test reads it by, as it
// reads nothing from a bare key inside a folder
const pathOf = (option: keyof ViewOptions) => `${viewOptions[option].folder}.${option}`
const stylePath = pathOf('style')

// The styles by their labels in the panel
const styleOptions = Object.fromEntries(styles.map((style) => [style.label, style.id]))

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

// The leva panel: the view options go to the store as they change, Size when a drag or an edit ends, since a new
// Size rebuilds every splat. The Body, Level and Detail selects list what the store has loaded, a control or a choice
// the backend can't draw is left out, and the renderer, the grid, the splats shown, the surface's triangles and the
// load's status come back read-only
export function Panel({ renderer }: { renderer: string }) {
  const { level, detail, blend, density, trace, style, notBuilt, status, error } = useStore(
    useShallow((s) => ({
      level: s.level,
      detail: s.options.detail,
      blend: s.options.blend,
      density: s.options.density,
      trace: s.options.trace,
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

  const [, set] = useControls(() => {
    const { load, setOptions, options } = useStore.getState()

    // The control of one option, which sets the option as it changes, shown for the styles its entry names and while
    // the controls its entry depends on allow. Its value is the store's, so that a rebuilt panel keeps what's set. A
    // control the panel leaves out, for a capability the backend or the body lacks, is read at its default, where
    // the store holds it then, as Inner is on a body without an MRI
    const control = <K extends keyof ViewOptions>(option: K) => {
      const entry = viewOptions[option]
      const render =
        entry.shownFor !== 'every' || entry.shownWhile
          ? (get: (path: string) => unknown) => {
              const drawn = get(stylePath)
              const valueOf = (key: string) => {
                if (!isOption(key)) throw new Error(`No option is named ${key}`)
                return capable(viewOptions[key].needs, capabilities) ? get(pathOf(key)) : viewOptions[key].default
              }
              return isShown(entry, isStyle(drawn) ? drawn : viewOptions.style.default, valueOf)
            }
          : undefined
      const onChange = (value: ViewOptions[K]) => {
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
            if (!context.initial && ofOption(picked)) onChange(picked)
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
    // A folder's controls, in the table's order, less those the backend can't draw, as leva's schema, so that the
    // keys set below stay typed by name
    const controls = (name: Folder): FolderSchema =>
      Object.fromEntries(
        optionKeys
          .filter((option) => viewOptions[option].folder === name && capable(viewOptions[option].needs, capabilities))
          .map((option) => [option, control(option)]),
      )

    return {
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
      // Detail, Blend, Density and Trace are named beside the table's controls, which hold them already, so that set
      // below knows them by name
      Look: folder({
        ...controls('Look'),
        detail: control('detail'),
        blend: control('blend'),
        density: control('density'),
        trace: control('trace'),
      }),
      Cuts: folder(controls('Cuts')),
      // Scene starts folded: it holds what's drawn around the body, which a visitor reaches for after the look
      Scene: folder(controls('Scene'), { collapsed: true }),
      Info: folder({
        renderer: { label: 'Renderer', value: '', editable: false },
        grid: { label: 'Grid', value: '', editable: false },
        shown: { label: 'Splats shown', value: '', editable: false },
        triangles: { label: 'Triangles', value: '', editable: false },
        status: { label: 'Status', value: '', editable: false },
      }),
    }
  }, [bodyOptions, levelOptions, detailOptions, capabilities])

  // The store's choices go back to the selects, after leva has taken each rebuilt list, since a rebuilt control keeps
  // the value it held: a load picks its body, its level and its Detail, a level found not built goes back to the
  // one shown, and a Blend the backend turned out not to draw goes back to the default, as do a Density and a Trace
  // that read an MRI when a body without one is chosen. set is new whenever the lists are
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
