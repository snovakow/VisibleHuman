import type { Transparency } from '../frame/plan.ts'
import type { Look, Style } from '../look.ts'
import { isWeighted } from './splats/blend.ts'
import { isOit } from './surface/rules.ts'

// The styles as the rest of the page knows them: each one's name, and what the frame has to do for it. This module
// builds nothing, so the panel and the tests read it without loading a shader; create.ts holds what draws each

interface StyleEntry {
  id: Style
  // Its name in the panel's Style chooser
  label: string
  // Whether it shades every pixel of the window from the ray quad, one ray to a pixel. With a single sample a pixel,
  // the edges it finds step from pixel to pixel and crawl as the view moves, which the renderer's multisampling can't
  // smooth, as it smooths only the edges of what's drawn, and the quad covers the window
  perPixel: boolean
  // How the frame puts together what the style draws see-through at a look
  transparency(look: Look): Transparency
}

// In the panel's order; an entry added here, with its id in Style and its drawing in create.ts, appears there
export const styles = [
  { id: 'splats', label: 'splats', perPixel: false, transparency: (look) => (isWeighted(look.splats) ? 'weighted' : 'ordered') },
  { id: 'volume', label: 'volume', perPixel: true, transparency: () => 'ordered' },
  { id: 'raytrace', label: 'raytrace', perPixel: true, transparency: () => 'ordered' },
  { id: 'surface', label: 'surface', perPixel: false, transparency: (look) => (isOit(look.surface, look.cuts) ? 'oit' : 'ordered') },
] as const satisfies readonly StyleEntry[]

// Whether a value, such as one from the page's URL, is a style's id
export const isStyle = (value: unknown): value is Style => styles.some((style) => style.id === value)

// A style's entry
export function styleOf(id: Style): StyleEntry {
  const entry = styles.find((style) => style.id === id)
  if (!entry) throw new Error(`No style is named ${id}`)
  return entry
}
