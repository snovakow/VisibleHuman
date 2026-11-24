import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial } from 'three/webgpu'
import type { Volume } from '../../../volume/format.ts'
import { createBodySampler, type Channel } from '../../body/sampler.ts'
import { cutBox } from '../../cuts.ts'
import type { VolumeMode } from '../../look.ts'
import { stepShare } from '../quality.ts'
import { createRayQuad } from '../rayQuad.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import { modeIndex, sourceIndex, volumeMarch } from './march.ts'

// The Volume style: the body's 3D texture marched from the ray quad, in the mode, window and quality the look sets

// The quad is drawn after everything else, so that what the march lays over is all there
const quadRenderOrder = 1000
// The window's ends are kept at least this far apart, since a step function would be undefined where they met
const leastWindow = 1e-3

export function createVolume({ webgpu, cue, events }: StyleContext): StyleDrawing {
  const sampler = createBodySampler({ coverage: false })
  const march = volumeMarch(sampler, cue)
  // The march lays what it gathers over what's behind, with its colour already multiplied by what it covers, so it
  // tests and writes no depth and is drawn last, and it's hidden until a body gives it a texture
  const material = new NodeMaterial()
  material.colorNode = march.colorNode
  material.transparent = true
  material.depthTest = false
  material.depthWrite = false
  material.fog = false
  material.blending = CustomBlending
  material.blendSrc = OneFactor
  const quad = createRayQuad(material)
  quad.renderOrder = quadRenderOrder
  quad.visible = false

  // The volume whose texture the march reads, with what its fourth channel holds, and the mode the material blends for
  let bound: { volume: Volume; channel: Channel } | null = null
  let blended: VolumeMode | null = null

  return {
    object: quad,
    update(body, look) {
      const { mode, density, windowLow, windowHigh, quality, shading, grey, opacity } = look.volume

      // The colour with the density, or with the MRI in the density's place while the Density is the MRI
      const channel: Channel = density === 'mri' && body?.volume.mri !== undefined ? 'mri' : 'density'
      if (bound?.volume !== body?.volume || (bound && bound.channel !== channel)) {
        sampler.bind(body, channel)
        bound = body ? { volume: body.volume, channel } : null
        quad.visible = body !== null
        if (body) {
          const { volume } = body
          march.setSpacing(volume.spacing)
          whenFirstDrawn(quad, () => events.drawn(volume))
        }
      }

      // The box the cuts leave of the bounds clips every ray and bounds its steps, which are sized by Quality and,
      // for the automatic step, by the backend drawing
      if (body) march.setCuts(cutBox(body.bounds.half, look.cuts))
      march.setStep(stepShare(quality, webgpu))

      // Over, x-ray and MIP lay a premultiplied colour over what's behind, and the glow is added to it whole. three's
      // additive blending would scale the glow by its alpha first, so the factors are given outright
      if (blended !== mode) {
        blended = mode
        material.blendDst = mode === 'glow' ? OneFactor : OneMinusSrcAlphaFactor
        material.needsUpdate = true
      }

      // The rest goes straight to the march's uniforms, the window's high end kept above its low
      march.mode.value = modeIndex[mode]
      march.densitySource.value = sourceIndex[density]
      march.opacity.value = opacity
      march.windowLow.value = windowLow
      march.windowHigh.value = Math.max(windowHigh, windowLow + leastWindow)
      march.shading.value = shading
      march.grey.value = grey
    },
    dispose() {
      quad.geometry.dispose()
      material.dispose()
      sampler.dispose()
    },
  }
}
