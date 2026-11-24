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

// From the front and a little above, the middle of the sway, which swings the view as far round each way, so that
// the body shows its depth, which held straight on from the front it hides
const raised: ViewAngle = { azimuth: 0, elevation: 8 }

// The body cut open from the front to a little past its middle, by the raytrace, so that the cut face shows the
// organs, the spine and the brain in the photographs' own colours, with the skin's edge lit, a glow about the
// brightest parts, and the far side darkened
const cutaway = {
  id: 'cutaway',
  options: { style: 'raytrace', coronal: 0.55, rim: 0.4, depthCue: 0.4, bloom: 0.4, bloomThreshold: 0.4 },
  view: raised,
} as const satisfies Preset

// The skeleton in its own colour: the volume with the window's low end raised past the soft tissue, which leaves the
// bone, shaded by its slope and glowing softly against the dark
const skeleton = {
  id: 'skeleton',
  options: { style: 'volume', shading: true, windowLow: 0.25, depthCue: 0.5, bloom: 0.5, bloomRadius: 0.5 },
  view: raised,
} as const satisfies Preset

// The skeleton as an X-ray glowing white: the most density along each ray, windowed to the bone, with its brightest
// parts blooming. Its name is spelt as the panel spells the volume's x-ray
const xray = {
  id: 'x-ray',
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

// The body as glass: the raytrace's skin nearly clear with its edges lit, so that the bone shows solid within it
const glass = {
  id: 'glass',
  options: { style: 'raytrace', opacity: 0.18, rim: 1, depthCue: 0.4, bloom: 0.5, bloomThreshold: 0.4 },
  view: raised,
} as const satisfies Preset

export const presets: readonly Preset[] = [cutaway, skeleton, xray, glass]

// The preset a bare address opens on, the first impression of the page
export const launchPreset: Preset = cutaway

// The preset an id names, as ?preset= gives it, or none
export function presetOf(id: string | null): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}

// Every option a preset sets: its own, and the rest at their defaults, so that nothing moved before it is left over
// in its look. The Detail is left as it is, since it's the body's levels' to give and says how fine, not how drawn
export function presetOptions(preset: Preset): Partial<ViewOptions> {
  const { detail: _, ...look } = defaultOptions
  return { ...look, ...preset.options }
}
