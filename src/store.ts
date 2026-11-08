import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { buildBody, type Bounds, type Detail, type Levels } from './volume/levels.ts'
import { isAbort, loadVolume } from './volume/loadVolume.ts'

export type Status = 'loading' | 'ready' | 'failed'

// What the panel sets. The cuts run from 0, nothing cut, to 1, the whole body cut away
export interface ViewOptions {
  detail: Detail
  // The splats' size, as a share of the grid spacing's
  size: number
  opacity: number
  // Down from the head
  axial: number
  // Back from the front
  coronal: number
  // Across from the body's right
  sagittal: number
}

export const defaultOptions: ViewOptions = { detail: 8, size: 1, opacity: 1, axial: 0, coronal: 0, sagittal: 0 }

interface State {
  // The volume file's load, and its message if it failed
  status: Status
  error: string | null
  // The body's bounds and its levels, kept while the page is open once the volume has loaded
  bounds: Bounds | null
  levels: Levels | null
  // Loads the volume, unless it's loaded already. An abort leaves the status to the load that took over
  load: (signal: AbortSignal) => Promise<void>
  options: ViewOptions
  setOptions: (changes: Partial<ViewOptions>) => void
}

export const useStore = create<State>()((set, get) => ({
  status: 'loading',
  error: null,
  bounds: null,
  levels: null,
  options: defaultOptions,
  // Unchanged values keep the same options object, so the scene doesn't redo anything for nothing
  setOptions: (changes) =>
    set((state) => {
      const options = { ...state.options, ...changes }
      return shallow(options, state.options) ? state : { options }
    }),
  load: async (signal) => {
    if (get().levels) return
    set({ status: 'loading', error: null })
    try {
      const volume = await loadVolume(signal)
      if (signal.aborted) return
      const start = performance.now()
      const { bounds, levels } = buildBody(volume)
      set({ status: 'ready', bounds, levels })
      const counts = ([4, 8, 16] as const).map((detail) => `${levels[detail].count.toLocaleString('en')} at ${detail} mm`)
      const extent = bounds.half.map((half) => Math.round(half * 2)).join(' × ')
      console.info(
        `VisibleHuman: the body, ${extent} mm, as ${counts.join(', ')}, built in ${Math.round(performance.now() - start)} ms`,
      )
    } catch (error) {
      if (isAbort(error)) return
      const message = error instanceof Error ? error.message : String(error)
      set({ status: 'failed', error: message })
      console.warn(`VisibleHuman: ${message}`)
    }
  },
}))
