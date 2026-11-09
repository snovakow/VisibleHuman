import type { Style } from './viewer/styles.ts'
import type { Detail } from './volume/levels.ts'

// The view options, what the panel sets and the scene draws, in one table that the store's defaults and the panel's
// controls are both built from. Each entry gives the panel folder it sits in, its label, its default, its range and
// step or its choices by their labels or that it's a switch, which styles show it, and, where another control hides
// it, the test on that control's value. The entries are in the panel's order.
// This module imports nothing at run time: the styles read their options' type from here, so a table that read the
// styles at run time would close a cycle

// How the splats lay over one another: in front of what's behind, or added to it so dense parts glow, or summed by how
// near and how opaque each is, so that the order they're drawn in never matters. The Blend control arrives with the
// effects; the styles read the type now
export type Blend = 'normal' | 'glow' | 'weighted'

// How the volume's march shows what it passes through: laid over what's behind, step by step, from the front; as an
// x-ray, the light that gets through the body's density; as the most density met along the ray; or as light the body
// gives off, added to what's behind
export type VolumeMode = 'over' | 'xray' | 'mip' | 'glow'

// Where the march reads a voxel's density: the file's density channel, the CT's where the scan covers the voxel and
// a reading of its colour where it doesn't, or that reading of the colour everywhere, which shows what the CT adds
export type DensitySource = 'ct' | 'colour'

// The march's step as a share of a voxel: a step chosen for the backend, a whole voxel on the WebGL 2 fallback and
// half a voxel on WebGPU, or one named, each halving doubling the cost of a frame
export type Quality = 'auto' | 'voxel' | 'half' | 'quarter'

// The panel's folders that hold options. Body holds the body and level choosers, which are the page's load state
// rather than view options, and Info the read-outs; both are the panel's own
export type Folder = 'Body' | 'Look' | 'Cuts' | 'Scene'

// Which styles show a control: every style, or the styles named
export type ShownFor = 'every' | { styles: readonly Style[] }

// Another control that hides this one, by its key in the table: this one shows only while that control's value is
// the one given, isn't it, or is above it
export type Dependence =
  | { option: string; is: boolean | string }
  | { option: string; isNot: string }
  | { option: string; above: number }

interface Control<T> {
  folder: Folder
  label: string
  default: T
  shownFor: ShownFor
  shownWhile?: Dependence
}

// A number in a range, moved by steps. A deferred slider is committed when the drag or the edit ends rather than as
// it moves, for a value whose every change rebuilds something
export interface Slider extends Control<number> {
  kind: 'slider'
  min: number
  max: number
  step: number
  deferred?: true
}

export interface Switch extends Control<boolean> {
  kind: 'switch'
}

// One of the values listed, each by its label in the panel
export interface Choice<T extends string | number> extends Control<T> {
  kind: 'choice'
  choices: Record<string, T>
}

// The style, whose choices the panel lists from the styles themselves
export interface StyleChoice extends Control<Style> {
  kind: 'style'
}

// The splat level, by the block of voxels each splat stands for, whose choices the panel lists from the levels the
// loaded file gives, by their spacing, coarsest first
export interface DetailChoice extends Control<Detail> {
  kind: 'detail'
}

const slider = (entry: Omit<Slider, 'kind'>): Slider => ({ kind: 'slider', ...entry })
const toggle = (entry: Omit<Switch, 'kind'>): Switch => ({ kind: 'switch', ...entry })
const choice = <T extends string | number>(entry: Omit<Choice<T>, 'kind'>): Choice<T> => ({ kind: 'choice', ...entry })
const styleChoice = (entry: Omit<StyleChoice, 'kind'>): StyleChoice => ({ kind: 'style', ...entry })
const detailChoice = (entry: Omit<DetailChoice, 'kind'>): DetailChoice => ({ kind: 'detail', ...entry })

const every: ShownFor = 'every'
const splats: ShownFor = { styles: ['splats'] }
const volume: ShownFor = { styles: ['volume'] }

// The volume's modes other than the x-ray, which reads the density above a floor of its own rather than the window
const notXray: Dependence = { option: 'mode', isNot: 'xray' }

