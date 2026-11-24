import { isCut, type Cuts } from '../../cuts.ts'
import type { SurfaceLook } from '../../look.ts'

// What the surface draws of its see-through parts at a look. The style and the frame both read these, and the panel
// shows each of the controls behind them exactly where its rule holds, so that nothing it hides is still at work

// Whether the caps show a section: the Caps switch on, with a cut open
export function isCapped(surface: Pick<SurfaceLook, 'caps'>, cuts: Cuts) {
  return surface.caps && isCut(cuts)
}

// Whether the far side of the body is drawn under its near side, so that it reads as hollow glass: the Back shell
// switch on, with the skin below full Opacity. At full Opacity the surface is opaque, so the far side is hidden, and
// with the skin off there's no far side to draw, so the switch draws nothing
export function isBackShell(surface: Pick<SurfaceLook, 'backShell' | 'opacity' | 'skin'>) {
  return surface.backShell && surface.opacity < 1 && surface.skin
}

// Whether the see-through layers are summed without an order rather than shown by the skin's depth pass: the OIT
// switch on, below full Opacity, with something see-through to sum, the skin or a cap's section. At full Opacity, or
// with neither, there's nothing to sum, and the pass that sums would only draw the opaque meshes again, which on the
// WebGL 2 fallback it does without multisampling, so their edges would lose their smoothing
export function isOit(surface: Pick<SurfaceLook, 'oit' | 'opacity' | 'skin' | 'caps'>, cuts: Cuts) {
  return surface.oit && surface.opacity < 1 && (surface.skin || isCapped(surface, cuts))
}
