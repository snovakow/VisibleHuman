import type { Style } from '../look.ts'
import { createRaytrace } from './raytrace/raytrace.ts'
import { createSplats } from './splats/splats.ts'
import type { StyleContext, StyleDrawing } from './style.ts'
import { createSurface } from './surface/surface.ts'
import { createVolume } from './volume/volume.ts'

// What draws the body in each style, by the style's id in styles.ts
export const createStyle: Record<Style, (context: StyleContext) => StyleDrawing> = {
  splats: createSplats,
  volume: createVolume,
  raytrace: createRaytrace,
  surface: createSurface,
}
