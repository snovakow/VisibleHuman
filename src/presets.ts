import { defaultOptions, type ViewOptions } from './options.ts'
import type { ViewAngle } from './viewer/viewAngle.ts'

// The presets: looks the page can open on, and the panel's buttons at its top apply, each a few of the panel's
// options set over their defaults, with the angle every body is framed from as the page opens. ?preset= in the
// address names one, and an address that names neither a preset nor a style opens on the launch preset. Each sets
// only what its own look draws, so that every control it moves shows in the panel, and nothing a backend or a body
// may lack, so that it draws as set under WebGPU or WebGL 2 and on every body. Their values were chosen by eye on all
// three bodies, the glow held back where the head, which fills more of the window than a body, would burn out
export interface Preset {
  // Its name on its button and in the address
  id: string
  options: Partial<ViewOptions>
  view: ViewAngle
}

// A little round from the front toward the body's left, and a little above it, so that the body shows its depth,
// which held straight on from the front it hides. The sway sets off from here into its swing about the front
const raised: ViewAngle = { azimuth: 30, elevation: 8 }

// The body cut open from the front to a little past its middle, by the raytrace, so that the cut face shows the
// organs, the spine and the brain in the photographs' own colours, with the skin's edge lit, a glow about the
// brightest parts, and the far side darkened
const cutaway = {
  id: 'cutaway',
  options: { style: 'raytrace', coronal: 0.55, rim: 0.4, depthCue: 0.4, bloom: 0.4, bloomThreshold: 0.4 },
  view: raised,
} as const satisfies Preset

// The skeleton in its own colour: the volume with its window drawn in to the bone, the low end raised past the soft
// tissue and the high end lowered to where the bone stands solid, shaded by its slope and glowing softly against the
// dark. A 4 mm block that holds bone holds flesh beside it, so its density falls well short of the scale's top: nine
// tenths of the male's bone lies under half the scale, and under a window that runs on to the top the bodies' bone is
// thin and dim. The low end is as low as leaves the muscle of the arms and the shoulders out
const skeleton = {
  id: 'skeleton',
  options: { style: 'volume', shading: true, windowLow: 0.28, windowHigh: 0.6, depthCue: 0.4, bloom: 0.5, bloomRadius: 0.5 },
  view: raised,
} as const satisfies Preset

// The body as a radiograph: the volume's x-ray, which shows how much of each ray the body stops, so that the bone
// stands white in the grey of the flesh, with the lungs and the gut's gas dark. The far side counts for a little less,
// which tells the near side from the far as the view sways, where an x-ray alone doesn't say which way a body turns.
// It takes no glow, which lifts the grey of the flesh toward the bone's white. The x-ray reads the density as it is,
// so it holds on every body with nothing to set for each
const xray = {
  id: 'x-ray',
  options: { style: 'volume', mode: 'xray', depthCue: 0.3 },
  view: raised,
} as const satisfies Preset

// The body as glass: the raytrace's skin all but clear with its edges lit, so that the bone shows solid within it. The
// skin is laid in its own colour, and at more than a little Opacity two layers of it tint the whole body olive and
// hide the ribs
const glass = {
  id: 'glass',
  options: { style: 'raytrace', opacity: 0.08, rim: 1, depthCue: 0.4, bloom: 0.5, bloomThreshold: 0.4 },
  view: raised,
} as const satisfies Preset

export const presets: readonly Preset[] = [cutaway, skeleton, xray, glass]

// The preset a bare address opens on, the first impression of the page
export const launchPreset: Preset = cutaway

// The x-ray as it was before it took the volume's own: the most density along each ray, windowed to the bone, with its
// brightest parts blooming, so that the skeleton glows white. The head's bone is the densest in the files, a seventh of
// it over six tenths of the scale where a two-hundredth of the male's 4 mm bone is, so a window bright enough for the
// bodies burns the head out white, and this one, held back for the head, leaves the bodies dim
const xrayMip = {
  id: 'x-ray-mip',
  options: {
    style: 'volume',
    mode: 'mip',
    windowLow: 0.3,
    windowHigh: 0.9,
    depthCue: 0.5,
    bloom: 0.6,
    bloomRadius: 0.5,
    bloomThreshold: 0.5,
  },
  view: raised,
} as const satisfies Preset

// Looks kept beside the presets to compare with them, which have no button: ?preset= in the address opens on one
export const alternates: readonly Preset[] = [xrayMip]

// The preset an id names, as ?preset= gives it, or the alternate, or none
export function presetOf(id: string | null): Preset | undefined {
  return [...presets, ...alternates].find((preset) => preset.id === id)
}

// Every option a preset sets: its own, and the rest at their defaults, so that nothing moved before it is left over
// in its look. The Detail is left as it is, since it's the body's levels' to give and says how fine, not how drawn
export function presetOptions(preset: Preset): Partial<ViewOptions> {
  const { detail: _, ...look } = defaultOptions
  return { ...look, ...preset.options }
}
