import type { Blend } from '../options.ts'

// The styles' ids, each of which has an entry in styles below. The type is written out rather than read from the
// entries, so that the options' type, which the table's entries name their styles through, doesn't lean on the entries
export type Style = 'splats' | 'volume' | 'raytrace' | 'surface'

// The ways the panel's Style chooser can draw the body, in its order; an entry added here, with its id in Style,
// appears there. The splats draw one Gaussian per cell of a level, the volume marches a ray through the body's 3D
// texture from a full-screen quad, the raytrace follows the same ray to the skin and bone surfaces, and the surface
// meshes them by marching cubes
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

// Whether the splats are summed by weight rather than laid over one another: the weighted Blend, in the splats style,
// as the other styles take no Blend
export function isWeighted(options: { style: Style; blend: Blend }) {
  return options.blend === 'weighted' && options.style === 'splats'
}

// Whether the surface's caps show a section: the Caps switch on, with a cut open
export function isCapped(options: { caps: boolean; axial: number; coronal: number; sagittal: number }) {
  return options.caps && (options.axial > 0 || options.coronal > 0 || options.sagittal > 0)
}

// Whether the far side of the body is drawn under its near side, so that it reads as hollow glass: the Back shell
// switch on, with the surface's skin below full Opacity. At full Opacity the surface is opaque, so the far side is
// hidden, and with the skin off there's no far side to draw, so the switch draws nothing
export function isBackShell(options: { style: Style; backShell: boolean; opacity: number; skin: boolean }) {
  return options.backShell && options.style === 'surface' && options.opacity < 1 && options.skin
}

// Whether the surface's see-through layers are summed without an order rather than shown by the skin's depth pass:
// the OIT switch on, with the surface below full Opacity and something see-through to sum, the skin or a cap's
// section. At full Opacity, or with neither, there's nothing to sum, and the pass that sums would only draw the opaque
// meshes again, which on the WebGL 2 fallback it does without multisampling, so their edges would lose their smoothing
export function isOit(options: { style: Style; oit: boolean; opacity: number; skin: boolean } & Parameters<typeof isCapped>[0]) {
  return options.oit && options.style === 'surface' && options.opacity < 1 && (options.skin || isCapped(options))
}
