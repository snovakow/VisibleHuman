import { CustomBlending, NoBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial } from 'three/webgpu'
import type { Volume } from '../../../volume/format.ts'
import { createBodySampler, type Channel } from '../../body/sampler.ts'
import { cutBox } from '../../cuts.ts'
import { stepShare } from '../quality.ts'
import { createRayQuad } from '../rayQuad.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import { raytrace, traceIndex } from './trace.ts'

// The Raytrace style: the skin and the bone traced through the body's 3D textures from the ray quad, with the
// surfaces, layers, shadows and light the look sets

// Below full Opacity the quad is drawn with the transparent things, after everything opaque, so that what the skin
// lets through is all there
const quadRenderOrder = 1000

export function createRaytrace({ webgpu, cue, events }: StyleContext): StyleDrawing {
  const sampler = createBodySampler({ coverage: true })
  const tracer = raytrace(sampler, cue)
  // The trace writes the depth of the first surface it meets and tests against what's drawn before it, so the
  // surfaces and anything else in the scene hide one another where each is nearer; it's hidden until a body gives it
  // its textures
  const material = new NodeMaterial()
  material.colorNode = tracer.colorNode
  material.depthNode = tracer.depthNode
  material.depthTest = true
  material.depthWrite = true
  material.fog = false
  material.blendSrc = OneFactor
  material.blendDst = OneMinusSrcAlphaFactor
  const quad = createRayQuad(material)
  quad.renderOrder = quadRenderOrder
  quad.visible = false

  // The volume whose textures the trace reads, with what the colour's fourth channel holds, and whether the material
  // is set to blend
  let bound: { volume: Volume; channel: Channel } | null = null
  let blending: boolean | null = null

  return {
    object: quad,
    update(body, look) {
      const { trace, layers, shadows, lightAzimuth, lightElevation, boneThreshold, mriThreshold, rim, opacity, quality } = look.raytrace

      // The colour with the density, or with the MRI in the density's place while the brain is traced
      const tracesBrain = trace === 'brain' && body?.volume.mri !== undefined
      const channel: Channel = tracesBrain ? 'mri' : 'density'
      if (bound?.volume !== body?.volume || (bound && bound.channel !== channel)) {
        sampler.bind(body, channel)
        bound = body ? { volume: body.volume, channel } : null
        quad.visible = body !== null
        if (body) {
          const { volume } = body
          tracer.setGrid(volume, body.bounds.center)
          whenFirstDrawn(quad, () => events.drawn(volume))
        }
      }

      // The box the cuts leave of the bounds clips every ray and bounds its steps, which are sized by Quality and,
      // for the automatic step, by the backend drawing
      if (body) tracer.setCuts(cutBox(body.bounds.half, look.cuts))
      tracer.setStep(stepShare(quality, webgpu))

      // At full Opacity the skin is solid and the quad is drawn as an opaque thing, writing its depth and blending
      // nothing. Below it the quad is drawn with the transparent things and lays its premultiplied colour, the layers
      // already composited, over what's behind, still writing the depth of the first surface
      const translucent = opacity < 1
      if (blending !== translucent) {
        blending = translucent
        material.transparent = translucent
        material.blending = translucent ? CustomBlending : NoBlending
        material.needsUpdate = true
      }

      // The rest goes straight to the trace's uniforms. The brain's surface is the same field's as the bone's, at the
      // MRI's threshold
      tracer.opacity.value = opacity
      tracer.trace.value = traceIndex[trace]
      tracer.layers.value = layers
      tracer.shadows.value = shadows
      tracer.setLight(lightAzimuth, lightElevation)
      tracer.boneThreshold.value = (trace === 'brain' ? mriThreshold : boneThreshold) / 255
      tracer.rim.value = rim
    },
    dispose() {
      quad.geometry.dispose()
      material.dispose()
      sampler.dispose()
    },
  }
}
