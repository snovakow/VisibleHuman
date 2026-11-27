import { create, type StoreApi } from 'zustand'
import { shallow } from 'zustand/shallow'
import { defaultOptions, drawableOptions, type Capabilities, type ViewOptions } from './options.ts'
import type { BackendCapabilities } from './render/backend.ts'
import { defaultLevel, type BodiesFile, type BodyEntry } from './volume/bodies.ts'
import type { Volume } from './volume/format.ts'
import { levelOf, stageBody, type Bounds, type Detail, type DetailEntry, type Levels, type StagedBody } from './volume/levels.ts'
import type { SurfaceKind } from './surface/surfaceWorker.ts'
import { isAbort, loadBodies, loadVolume, NotBuiltError } from './volume/loadVolume.ts'
import { writeAnglePose, type AnglePose } from './motion/angles.ts'
import type { BakedClip, MotionFile } from './motion/clip.ts'
import type { Offsets } from './motion/ik.ts'
import { importMotionFile, saveBakedClip, type ImportedFile } from './motion/import.ts'
import { loadLibrary, loadMotionFile, type MotionEntry } from './motion/library.ts'
import { skinningBuild, type PosedLevel, type SkinningBuild } from './rig/cellSkinning.ts'
import { loadRig } from './rig/loadRig.ts'
import { bindSkeleton, type Placement } from './rig/pose.ts'
import type { RigFile } from './rig/rigFile.ts'
import { chainOfVoxel } from './rig/sampling.ts'
import type { Style } from './render/look.ts'

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
  // The view options as the panel last set them, from the table in options.ts, and as they're drawn: the picks held to
  // what the backend and the body shown can draw. A pick that can't be drawn is drawn at its default meanwhile, and is
  // kept, so that it comes back once a body or a backend that can draw it is shown
  picked: ViewOptions
  options: ViewOptions
  setOptions: (changes: Partial<ViewOptions>) => void
  // What the backend drawing can make of the effects that need more than a plain frame, as the renderer found when it
  // started: everything, until one says otherwise; and whether the body shown has an MRI. The panel leaves out what's
  // missing
  capabilities: Capabilities
  // Whether the backend drawing is WebGPU, rather than the WebGL 2 fallback, once the renderer has said
  webgpu: boolean | null
  setCapabilities: (backend: BackendCapabilities, webgpu: boolean) => void
  // The triangles in each of the surface style's meshes, while it's drawn, for the panel
  triangles: Partial<Record<SurfaceKind, number>>
  setTriangles: (kind: SurfaceKind, count: number | undefined) => void
  // Whether the view sways to and fro about the body, as it does from the start on a preset, until the visitor moves
  // the view or the panel's switch stops it. It moves the camera, not what's drawn, so it isn't a view option, and a
  // preset leaves it as it is
  swaying: boolean
  setSwaying: (swaying: boolean) => void
  // The motion the body is drawn in: none, as the body has always been drawn, the pose it was scanned in, or one of the
  // library's, by its id, a pose or a clip over time. A body with limbs loads its rig the first time it's asked to
  // move in a style that moves it, and the library the motion's file; until both are in, the body is drawn as before.
  // A preset leaves it, and all that follows, as it is
  motion: string
  setMotion: (motion: string) => void
  // The library's motions, once its index has loaded, and the files of those picked or layered so far, by id, each
  // read once for the page
  motions: readonly MotionEntry[] | null
  motionFiles: Readonly<Record<string, MotionFile>>
  // How fast a clip over time plays, 1 as it was written, and whether it plays or holds where it is
  speed: number
  setSpeed: (speed: number) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
  // How many single steps of a held clip have been asked for since the page opened, each moving it a frame on
  steps: number
  step: () => void
  // The weight of each layer of the library's mixed over the motion, by its id, as a turn from the neutral pose added
  // over whatever the motion holds; a layer at 0, or never set, changes nothing. Its file loads once its weight is
  // first raised
  layers: Readonly<Record<string, number>>
  setLayer: (id: string, weight: number) => void
  // The rig of the body shown, once it's loaded, for a body that has one
  rig: RigFile | null
  // The splat levels of the volume shown built again for the body posed, each block a cell for each chain it holds,
  // with their cells' skinning, as they're built: once the rig is in, a motion is picked and the splats are shown,
  // the Detail shown first
  posedLevels: readonly PosedLevel[] | null
  // Whether the posed body's joints are drawn over it
  showJoints: boolean
  setShowJoints: (visible: boolean) => void
  // Whether the handles at the posed body's wrists and ankles are drawn, to pose him by dragging them
  showHandles: boolean
  setShowHandles: (visible: boolean) => void
  // What dragging the handles has laid over the motion, each turned joint's turn from what the motion holds, kept
  // across a change of motion, style or body and back until it's reset
  offsets: Offsets
  setOffsets: (offsets: Offsets) => void
  resetOffsets: () => void
  // Puts the pose the body stands in now on the clipboard, written as a pose of the library is
  copyPose: () => void
  // Loads the library's index, for the panel's list, once
  loadMotions: () => void
  // The clips brought in from files dropped on the page or chosen with Import, each a motion of its own beside the
  // library's, kept for the page's life
  imported: readonly ImportedMotion[]
  // Reads a file's clips, retargets them onto the rig and plays the first at once. A file chosen while another is
  // still being read takes over from it
  importMotion: (file: File) => void
  // Downloads the imported clip shown as a baked clip, as the library's files are written
  saveMotion: () => void
}

