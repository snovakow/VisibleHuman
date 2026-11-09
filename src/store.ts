import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { defaultOptions, type ViewOptions } from './options.ts'
import { defaultLevel, type BodyEntry } from './volume/bodies.ts'
import type { Volume } from './volume/format.ts'
import { buildBody, levelOf, type Bounds, type Levels } from './volume/levels.ts'
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
  // The level's volume, the body's bounds in it and its splat levels
  volume: Volume | null
  bounds: Bounds | null
  levels: Levels | null
  // Loads a level of a body, the body's default level where level is null and the first body where body is null.
  // A load replaces any still in progress, and an older load never overwrites a newer one. Aborting the signal
  // stops the load and leaves the status to the load that takes over
  load: (body: string | null, level: string | null, signal?: AbortSignal) => Promise<void>
  // The view options, as the panel sets them from the table in options.ts
  options: ViewOptions
  setOptions: (changes: Partial<ViewOptions>) => void
  // The triangles in each of the surface style's meshes, while it's drawn, for the panel
  triangles: Partial<Record<SurfaceKind, number>>
  setTriangles: (kind: SurfaceKind, count: number | undefined) => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The load in progress, which the next one aborts, and the level whose volume the store holds
let current: AbortController | null = null
let shown: { body: string; level: string } | null = null

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
  options: defaultOptions,
  // Unchanged values keep the same options object, so the scene doesn't redo anything for nothing
  setOptions: (changes) =>
    set((state) => {
      const options = { ...state.options, ...changes }
      return shallow(options, state.options) ? state : { options }
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
      const body = bodyId === null ? bodies[0] : bodies.find((candidate) => candidate.id === bodyId)
      if (!body) throw new Error(`No body is called ${bodyId}`)
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
        ...(sameBody ? {} : { volume: null, bounds: null, levels: null }),
      })

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

      const start = performance.now()
      const { bounds, levels, defaultDetail } = buildBody(loaded.volume)
      // A new level of the same body keeps the Detail's spacing where it has it; otherwise the level's own default
      const { options, levels: before } = get()
      const label = sameBody && before ? levelOf(before, options.detail)?.label : undefined
      const detail = levels.find((candidate) => candidate.label === label)?.block ?? defaultDetail
      shown = { body: body.id, level: level.id }
      set({ status: 'ready', volume: loaded.volume, bounds, levels, options: { ...options, detail } })

      const counts = levels.map((each) => `${each.count.toLocaleString('en')} at ${each.label}`)
      const extent = bounds.half.map((half) => Math.round(half * 2)).join(' × ')
      console.info(
        `VisibleHuman: ${level.file}, ${loaded.bytes.toLocaleString('en')} bytes, decoded in ` +
          `${Math.round(loaded.gunzipMs + loaded.readMs)} ms (gunzip ${Math.round(loaded.gunzipMs)} ms, ` +
          `read ${Math.round(loaded.readMs)} ms); the body, ${extent} mm, as ${counts.join(', ')}, ` +
          `built in ${Math.round(performance.now() - start)} ms`,
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
