import type { Style } from './viewer/styles.ts'
import type { Detail } from './volume/levels.ts'

// The view options, what the panel sets and the scene draws, in one table that the store's defaults and the panel's
// controls are both built from. Each entry gives the panel folder it sits in, its label, its default, its range and
// step or its choices by their labels or that it's a switch, which styles show it, and, where another control hides
// it, the test on that control's value. The entries are in the panel's order.
// This module imports nothing at run time: the styles read their options' type from here, so a table that read the
// styles at run time would close a cycle

// How the splats lay over one another: in front of what's behind, or added to it so dense parts glow, or summed by how
// near and how opaque each is, so that the order they're drawn in never matters
export type Blend = 'normal' | 'glow' | 'weighted'

// How the volume's march shows what it passes through: laid over what's behind, step by step, from the front; as an
// x-ray, the light that gets through the body's density; as the most density met along the ray; or as light the body
// gives off, added to what's behind
export type VolumeMode = 'over' | 'xray' | 'mip' | 'glow'

// Where the march reads a voxel's density: the file's density channel, the CT's where the scan covers the voxel and
// a reading of its colour where it doesn't; that reading of the colour everywhere, which shows what the CT adds; or,
// for a body with one, its MRI, which tells the soft tissues apart where the CT tells bone from the rest
export type DensitySource = 'ct' | 'colour' | 'mri'

// The march's step as a share of a voxel: a step chosen for the backend, a whole voxel on the WebGL 2 fallback and
// half a voxel on WebGPU, or one named, each halving doubling the cost of a frame
export type Quality = 'auto' | 'voxel' | 'half' | 'quarter'

// Which surfaces the raytrace follows each ray to: the skin, the bone, or both, whichever a ray meets first; or, for
// a body with an MRI, the surface where the MRI passes its threshold, which with the body cut open is the brain's
export type Trace = 'skin' | 'bone' | 'both' | 'brain'

// What the surface's inner mesh is of: the bone, from the density at the Bone threshold, or, for a body with an MRI,
// the surface where the MRI passes its threshold
export type Inner = 'bone' | 'brain'

// Where the surface's colour comes from: the body's texture just inside the surface, at the loaded grid's resolution
// whatever the Detail, or the colour of the blocks either side of each vertex on its mesh's grid, the Detail's for the
// skin and the shell and the loaded grid's for the bone, mixed as the vertex lies between them. On the skin that's
// much the splats' own colour at that Detail: a block's colour takes in the band dilated around the body as well as
// its body voxels, and a splat's its body voxels alone
export type SurfaceColour = 'texture' | 'cells'

// What an effect needs of the backend that draws: the weighted blend sums into half-float targets, and the surface's
// order-independent transparency into such a target and a second blended its own way. WebGPU has both; the WebGL 2
// fallback has each only where the browser offers the extensions for it
export type BackendCapability = 'weighted' | 'oit'
export type BackendCapabilities = Record<BackendCapability, boolean>
// What a control may need before the panel offers it: something of the backend, or an MRI in the body shown, which
// only the head's file holds
export type Capability = BackendCapability | 'mri'
export type Capabilities = Record<Capability, boolean>

// The panel's folders that hold options. Body holds the body and level choosers, which are the page's load state
// rather than view options, and Info the read-outs; both are the panel's own
export type Folder = 'Body' | 'Look' | 'Cuts' | 'Scene'

// Which styles show a control: every style, or the styles named
export type ShownFor = 'every' | { styles: readonly Style[] }

// Another control that hides this one, by its key in the table: this one shows only while that control's value is
// the one given, isn't it, is one of those listed, is above it or is below it
export type Dependence =
  | { option: string; is: boolean | string }
  | { option: string; isNot: string }
  | { option: string; oneOf: readonly string[] }
  | { option: string; above: number }
  | { option: string; below: number }

// When a control shows, among the styles it's shown for: while one control allows it, or while every one of several
// does, or, where that differs from style to style, as the style drawn says, a style that says nothing showing it
// throughout
type Dependences = Dependence | { all: readonly Dependence[] }
export type ShownWhile = Dependences | { byStyle: Partial<Record<Style, Dependences>> }

