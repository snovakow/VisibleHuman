import { create, type StoreApi } from 'zustand'
import { shallow } from 'zustand/shallow'
import { defaultOptions, drawableOptions, type BackendCapabilities, type Capabilities, type ViewOptions } from './options.ts'
import { defaultLevel, type BodyEntry } from './volume/bodies.ts'
import type { Volume } from './volume/format.ts'
import { levelOf, stageBody, type Bounds, type Detail, type DetailEntry, type Levels, type StagedBody } from './volume/levels.ts'
import type { SurfaceKind } from './surface/surfaceWorker.ts'
import { isAbort, loadBodies, loadVolume, NotBuiltError } from './volume/loadVolume.ts'

export type Status = 'loading' | 'ready' | 'failed'

// A level by its body and its id, as notBuilt lists it
export const levelKey = (body: string, level: string) => `${body}/${level}`

interface State {
  // The bodies and their levels, from bodies.json, once it has loaded
  bodies: readonly BodyEntry[] | null
  // The body and the level shown, or being loaded
  body: string | null
  level: string | null
  // The load's progress, and its message if it failed
  status: Status
  error: string | null
  // Levels whose files this host turned out not to have, by levelKey
  notBuilt: readonly string[]
  // The level's volume, the body's bounds in it, its splat levels built so far, and every Detail it has, built or not.
  // The opening level is built before the body is ready, and the others after its first frame
  volume: Volume | null
  bounds: Bounds | null
  levels: Levels | null
  details: readonly DetailEntry[] | null
  // A Detail picked before its level was built, which the options take once it is, the level drawn staying till then
  waiting: Detail | null
  // Called by a style when it first draws a body's volume, which starts the build of the levels still to build
  drawn: (volume: Volume) => void
  // Loads a level of a body, the body's default level where level is null and the first body where body is null or
  // names none.
  // A load replaces any still in progress, and an older load never overwrites a newer one. Aborting the signal
  // stops the load and leaves the status to the load that takes over
  load: (body: string | null, level: string | null, signal?: AbortSignal) => Promise<void>
  // The view options, as the panel sets them from the table in options.ts, held to what the backend can draw
  options: ViewOptions
  setOptions: (changes: Partial<ViewOptions>) => void
  // What the backend drawing can make of the effects that need more than a plain frame, as the renderer found when it
  // started: everything, until one says otherwise; and whether the body shown has an MRI. The panel leaves out what's
  // missing
  capabilities: Capabilities
  setCapabilities: (backend: BackendCapabilities) => void
  // The triangles in each of the surface style's meshes, while it's drawn, for the panel
  triangles: Partial<Record<SurfaceKind, number>>
  setTriangles: (kind: SurfaceKind, count: number | undefined) => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The load in progress, which the next one aborts, and the level whose volume the store holds
let current: AbortController | null = null
let shown: { body: string; level: string } | null = null

// The levels still to build after the first frame are built in slices of about this many milliseconds, one task each,
// so a frame waits at most about this long for one. The build takes this many body voxels at a time between looks at
// the clock, which on a 2014 Intel Mac takes about 1.4 ms
const sliceMs = 8
const sliceVoxels = 16_384

// The volume shown, its levels as they're built, and whether the build of the rest has started
let staging: { volume: Volume; body: string; staged: StagedBody; started: boolean } | null = null

// Builds the levels still to build, a slice at a time from a task of its own, the level waited for first, until a
// new volume replaces this one
function buildRest(set: StoreApi<State>['setState'], get: StoreApi<State>['getState']) {
  const mine = staging
  if (!mine || mine.started) return
  mine.started = true
  const start = performance.now()
  // The levels built with the opening, by the search for it, which the log of the rest leaves out
  const builtFirst = mine.staged.levels
  let slices = 0
  const slice = () => {
    if (staging !== mine) return
    const { staged } = mine
    const before = staged.levels
    const end = performance.now() + sliceMs
    let more = true
    while (more && performance.now() < end) more = staged.advance(sliceVoxels, get().waiting ?? undefined)
    slices++
    if (staged.levels !== before) {
      const { waiting, options, capabilities } = get()
      const arrived = waiting !== null && levelOf(staged.levels, waiting) !== undefined
      set({
        levels: staged.levels,
        details: staged.details,
        ...(arrived ? { waiting: null, options: drawableOptions({ ...options, detail: waiting }, capabilities) } : {}),
      })
    }
    if (more) {
      setTimeout(slice, 0)
      return
    }
    const rest = staged.levels.filter((level) => !builtFirst.includes(level))
    const counts = rest.map((each) => `${each.count.toLocaleString('en')} at ${each.label}`)
    console.info(
      `VisibleHuman: the ${mine.body}'s other levels, as ${counts.join(', ') || 'none'}, built in ` +
        `${Math.round(performance.now() - start)} ms over ${slices} slices after its first frame`,
    )
  }
  setTimeout(slice, 0)
}

export const useStore = create<State>()((set, get) => ({
  bodies: null,
  body: null,
  level: null,
  status: 'loading',
  error: null,
  notBuilt: [],
  volume: null,
  bounds: null,
  levels: null,
  details: null,
  waiting: null,
  drawn: (volume) => {
    if (staging?.volume === volume) buildRest(set, get)
  },
  options: defaultOptions,
  // Unchanged values keep the same options object, so the scene doesn't redo anything for nothing. A Detail whose
  // level is still to build waits for it, and the level it's built ahead of the others; one the body hasn't got is
  // left as it was
  setOptions: (changes) => {
    let taken = changes
    const { levels, details, waiting } = get()
    const { detail } = changes
    if (detail !== undefined && levels && !levelOf(levels, detail)) {
      const { detail: _, ...rest } = changes
      taken = rest
      if (details?.some((entry) => entry.block === detail)) {
        set({ waiting: detail })
        buildRest(set, get)
      }
    } else if (detail !== undefined && waiting !== null) set({ waiting: null })
    set((state) => {
      const options = drawableOptions({ ...state.options, ...taken }, state.capabilities)
      return shallow(options, state.options) ? state : { options }
    })
  },
  capabilities: { weighted: true, oit: true, mri: false },
  // A backend that lacks something takes the options that need it back to their defaults, as a switch to the
  // fallback may with an effect on
  setCapabilities: (backend) =>
    set((state) => {
      const capabilities = { ...state.capabilities, ...backend }
      if (shallow(capabilities, state.capabilities)) return state
      return { capabilities, options: drawableOptions(state.options, capabilities) }
    }),
  triangles: {},
  setTriangles: (kind, count) =>
    set((state) => {
      if (state.triangles[kind] === count) return state
      const triangles = { ...state.triangles }
      if (count === undefined) delete triangles[kind]
      else triangles[kind] = count
      return { triangles }
    }),
  load: async (bodyId, levelId, signal) => {
    current?.abort()
    const controller = new AbortController()
    current = controller
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    const isLatest = () => current === controller && !controller.signal.aborted

    try {
      let { bodies } = get()
      if (!bodies) {
        set({ status: 'loading', error: null })
        bodies = (await loadBodies(controller.signal)).bodies
        if (!isLatest()) return
        set({ bodies })
      }
      // A name no body has, as a mistyped ?body= gives, opens the first body, as an unknown ?style= opens the first style
      const body = bodies.find((candidate) => candidate.id === bodyId) ?? bodies[0]
      const level = levelId === null ? defaultLevel(body) : body.levels.find((candidate) => candidate.id === levelId)
      if (!level) throw new Error(`The ${body.id} has no level ${levelId}`)

      // Back to the level already held, which a load in progress was replacing
      if (shown?.body === body.id && shown.level === level.id && get().volume) {
        set({ body: body.id, level: level.id, status: 'ready', error: null })
        return
      }
      // Another body's levels and bounds go at once; another level of the same body stays shown while this loads
      const sameBody = shown?.body === body.id
      if (!sameBody) shown = null
      set({
        body: body.id,
        level: level.id,
        status: 'loading',
        error: null,
        ...(sameBody ? {} : { volume: null, bounds: null, levels: null, details: null, waiting: null }),
      })
      if (!sameBody) staging = null

      let loaded
      try {
        loaded = await loadVolume(level, controller.signal)
      } catch (error) {
        if (!(error instanceof NotBuiltError) || level.default || !isLatest()) throw error
        // A level the host doesn't have is marked so the panel says so, and the body stays on the level it showed,
        // or opens on its default
        const held = shown && body.levels.find((candidate) => candidate.id === shown?.level)
        console.info(`VisibleHuman: ${error.message}, so the ${body.id} stays on ${held ? held.label : 'its default'}`)
        set({ notBuilt: [...get().notBuilt, levelKey(body.id, level.id)] })
        if (shown) set({ level: shown.level, status: 'ready' })
        else void get().load(body.id, null, signal)
        return
      }
      if (!isLatest()) return

      // A new level of the same body keeps the Detail's spacing where it has it; otherwise the level's own default.
      // That level is built first, and the others once the body has drawn
      const { options, levels: before, capabilities: held } = get()
      const label = sameBody && before ? levelOf(before, options.detail)?.label : undefined
      const start = performance.now()
      const staged = stageBody(loaded.volume, { opening: label })
      const buildMs = performance.now() - start
      const { bounds, opening } = staged
      shown = { body: body.id, level: level.id }
      staging = { volume: loaded.volume, body: body.id, staged, started: false }
      // A body without an MRI takes the options that read one back to their defaults
      const mri = loaded.volume.mri !== undefined
      const capabilities = held.mri === mri ? held : { ...held, mri }
      set({
        status: 'ready',
        volume: loaded.volume,
        bounds,
        levels: staged.levels,
        details: staged.details,
        waiting: null,
        capabilities,
        options: drawableOptions({ ...options, detail: opening.block }, capabilities),
      })

      const extent = bounds.half.map((half) => Math.round(half * 2)).join(' × ')
      const others = staged.details.filter((each) => !levelOf(staged.levels, each.block)).length
      console.info(
        `VisibleHuman: ${level.file}, ${loaded.bytes.toLocaleString('en')} bytes, decoded in ` +
          `${Math.round(loaded.gunzipMs + loaded.readMs)} ms (gunzip ${Math.round(loaded.gunzipMs)} ms, ` +
          `read ${Math.round(loaded.readMs)} ms); the body, ${extent} mm, as ` +
          `${opening.count.toLocaleString('en')} at ${opening.label}, built in ${Math.round(buildMs)} ms, and ` +
          `${others} more ${others === 1 ? 'level' : 'levels'} after its first frame`,
      )
    } catch (error) {
      if (isAbort(error) || !isLatest()) return
      const message = messageOf(error)
      set({ status: 'failed', error: message })
      console.warn(`VisibleHuman: ${message}`)
    } finally {
      signal?.removeEventListener('abort', abort)
      if (current === controller) current = null
    }
  },
}))
