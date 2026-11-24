import type { Blend, SplatLook } from '../../look.ts'

// Whether a blend lays the splats over one another in order, back to front. Added light doesn't depend on the order
// it's drawn in, nor does a weighted sum, so neither is sorted as the camera moves
export const isSorted = (blend: Blend) => blend === 'normal'

// Whether the splats are summed by weight rather than laid over one another, which the frame then resolves
export const isWeighted = (splats: Pick<SplatLook, 'blend'>) => splats.blend === 'weighted'
