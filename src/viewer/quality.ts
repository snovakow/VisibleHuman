import type { Quality } from '../options.ts'

// The step the quad styles take through the body's texture, as a share of a voxel, by Quality: the automatic step is
// a whole voxel on the WebGL 2 fallback, which shades every pixel of the window on this project's slowest machines,
// and half a voxel on WebGPU
const stepShares: Record<Exclude<Quality, 'auto'>, number> = { voxel: 1, half: 0.5, quarter: 0.25 }

export function stepShare(quality: Quality, webgpu: boolean) {
  if (quality !== 'auto') return stepShares[quality]
  return webgpu ? stepShares.half : stepShares.voxel
}