interface Control<T> {
  folder: Folder
  label: string
  default: T
  shownFor: ShownFor
  shownWhile?: ShownWhile
  // What the control needs of the backend or of the body shown, without which the panel leaves it out
  needs?: Capability
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

// One of the values listed, each by its label in the panel. A value that needs something of the backend or of the body
// shown is left out of the panel's list where that's lacking
export interface Choice<T extends string | number> extends Control<T> {
  kind: 'choice'
  choices: Record<string, T>
  choiceNeeds?: Partial<Record<T, Capability>>
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
// The two styles drawn at the Detail's blocks: the splats as one per block, the surface's skin meshed on their grid
const blocky: ShownFor = { styles: ['splats', 'surface'] }
const volume: ShownFor = { styles: ['volume'] }
const raytrace: ShownFor = { styles: ['raytrace'] }
// The two styles that step through the body's texture from the ray quad
const quad: ShownFor = { styles: ['volume', 'raytrace'] }
// The two styles that draw the skin and the bone as surfaces
const surfaces: ShownFor = { styles: ['raytrace', 'surface'] }
const surface: ShownFor = { styles: ['surface'] }

// The volume's modes other than the x-ray, which reads the density above a floor of its own rather than the window
const notXray: Dependence = { option: 'mode', isNot: 'xray' }
// Below full Opacity, where a ray sees through the skin
const translucent: Dependence = { option: 'opacity', below: 1 }
// While the shadows are cast, which is all the light's direction is for
const shadowed: Dependence = { option: 'shadows', is: true }
// While the bone is drawn: traced by the raytrace, alone or with the skin, or meshed by the surface under its Bone
// switch with Inner on the bone, which a body without an MRI always has
const boneDrawn: ShownWhile = {
  byStyle: {
    raytrace: { option: 'trace', oneOf: ['bone', 'both'] },
    surface: { all: [{ option: 'bone', is: true }, { option: 'inner', isNot: 'brain' }] },
  },
}
// While the brain is drawn, from the MRI: traced by the raytrace, or meshed by the surface under its Bone switch
// with Inner on the brain
const brainDrawn: ShownWhile = {
  byStyle: {
    raytrace: { option: 'trace', is: 'brain' },
    surface: { all: [{ option: 'bone', is: true }, { option: 'inner', is: 'brain' }] },
  },
}

// The sliders move in steps of a hundredth, the finest leva shows
const hundredths = 0.01

// Bloom's spread and threshold until the panel moves them, as PDBSplat chose them by eye for its glow: a halo that
// hazes the space around the body, from its dense, bright parts but not its faint edges
const bloomRadiusDefault = 0.4
const bloomThresholdDefault = 0.3

// The MRI threshold until the panel moves it: between the skull, which the head's MRI shows dark, a median of 25 on
// its block's scale with three quarters of it under 40, and the soft tissue inside it, nearly all of it over 57
const mriThresholdDefault = 45

export const viewOptions = {
  style: styleChoice({ folder: 'Look', label: 'Style', default: 'splats', shownFor: every }),
  // Block 2 is the 8 mm level of the male's 4 mm file, which is where a load opens it; each load picks its own default.
  // The surface meshes its skin on the same blocks, so that the mesh and the splats agree on the body
  detail: detailChoice({ folder: 'Look', label: 'Detail', default: 2, shownFor: blocky }),
  // The splats' size, as a share of the grid spacing's. A new Size rebuilds every splat, so it's committed when a
  // drag or an edit ends
  size: slider({ folder: 'Look', label: 'Size', default: 1, min: 0.5, max: 2, step: hundredths, deferred: true, shownFor: splats }),
  // Blending acts on splats, so the other styles leave it out. The weighted sum needs targets a backend may lack
  blend: choice<Blend>({
    folder: 'Look',
    label: 'Blend',
    default: 'normal',
    choices: { normal: 'normal', glow: 'glow', weighted: 'weighted' },
    choiceNeeds: { weighted: 'weighted' },
    shownFor: splats,
  }),
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
    choices: { CT: 'ct', colour: 'colour', MRI: 'mri' },
    choiceNeeds: { mri: 'mri' },
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
    shownFor: quad,
  }),
  // Lights each step by the density's slope there, which costs six more reads a step, so it's off until asked for
  shading: toggle({ folder: 'Look', label: 'Shading', default: false, shownFor: volume, shownWhile: { option: 'mode', is: 'over' } }),
  // Draws each step in grey, by how far the density stands through the window, in place of the photographs' colour,
  // and the x-ray and the maximum in white, so the window and level read the CT, or the head's MRI, as a scan
  // viewer shows it. Only the colour changes: what each step covers is the same either way
  grey: toggle({ folder: 'Look', label: 'Grey', default: false, shownFor: volume }),
  trace: choice<Trace>({
    folder: 'Look',
    label: 'Trace',
    default: 'both',
    choices: { skin: 'skin', bone: 'bone', both: 'both', brain: 'brain' },
    choiceNeeds: { brain: 'mri' },
    shownFor: raytrace,
  }),
  // How many surfaces a ray lays over one another below full Opacity before it stops; it stops at bone regardless
  layers: slider({ folder: 'Look', label: 'Layers', default: 2, min: 1, max: 4, step: 1, shownFor: raytrace, shownWhile: translucent }),
  // Casts the body's shadow on its surfaces, by a second march from each hit toward the light, so it's off until asked for
  shadows: toggle({ folder: 'Look', label: 'Shadows', default: false, shownFor: raytrace }),
  // Where the light the shadows fall from is, in degrees from the camera's view: across, from the left to the right,
  // and up, from below to above; it starts above and to the left of the camera
  lightAzimuth: slider({
    folder: 'Look',
    label: 'Light azimuth',
    default: -45,
    min: -180,
    max: 180,
    step: 1,
    shownFor: raytrace,
    shownWhile: shadowed,
  }),
  lightElevation: slider({
    folder: 'Look',
    label: 'Light elevation',
    default: 45,
    min: -90,
    max: 90,
    step: 1,
    shownFor: raytrace,
    shownWhile: shadowed,
  }),
  // The surface's two meshes, each a switch, and the far side of the skin drawn under its near side below full
  // Opacity, so that the body reads as a hollow shell
  skin: toggle({ folder: 'Look', label: 'Skin', default: true, shownFor: surface }),
  bone: toggle({ folder: 'Look', label: 'Bone', default: true, shownFor: surface }),
  backShell: toggle({ folder: 'Look', label: 'Back shell', default: false, shownFor: surface, shownWhile: translucent }),
  // What the mesh inside the skin is of, which the Bone switch shows: offered only for a body with an MRI
  inner: choice<Inner>({
    folder: 'Look',
    label: 'Inner',
    default: 'bone',
    choices: { bone: 'bone', brain: 'brain' },
    shownFor: surface,
    needs: 'mri',
  }),
  colour: choice<SurfaceColour>({
    folder: 'Look',
    label: 'Colour',
    default: 'texture',
    choices: { texture: 'texture', cells: 'cells' },
    shownFor: surface,
  }),
  // How far under the skin the shell inside it lies, in millimetres: the closed surface that far in from the skin
  // everywhere, which shows the tissue at that depth through a see-through skin or with the skin off. At 0 there is
  // no shell
  depth: slider({ folder: 'Look', label: 'Depth (mm)', default: 0, min: 0, max: 100, step: 1, shownFor: surface }),
  // The density, on the file's scale, from which a voxel counts as bone. The default is the scale's, which the
  // density channel was built to; the range runs from dense soft tissue to the densest bone. It shows while the bone
  // is drawn, though it also sets where the surface's caps turn solid and what shadows a cut face of the raytrace
  boneThreshold: slider({
    folder: 'Look',
    label: 'Bone threshold',
    default: 110,
    min: 70,
    max: 200,
    step: 1,
    shownFor: surfaces,
    shownWhile: boneDrawn,
  }),
  // The MRI's value, on the file's scale of 1 to 255, from which a voxel is inside the surface the raytrace's brain
  // and the surface's inner brain are drawn at. The default sits between the skull, which the MRI shows dark, and the
  // brain inside it
  mriThreshold: slider({
    folder: 'Look',
    label: 'MRI threshold',
    default: mriThresholdDefault,
    min: 1,
    max: 255,
    step: 1,
    shownFor: surfaces,
    shownWhile: brainDrawn,
    needs: 'mri',
  }),
  // How much a surface's edges light up where it turns away from the eye, which draws it as a glass shell
  rim: slider({ folder: 'Look', label: 'Rim', default: 0, min: 0, max: 1, step: hundredths, shownFor: surfaces }),
  opacity: slider({ folder: 'Look', label: 'Opacity', default: 1, min: 0, max: 1, step: hundredths, shownFor: every }),
  // The cuts run from 0, nothing cut, to 1, the whole body cut away: down from the head, back from the front, and
  // across from the body's right
  axial: slider({ folder: 'Cuts', label: 'Axial', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  coronal: slider({ folder: 'Cuts', label: 'Coronal', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  sagittal: slider({ folder: 'Cuts', label: 'Sagittal', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  // The section through the body shown on each of the surface's cuts
  caps: toggle({ folder: 'Cuts', label: 'Caps', default: true, shownFor: surface }),
  // How far the far side of the body darkens, from none at 0 to black at 1
  depthCue: slider({ folder: 'Scene', label: 'Depth cue', default: 0, min: 0, max: 1, step: hundredths, shownFor: every }),
  // The strength of a glow spread around the bright parts of the scene, how far it spreads, from 0 to 1, and the
  // brightness, from 0 to 1, below which nothing glows. The spread and the threshold matter only while it's on, and
  // show just below it
  bloom: slider({ folder: 'Scene', label: 'Bloom', default: 0, min: 0, max: 3, step: hundredths, shownFor: every }),
  bloomRadius: slider({
    folder: 'Scene',
    label: 'Bloom radius',
    default: bloomRadiusDefault,
    min: 0,
    max: 1,
    step: hundredths,
    shownFor: every,
    shownWhile: { option: 'bloom', above: 0 },
  }),
  bloomThreshold: slider({
    folder: 'Scene',
    label: 'Bloom threshold',
    default: bloomThresholdDefault,
    min: 0,
    max: 1,
    step: hundredths,
    shownFor: every,
    shownWhile: { option: 'bloom', above: 0 },
  }),
  // Order-independent transparency: the surface's see-through skin summed by how near and how opaque each layer is, in
  // place of the depth pass that shows only the nearest, so that every layer of skin shows over the bone and nothing
  // depends on the order the triangles are drawn in. It acts only below full Opacity
  oit: toggle({ folder: 'Scene', label: 'OIT', default: false, shownFor: surface, shownWhile: translucent, needs: 'oit' }),
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
  blend: viewOptions.blend.default,
  mode: viewOptions.mode.default,
  density: viewOptions.density.default,
  windowLow: viewOptions.windowLow.default,
  windowHigh: viewOptions.windowHigh.default,
  quality: viewOptions.quality.default,
  shading: viewOptions.shading.default,
  grey: viewOptions.grey.default,
  trace: viewOptions.trace.default,
  layers: viewOptions.layers.default,
  shadows: viewOptions.shadows.default,
  lightAzimuth: viewOptions.lightAzimuth.default,
  lightElevation: viewOptions.lightElevation.default,
  skin: viewOptions.skin.default,
  bone: viewOptions.bone.default,
  backShell: viewOptions.backShell.default,
  inner: viewOptions.inner.default,
  colour: viewOptions.colour.default,
  depth: viewOptions.depth.default,
  boneThreshold: viewOptions.boneThreshold.default,
  mriThreshold: viewOptions.mriThreshold.default,
  rim: viewOptions.rim.default,
  opacity: viewOptions.opacity.default,
  axial: viewOptions.axial.default,
  coronal: viewOptions.coronal.default,
  sagittal: viewOptions.sagittal.default,
  caps: viewOptions.caps.default,
  depthCue: viewOptions.depthCue.default,
  bloom: viewOptions.bloom.default,
  bloomRadius: viewOptions.bloomRadius.default,
  bloomThreshold: viewOptions.bloomThreshold.default,
  oit: viewOptions.oit.default,
}

// Whether a control shows for the style drawn, by the styles it's shown for and the values of the controls it depends
// on, which valueOf gives by their keys
export function isShown(entry: { shownFor: ShownFor; shownWhile?: ShownWhile }, style: Style, valueOf: (option: string) => unknown) {
  if (entry.shownFor !== 'every' && !entry.shownFor.styles.includes(style)) return false
  const allows = (dependence: Dependence) => {
    const value = valueOf(dependence.option)
    if ('is' in dependence) return value === dependence.is
    if ('isNot' in dependence) return value !== dependence.isNot
    if ('oneOf' in dependence) return typeof value === 'string' && dependence.oneOf.includes(value)
    if ('above' in dependence) return typeof value === 'number' && value > dependence.above
    return typeof value === 'number' && value < dependence.below
  }
  const allow = (dependences: Dependences) => ('all' in dependences ? dependences.all.every(allows) : allows(dependences))
  const { shownWhile } = entry
  if (!shownWhile) return true
  if (!('byStyle' in shownWhile)) return allow(shownWhile)
  const forStyle = shownWhile.byStyle[style]
  return forStyle === undefined || allow(forStyle)
}

// The options as the backend can draw them and the body shown allows: a choice or a switch that needs what the
// backend or the body lacks goes back to its default, and the rest stand. The same object comes back where nothing
// changes
export function drawableOptions(options: ViewOptions, capabilities: Capabilities): ViewOptions {
  const lacking = (need: Capability | undefined) => need !== undefined && !capabilities[need]
  const blend = lacking(viewOptions.blend.choiceNeeds?.[options.blend]) ? viewOptions.blend.default : options.blend
  const oit = options.oit && !lacking(viewOptions.oit.needs)
  const density = lacking(viewOptions.density.choiceNeeds?.[options.density]) ? viewOptions.density.default : options.density
  const trace = lacking(viewOptions.trace.choiceNeeds?.[options.trace]) ? viewOptions.trace.default : options.trace
  const inner = lacking(viewOptions.inner.needs) ? viewOptions.inner.default : options.inner
  const same = blend === options.blend && oit === options.oit && density === options.density && trace === options.trace && inner === options.inner
  return same ? options : { ...options, blend, oit, density, trace, inner }
}