// A clip brought in from a file, not yet in the library
export interface ImportedMotion {
  // Unique among the motions, the library's and the imported
  id: string
  // As the panel lists it, and as its saved file is labelled
  label: string
  saved: string
  clip: BakedClip
  // The file and the clip in it it was brought in from, which its saved file names
  source: string
  // The file's rest pose on the rig, and where its limbs point at rest (import.ts), which nothing on the page reads:
  // kept so that how a file was read can be looked into
  rest: ImportedFile['rest']
  directions: ImportedFile['directions']
}

// No motion: the body drawn as it always has been, and as it was scanned, the pose the rig is bound in
export const noMotion = 'none'
export const scanMotion = 'scan'
// The styles that draw a body posed, all four; a style left out would draw it as it was scanned, whatever the motion
const movingStyles: readonly Style[] = ['surface', 'splats', 'volume', 'raytrace']
export const styleMoves = (style: unknown): boolean => movingStyles.some((each) => each === style)

// Whether what the body is drawn in changes over time, so that playing it, its speed and a step change what's drawn:
// a clip over time as the motion, or as a layer with a weight. A pose, as scanned among them, holds still
export function motionMoves({ motion, motionFiles, layers }: Pick<State, 'motion' | 'motionFiles' | 'layers'>): boolean {
  const overTime = (id: string) => {
    const file = motionFiles[id]
    return file !== undefined && file.kind !== 'pose'
  }
  if (motion === noMotion) return false
  return overTime(motion) || Object.entries(layers).some(([id, weight]) => weight > 0 && overTime(id))
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// An imported clip's id, which no motion of the library's can have, since the library's ids are file names
const importedPrefix = 'imported:'
export const isImported = (motion: unknown) => typeof motion === 'string' && motion.startsWith(importedPrefix)

// No drag laid over the motion
export const noOffsets: Offsets = {}
const hasOffsets = (offsets: Offsets) => Object.keys(offsets).length > 0
export const isDragged = (state: Pick<State, 'offsets'>) => hasOffsets(state.offsets)

// Where Copy pose reads the pose the body stands in: from whatever draws it, which says so while it can
let poseSource: (() => AnglePose | null) | null = null
export function providePose(read: (() => AnglePose | null) | null) {
  poseSource = read
}

// The load in progress, which the next one aborts, and the level whose volume the store holds
let current: AbortController | null = null
let shown: { body: string; level: string } | null = null
// The list of bodies, fetched once for the page, so a load replaced while it's fetched, as StrictMode's first is, hands
// the fetch on to the next and the preload in index.html is taken by the one request. A failed fetch is tried again
let bodiesFetch: Promise<BodiesFile> | null = null
// What each body was left at, by its id, so that a body chosen again opens as it was: the level last shown, and the
// Detail last picked, by its label, which holds across the body's levels wherever one has its spacing
const lastLevels = new Map<string, string>()
const pickedDetails = new Map<string, string>()

// The Detail a body opens at on the WebGL 2 fallback, where that isn't its default. The head fills about 2.4 times
// the window the male does, so its splats are held back by the pixels they cover: on a 2014 Intel Iris they orbit at
// about 6 fps at its default 2.4 mm and 14 at 4.8 mm, and coarser they no longer show its anatomy
const fallbackOpening: Partial<Record<string, string>> = { head: '4.8 mm' }

// Waits until the renderer has said which backend draws, or the signal aborts
function backendReported(api: StoreApi<State>, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (api.getState().webgpu !== null || signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      unsubscribe()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const unsubscribe = api.subscribe((state) => {
      if (state.webgpu !== null) finish()
    })
    signal.addEventListener('abort', finish, { once: true })
  })
}

