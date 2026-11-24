import type { Bloom, Look, Style } from '../look.ts'
import { styleOf } from '../styles/styles.ts'

// What a frame is made of, worked out from the look alone: how the scene's see-through things are put together,
// whether the frame's edges are smoothed after it's drawn, and the glow laid over it. The compositor draws a frame to
// its plan, and a plan that asks for none of these is drawn straight to the canvas

// How what's see-through is put together: laid over one another in the order the scene draws them; the splats summed
// by weight into two targets and resolved; or the surface's layers summed without an order over its opaque meshes
export type Transparency = 'ordered' | 'weighted' | 'oit'

export interface FramePlan {
  transparency: Transparency
  // FXAA over the frame, for a style whose edges the renderer's multisampling can't reach
  smoothed: boolean
  // The glow, or none
  bloom: Bloom | null
}

export function framePlan(look: Look): FramePlan {
  const style = styleOf(look.style)
  return {
    transparency: style.transparency(look),
    smoothed: style.perPixel,
    bloom: look.bloom.strength > 0 ? look.bloom : null,
  }
}

// Whether a plan adds nothing to the scene as drawn, so that the frame needs no passes
export function isDirect(plan: FramePlan) {
  return plan.transparency === 'ordered' && !plan.smoothed && plan.bloom === null
}

// The pixel ratios a canvas draws at, as a least and a most: the device's, up to 2, unless a style that shades every
// pixel of the window runs on the WebGL 2 fallback, where the ratio is held at 1 to keep its frame rate
const fullPixelRatio: [number, number] = [1, 2]
const fallbackPerPixelRatio: [number, number] = [1, 1]

export function pixelRatioFor(style: Style, onFallback: boolean) {
  return onFallback && styleOf(style).perPixel ? fallbackPerPixelRatio : fullPixelRatio
}
