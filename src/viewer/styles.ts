import type { Blend } from '../options.ts'

// The styles' ids, each of which has an entry in styles below. The type is written out rather than read from the
// entries, so that the options' type, which the table's entries name their styles through, doesn't lean on the entries
export type Style = 'splats' | 'volume' | 'raytrace' | 'surface'

// The ways the panel's Style chooser can draw the body, in its order; an entry added here, with its id in Style,
// appears there. The splats draw one Gaussian per cell of a level; the others are still to come: the volume is to
// march a ray through the body's 3D texture from a full-screen quad, the raytrace to trace the skin and bone surfaces
// from the same quad, and the surface to mesh them by marching cubes
interface StyleEntry {
  id: Style
  label: string
}

export const styles = [
  { id: 'splats', label: 'splats' },
  { id: 'volume', label: 'volume' },
  { id: 'raytrace', label: 'raytrace' },
  { id: 'surface', label: 'surface' },
] as const satisfies readonly StyleEntry[]

// Whether a value, such as one from the page's URL, is a style's id
export const isStyle = (value: unknown): value is Style => styles.some((style) => style.id === value)

// A style's entry, or the first style's for an id no entry has
export function styleOf(style: Style): StyleEntry {
  return styles.find((entry) => entry.id === style) ?? styles[0]
}

// Whether the splats are summed by weight rather than laid over one another: the weighted Blend, in the splats style,
// as the other styles take no Blend
export function isWeighted(options: { style: Style; blend: Blend }) {
  return options.blend === 'weighted' && options.style === 'splats'
}

// Whether the far side of the body is drawn under its near side, so that it reads as hollow glass: the Back shell
// switch on, with the surface below full Opacity. At full Opacity the surface is opaque, so the far side is hidden and
// the switch draws nothing
export function isBackShell(options: { style: Style; backShell: boolean; opacity: number }) {
  return options.backShell && options.style === 'surface' && options.opacity < 1
}
