import type { ViewOptions } from './options.ts'
import type { Look } from './render/look.ts'

// The look the page's options ask for: the one place the panel's flat table of options meets what the scene draws
// by. An option a style alone reads goes to that style's part, and one that several styles share, as Opacity, the
// thresholds, Rim, Quality and the Detail are, goes to each of theirs, so a style reads no option but its own and the
// table is free to change its shape without the scene's knowing

// The look last made, with the options it was made from: the store keeps the same options object while nothing in it
// changes, so the same look comes back for it, and the stage does nothing for a look it already has
let last: { options: ViewOptions; look: Look } | null = null

export function lookOf(options: ViewOptions): Look {
  if (last?.options === options) return last.look
  const { opacity, quality, boneThreshold, mriThreshold, rim, detail } = options
  const look: Look = {
    style: options.style,
    cuts: { axial: options.axial, coronal: options.coronal, sagittal: options.sagittal },
    depthCue: options.depthCue,
    bloom: { strength: options.bloom, radius: options.bloomRadius, threshold: options.bloomThreshold },
    splats: { detail, size: options.size, blend: options.blend, opacity },
    volume: {
      mode: options.mode,
      density: options.density,
      windowLow: options.windowLow,
      windowHigh: options.windowHigh,
      quality,
      shading: options.shading,
      grey: options.grey,
      opacity,
    },
    raytrace: {
      trace: options.trace,
      layers: options.layers,
      shadows: options.shadows,
      lightAzimuth: options.lightAzimuth,
      lightElevation: options.lightElevation,
      boneThreshold,
      mriThreshold,
      rim,
      opacity,
      quality,
    },
    surface: {
      skin: options.skin,
      bone: options.bone,
      backShell: options.backShell,
      inner: options.inner,
      colour: options.colour,
      depth: options.depth,
      detail,
      boneThreshold,
      mriThreshold,
      rim,
      opacity,
      caps: options.caps,
      oit: options.oit,
    },
  }
  last = { options, look }
  return look
}