// The levels still to build after the first frame are built in slices of about this many milliseconds, one task each,
// so a frame waits at most about this long for one. The build takes this many body voxels at a time between looks at
// the clock, which on a 2014 Intel Mac takes about 1.4 ms
const sliceMs = 8
const sliceVoxels = 16_384

// What the page's first frame of a body logs, from the load that drew it, until it has: the times since navigation
// and the times to fetch, decode and build
let firstFrame: { volume: Volume; body: string; line: string } | 'logged' | null = null
const ms = (value: number) => Math.round(value).toLocaleString('en')

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
      const { waiting, picked, capabilities } = get()
      const arrived = waiting !== null && levelOf(staged.levels, waiting) !== undefined
      const taken = arrived ? { ...picked, detail: waiting } : picked
      set({
        levels: staged.levels,
        details: staged.details,
        ...(arrived ? { waiting: null, picked: taken, options: drawableOptions(taken, capabilities) } : {}),
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

// The posed levels being built for the volume shown and its rig, which a new volume or rig replaces: the build of the
// levels by chain, the level being skinned, the levels taken to skin, and those done
let posing: {
  volume: Volume
  rig: RigFile
  levels: ReturnType<StagedBody['stagePosed']>
  skinning: { level: PosedLevel['level']; build: SkinningBuild } | null
  taken: Set<PosedLevel['level']>
  done: PosedLevel[]
} | null = null
// The cells skinned between looks at the clock, about as long as a slice of the levels' voxels
const sliceCells = 4_096

// Builds the posed levels, a slice at a time from a task of its own as buildRest builds the levels, the Detail shown
// or waited for first, each level skinned once it's built and handed on once it's skinned, until a new volume or rig
// replaces them. Started only while a motion is picked and the splats are shown, the one style that needs them, and
// once for a volume and its rig
function buildPosed(set: StoreApi<State>['setState'], get: StoreApi<State>['getState']) {
  const { volume, bounds, rig, motion, options, body } = get()
  if (!volume || !bounds || !rig || motion === noMotion || options.style !== 'splats') return
  if (posing?.volume === volume && posing.rig === rig) return
  if (!staging || staging.volume !== volume) return
  const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
  const bound = bindSkeleton(rig.rig, placement)
  const mine: NonNullable<typeof posing> = {
    volume,
    rig,
    levels: staging.staged.stagePosed(chainOfVoxel(rig, volume)),
    skinning: null,
    taken: new Set(),
    done: [],
  }
  posing = mine
  set({ posedLevels: null })
  const start = performance.now()
  // When each level was ready, by Detail, and the longest slice
  const ready = new Map<number, number>()
  let longest = 0
  let slices = 0
  const wanted = () => get().waiting ?? get().options.detail
  const slice = () => {
    if (posing !== mine) return
    const sliceStart = performance.now()
    const end = sliceStart + sliceMs
    const before = mine.done.length
    let more = true
    while (more && performance.now() < end) {
      if (!mine.skinning) {
        const unskinned = mine.levels.levels.filter((level) => !mine.taken.has(level))
        const level = unskinned.find((each) => each.block === wanted()) ?? unskinned[0]
        if (level) {
          mine.taken.add(level)
          mine.skinning = { level, build: skinningBuild(level, rig, placement, bound) }
        }
      }
      if (mine.skinning) {
        const { level, build } = mine.skinning
        const skinning = build.advance(sliceCells)
        if (skinning) {
          ready.set(level.block, performance.now() - start)
          mine.done.push({ level, skinning })
          mine.skinning = null
        }
        continue
      }
      more = mine.levels.advance(sliceVoxels, wanted())
      // The last level built is still to skin
      if (!more && mine.levels.levels.some((level) => !mine.taken.has(level))) more = true
    }
    slices++
    longest = Math.max(longest, performance.now() - sliceStart)
    if (mine.done.length !== before) {
      const posedLevels = [...mine.done].sort((a, b) => a.level.block - b.level.block)
      set({ posedLevels })
    }
    if (more || mine.skinning) {
      setTimeout(slice, 0)
      return
    }
    const counts = [...mine.done]
      .sort((a, b) => a.level.block - b.level.block)
      .map(({ level }) => `${level.count.toLocaleString('en')} at ${level.label}, ready at ${Math.round(ready.get(level.block) ?? 0)} ms`)
    console.info(
      `VisibleHuman: the ${body ?? 'body'}'s posed levels, as ${counts.join('; ') || 'none'}, built and skinned in ` +
        `${Math.round(performance.now() - start)} ms over ${slices} slices, the longest ${Math.round(longest)} ms`,
    )
  }
  setTimeout(slice, 0)
}

// The library's index, fetched once for the page, and a load of a rig or a motion's file in progress, which the next
// one aborts
let libraryFetch: Promise<readonly MotionEntry[]> | null = null
let motionLoad: AbortController | null = null
// Each motion's file, fetched once for the page whatever asks for it, so that a load taking over from another, as the
// body's arrival takes over from a ?motion= read before it, waits on the same request. A failed fetch is tried again
const fileFetches = new Map<string, Promise<MotionFile>>()
function fetchMotionFile(entry: MotionEntry): Promise<MotionFile> {
  let fetching = fileFetches.get(entry.id)
  if (!fetching) {
    fetching = loadMotionFile(entry)
    fileFetches.set(entry.id, fetching)
    fetching.catch(() => fileFetches.delete(entry.id))
  }
  return fetching
}

// Brings in what the motion picked needs, once it's picked in a style that moves the body: the body's rig, if it has
// one and it isn't in, and, for a motion of the library's, its file. A newer pick, or another body, takes over, and an
// older load's results are dropped. A motion the library hasn't got, as a mistyped ?motion= names, is taken for none
async function loadMotion(set: StoreApi<State>['setState'], get: StoreApi<State>['getState']) {
  motionLoad?.abort()
  const controller = new AbortController()
  motionLoad = controller
  const { motion, body, bodies, rig, options, motionFiles } = get()
  const entry = bodies?.find((candidate) => candidate.id === body)
  const isCurrent = () => motionLoad === controller && get().motion === motion && get().body === body
  try {
    if (motion === noMotion || !styleMoves(options.style)) return
    if (entry?.rig && !rig) {
      const loaded = await loadRig(entry.rig, controller.signal)
      if (!isCurrent()) return
      set({ rig: loaded })
      buildPosed(set, get)
    }
    if (motion === scanMotion || motionFiles[motion]) return
    const motions = await (libraryFetch ??= loadLibrary())
    if (motionLoad !== controller) return
    set({ motions })
    const picked = motions.find((candidate) => candidate.id === motion)
    if (!picked) {
      console.warn(`VisibleHuman: the motion library has no ${motion}, so the body is drawn as it always has been`)
      if (isCurrent()) set({ motion: noMotion })
      return
    }
    const file = await fetchMotionFile(picked)
    if (!isCurrent()) return
    set({ motionFiles: { ...get().motionFiles, [motion]: file } })
  } catch (error) {
    if (isAbort(error)) return
    console.warn(`VisibleHuman: ${messageOf(error)}`)
  } finally {
    if (motionLoad === controller) motionLoad = null
  }
}

// Brings in a layer's file. It's the same file whatever asked for it, so one that arrives late is kept all the same
async function loadLayer(id: string, set: StoreApi<State>['setState'], get: StoreApi<State>['getState']) {
  if (get().motionFiles[id]) return
  try {
    const motions = await (libraryFetch ??= loadLibrary())
    set({ motions })
    const entry = motions.find((candidate) => candidate.id === id)
    if (!entry) throw new Error(`The motion library has no layer ${id}`)
    const file = await fetchMotionFile(entry)
    if (!get().motionFiles[id]) set({ motionFiles: { ...get().motionFiles, [id]: file } })
  } catch (error) {
    console.warn(`VisibleHuman: ${messageOf(error)}`)
  }
}

// How many files have been chosen to import, so that one still being read when another is chosen is dropped
let imports = 0
let importedClips = 0

// A label no other motion has, the library's or an imported one, since the panel lists the motions by their labels
function freeLabel(label: string, state: Pick<State, 'motions' | 'imported'>) {
  const taken = new Set([...(state.motions ?? []).map((each) => each.label), ...state.imported.map((each) => each.label), 'none', 'as scanned'])
  if (!taken.has(label)) return label
  let n = 2
  while (taken.has(`${label} ${n}`)) n++
  return `${label} ${n}`
}

export const useStore = create<State>()((set, get, api) => ({
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
    if (firstFrame !== null && firstFrame !== 'logged' && firstFrame.volume === volume) {
      const { body, line } = firstFrame
      console.info(`VisibleHuman: the ${body}'s first frame at ${ms(performance.now())} ms since navigation; ${line}`)
      firstFrame = 'logged'
    }
    if (staging?.volume === volume) buildRest(set, get)
  },
  picked: defaultOptions,
  options: defaultOptions,
  // Unchanged values keep the same options objects, so the scene doesn't redo anything for nothing. A Detail whose
  // level is still to build waits for it, and the level it's built ahead of the others; one the body hasn't got is
  // left as it was. A Detail picked is kept for its body by its label, for its other levels and its next visit
  setOptions: (changes) => {
    let taken = changes
    const { levels, details, waiting, body } = get()
    const { detail } = changes
    const label = detail === undefined ? undefined : details?.find((entry) => entry.block === detail)?.label
    if (body !== null && label !== undefined) pickedDetails.set(body, label)
    if (detail !== undefined && levels && !levelOf(levels, detail)) {
      const { detail: _, ...rest } = changes
      taken = rest
      if (details?.some((entry) => entry.block === detail)) {
        set({ waiting: detail })
        buildRest(set, get)
      }
    } else if (detail !== undefined && waiting !== null) set({ waiting: null })
    const styleBefore = get().options.style
    set((state) => {
      const picked = { ...state.picked, ...taken }
      if (shallow(picked, state.picked)) return state
      const options = drawableOptions(picked, state.capabilities)
      return { picked, options: shallow(options, state.options) ? state.options : options }
    })
    // A motion picked, or opened on, in a style that doesn't move the body is brought in once one that does is shown
    const { options, motion, rig, motionFiles } = get()
    if (options.style !== styleBefore && styleMoves(options.style) && motion !== noMotion && (!rig || (motion !== scanMotion && !motionFiles[motion]))) {
      void loadMotion(set, get)
    }
    buildPosed(set, get)
  },
  capabilities: { weighted: true, oit: true, mri: false },
  // A backend that lacks something draws the options that need it at their defaults, as a switch to the fallback may
  // with an effect on, and keeps them as picked
  webgpu: null,
  setCapabilities: (backend, webgpu) =>
    set((state) => {
      const capabilities = { ...state.capabilities, ...backend }
      if (shallow(capabilities, state.capabilities)) return state.webgpu === webgpu ? state : { webgpu }
      const options = drawableOptions(state.picked, capabilities)
      return { capabilities, webgpu, options: shallow(options, state.options) ? state.options : options }
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
  swaying: false,
  setSwaying: (swaying) => set((state) => (state.swaying === swaying ? state : { swaying })),
  motion: noMotion,
  motions: null,
  motionFiles: {},
  speed: 1,
  setSpeed: (speed) => set((state) => (state.speed === speed ? state : { speed })),
  playing: true,
  setPlaying: (playing) => set((state) => (state.playing === playing ? state : { playing })),
  steps: 0,
  step: () => set((state) => ({ steps: state.steps + 1 })),
  layers: {},
  setLayer: (id, weight) => {
    if ((get().layers[id] ?? 0) === weight) return
    set((state) => ({ layers: { ...state.layers, [id]: weight } }))
    if (weight > 0) void loadLayer(id, set, get)
  },
  rig: null,
  posedLevels: null,
  showJoints: false,
  setShowJoints: (visible) => set((state) => (state.showJoints === visible ? state : { showJoints: visible })),
  showHandles: true,
  setShowHandles: (visible) => set((state) => (state.showHandles === visible ? state : { showHandles: visible })),
  offsets: noOffsets,
  setOffsets: (offsets) => set((state) => (!hasOffsets(offsets) && !hasOffsets(state.offsets) ? state : { offsets })),
  resetOffsets: () => set((state) => (hasOffsets(state.offsets) ? { offsets: noOffsets } : state)),
  copyPose: () => {
    const pose = poseSource?.()
    if (!pose) return
    // A browser offers the clipboard only to a page served securely, so one served over plain http from another
    // machine has none
    const clipboard = navigator.clipboard as Clipboard | undefined
    if (!clipboard) {
      console.warn("VisibleHuman: the pose couldn't be copied, as the browser offers the clipboard only to a page served securely")
      return
    }
    clipboard.writeText(writeAnglePose(pose)).catch((error: unknown) => {
      console.warn(`VisibleHuman: the pose couldn't be copied. ${messageOf(error)}`)
    })
  },
  loadMotions: () => {
    if (get().motions) return
    ;(libraryFetch ??= loadLibrary()).then(
      (motions) => set({ motions }),
      (error: unknown) => {
        libraryFetch = null
        console.warn(`VisibleHuman: the motion library couldn't be read. ${messageOf(error)}`)
      },
    )
  },
  imported: [],
  importMotion: (file) => {
    const chosen = ++imports
    importMotionFile(file).then(
      (read) => {
        if (chosen !== imports) {
          console.info(`VisibleHuman: ${file.name} was read, but a file chosen after it is shown instead`)
          return
        }
        const state = get()
        const made: ImportedMotion[] = []
        for (const { name, clip } of read.clips) {
          const saved = read.clips.length === 1 ? read.name : name
          const label = freeLabel(`${read.clips.length === 1 ? read.name : `${read.name}: ${name}`} (imported)`, { motions: state.motions, imported: [...state.imported, ...made] })
          made.push({ id: `${importedPrefix}${++importedClips}`, label, saved, clip, rest: read.rest, directions: read.directions, source: `${file.name}, its clip ${name}, read by ${read.rig}'s bone names` })
        }
        const files = Object.fromEntries(made.map((each): [string, MotionFile] => [each.id, { kind: 'baked', clip: each.clip }]))
        set({ imported: [...state.imported, ...made], motionFiles: { ...state.motionFiles, ...files } })
        const [first] = made
        if (first) get().setMotion(first.id)
      },
      (error: unknown) => {
        if (chosen === imports) console.warn(`VisibleHuman: ${file.name} couldn't be imported. ${messageOf(error)}`)
      },
    )
  },
  saveMotion: () => {
    const { imported, motion } = get()
    const picked = imported.find((each) => each.id === motion)
    if (picked) saveBakedClip(picked.clip, { label: picked.saved, source: picked.source })
  },
  setMotion: (motion) => {
    if (get().motion === motion) return
    set({ motion })
    if (motion === noMotion) return
    buildPosed(set, get)
    void loadMotion(set, get)
  },
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
        const fetching = (bodiesFetch ??= loadBodies())
        try {
          bodies = (await fetching).bodies
        } catch (error) {
          if (bodiesFetch === fetching) bodiesFetch = null
          throw error
        }
        if (!isLatest()) return
        set({ bodies })
      }
      // A name no body has, as a mistyped ?body= gives, opens the first body, as an unknown ?preset= opens the launch
      // preset. A body chosen without a level opens at the one it was last shown at, unless the host turned out not to
      // have it, and otherwise at its default
      const body = bodies.find((candidate) => candidate.id === bodyId) ?? bodies[0]
      const last = lastLevels.get(body.id)
      const lastLevel =
        last === undefined || get().notBuilt.includes(levelKey(body.id, last))
          ? undefined
          : body.levels.find((candidate) => candidate.id === last)
      const level = levelId === null ? (lastLevel ?? defaultLevel(body)) : body.levels.find((candidate) => candidate.id === levelId)
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
        ...(sameBody ? {} : { volume: null, bounds: null, levels: null, details: null, waiting: null, rig: null, posedLevels: null }),
      })
      if (!sameBody) {
        staging = null
        posing = null
      }

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

      // A body that opens at another Detail on the fallback first hears which backend draws, which the renderer
      // says as it starts, by now as a rule
      const onFallback = sameBody ? undefined : fallbackOpening[body.id]
      if (onFallback !== undefined) {
        await backendReported(api, controller.signal)
        if (!isLatest()) return
      }

      // A body opens at the Detail last picked for it, where the level has its spacing, and otherwise at the level's
      // own default. With none picked, a new level of the same body keeps the Detail's spacing where it has it, and
      // another body opens at its Detail on the fallback while that's the backend, or else at the level's own default.
      // That level is built first, and the others once the body has drawn. A Detail picked later stays, as does the one
      // shown when the page switches to the fallback
      const { picked, options, levels: before, capabilities: held, webgpu } = get()
      const kept = sameBody && before ? levelOf(before, options.detail)?.label : undefined
      const label = pickedDetails.get(body.id) ?? kept ?? (webgpu === false ? onFallback : undefined)
      const start = performance.now()
      const staged = stageBody(loaded.volume, { opening: label })
      const buildMs = performance.now() - start
      const { bounds, opening } = staged
      shown = { body: body.id, level: level.id }
      lastLevels.set(body.id, level.id)
      staging = { volume: loaded.volume, body: body.id, staged, started: false }
      posing = null
      // A body without an MRI draws the options that read one at their defaults, and keeps them as picked, so that
      // they come back with a body that has one
      const mri = loaded.volume.mri !== undefined
      const capabilities = held.mri === mri ? held : { ...held, mri }
      const taken = { ...picked, detail: opening.block }
      set({
        status: 'ready',
        volume: loaded.volume,
        bounds,
        levels: staged.levels,
        details: staged.details,
        waiting: null,
        posedLevels: null,
        capabilities,
        picked: taken,
        options: drawableOptions(taken, capabilities),
      })
      // A body asked to move loads its own rig, and with it in, a new level of the body builds its posed levels
      if (get().motion !== noMotion && !get().rig) void loadMotion(set, get)
      buildPosed(set, get)

      if (firstFrame !== 'logged') {
        firstFrame = {
          volume: loaded.volume,
          body: body.id,
          line:
            `${level.file} requested at ${ms(loaded.requestedAt)} ms, fetched in ${ms(loaded.fetchMs)} ms, ` +
            `decoded in ${ms(loaded.gunzipMs + loaded.readMs)} ms and its ${opening.label} level built in ` +
            `${ms(buildMs)} ms`,
        }
      }

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