// The sliders move in steps of a hundredth, the finest leva shows
const hundredths = 0.01

export const viewOptions = {
  style: styleChoice({ folder: 'Look', label: 'Style', default: 'splats', shownFor: every }),
  // Block 2 is the 8 mm level of the male's 4 mm file, which is where a load opens it; each load picks its own default
  detail: detailChoice({ folder: 'Look', label: 'Detail', default: 2, shownFor: splats }),
  // The splats' size, as a share of the grid spacing's. A new Size rebuilds every splat, so it's committed when a
  // drag or an edit ends
  size: slider({ folder: 'Look', label: 'Size', default: 1, min: 0.5, max: 2, step: hundredths, deferred: true, shownFor: splats }),
  mode: choice<VolumeMode>({
    folder: 'Look',
    label: 'Mode',
    default: 'over',
    choices: { over: 'over', 'x-ray': 'xray', MIP: 'mip', glow: 'glow' },
    shownFor: volume,
  }),
  density: choice<DensitySource>({
    folder: 'Look',
    label: 'Density',
    default: 'ct',
    choices: { CT: 'ct', colour: 'colour' },
    shownFor: volume,
  }),
  // The window over the density, as a share of the scale's top: below the low end a voxel is clear, above the high
  // end it's as dense as the mode allows, and between them it ramps. The whole scale by default; a low end around a
  // third leaves the bone. The x-ray takes no window, so it's hidden there
  windowLow: slider({
    folder: 'Look',
    label: 'Window low',
    default: 0,
    min: 0,
    max: 1,
    step: hundredths,
    shownFor: volume,
    shownWhile: notXray,
  }),
  windowHigh: slider({
    folder: 'Look',
    label: 'Window high',
    default: 1,
    min: 0,
    max: 1,
    step: hundredths,
    shownFor: volume,
    shownWhile: notXray,
  }),
  quality: choice<Quality>({
    folder: 'Look',
    label: 'Quality',
    default: 'auto',
    choices: { auto: 'auto', '1 voxel': 'voxel', '½ voxel': 'half', '¼ voxel': 'quarter' },
    shownFor: volume,
  }),
  // Lights each step by the density's slope there, which costs six more reads a step, so it's off until asked for
  shading: toggle({ folder: 'Look', label: 'Shading', default: false, shownFor: volume, shownWhile: { option: 'mode', is: 'over' } }),
  opacity: slider({ folder: 'Look', label: 'Opacity', default: 1, min: 0, max: 1, step: hundredths, shownFor: every }),
  // The cuts run from 0, nothing cut, to 1, the whole body cut away: down from the head, back from the front, and
  // across from the body's right
  axial: slider({ folder: 'Cuts', label: 'Axial', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  coronal: slider({ folder: 'Cuts', label: 'Coronal', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  sagittal: slider({ folder: 'Cuts', label: 'Sagittal', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
}

// Each option's value, of the type its entry's default has: a slider's is any number, and a choice's one of its values
export type ViewOptions = { [K in keyof typeof viewOptions]: (typeof viewOptions)[K]['default'] }

// Whether a key names an option in the table
export function isOption(key: string): key is keyof ViewOptions {
  return Object.hasOwn(viewOptions, key)
}

// The options' keys, in the panel's order
export const optionKeys = Object.keys(viewOptions).filter(isOption)

// The options at their defaults, each taken from the table by name, as a loop over its keys can't be typed as the options
export const defaultOptions: ViewOptions = {
  style: viewOptions.style.default,
  detail: viewOptions.detail.default,
  size: viewOptions.size.default,
  mode: viewOptions.mode.default,
  density: viewOptions.density.default,
  windowLow: viewOptions.windowLow.default,
  windowHigh: viewOptions.windowHigh.default,
  quality: viewOptions.quality.default,
  shading: viewOptions.shading.default,
  opacity: viewOptions.opacity.default,
  axial: viewOptions.axial.default,
  coronal: viewOptions.coronal.default,
  sagittal: viewOptions.sagittal.default,
}
