// Density on the CT's scale, (HU + 1000) / 16: air 0, fat about 56, water 62, muscle about 65, bone 90 to 180. The
// volume file stores a density byte per voxel, 0 outside the body, from the registered CT where it covers the voxel,
// and from the voxel's colour where it doesn't. The colour stand-in here reads the cryosections' tissue colours: pale
// and unsaturated tissue is bone, red is muscle, yellow is fat. Calibrated on body pixels sampled from slices 1200,
// 1500, 2000 and 2600

import { darkMax } from './segment.ts'

// The density that counts as bone, for the bone surface and the raytrace: between muscle and cortical bone
export const boneDensity = 110
// Below this density the x-ray mode sees nothing, so soft tissue's faint haze doesn't hide the bone
export const xrayFloor = 40

// The rule's thresholds, exported so that the shader's reading of the same colours, in the volume march, is built
// from the same numbers.
// Pure red tissue, such as muscle (about 40 HU)
export const muscleDensity = 65
// Pure yellow tissue, such as fat: about −200 HU, a little under the CT's 56 for fat (about −100 HU)
export const fatDensity = 50
// A pale, unsaturated pixel, such as cortical bone (about 1,900 HU)
export const whiteDensity = 180
// How pale a pixel must be, in luminance from 0 to 1, before it starts to count as bone, and where it counts fully
export const paleFrom = 0.5
export const paleTo = 0.9
// How unsaturated, in saturation from 0 to 1: fully bone at or below the first, not at all at or above the second
export const unsaturatedTo = 0.05
export const unsaturatedFrom = 0.3

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

// The density byte for a voxel of this colour, from 1 (black) to whiteDensity, never 0, which means "outside the body"
export function densityFromColor(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const saturation = max === 0 ? 0 : (max - min) / max

  // Among the tissue hues, how red the colour is rather than yellow: 1 where green sits at blue (pure red), 0 where
  // green sits at red (yellow); a grey, with no hue, sits halfway
  const redness = r > b ? (r - g) / (r - b) : 0.5
  const soft = fatDensity + (muscleDensity - fatDensity) * clamp01(redness)

  // How much of the colour is pale and unsaturated, the look of bone, which lifts it from the tissue density
  const pale = clamp01((luminance - paleFrom) / (paleTo - paleFrom))
  const unsaturated = clamp01((unsaturatedFrom - saturation) / (unsaturatedFrom - unsaturatedTo))
  const density = soft + pale * unsaturated * (whiteDensity - soft)

  // Below the dark limit a pixel isn't body at all, so the ramp only tells a dark cell mean from black
  const dark = clamp01(max / darkMax)
  return Math.max(1, Math.min(255, Math.round(1 + (density - 1) * dark)))
}

// The CT pixels of the male's and the female's sets hold the scanner's own numbers: 16-bit values where 0 stands for
// −1024 HU, as every header's "Value to add to actual pixel data" field says. Air reads 0–100, water about 1024, bone
// 1,600 and over
export const ctPixelHounsfield = -1024

// The density byte of a CT pixel: its Hounsfield units on the (HU + 1000) / 16 scale, 0 for air and anything below it
export function densityFromCt(pixel: number): number {
  return Math.max(0, Math.min(255, Math.round((pixel + ctPixelHounsfield + 1000) / 16)))
}
