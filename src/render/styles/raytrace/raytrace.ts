import { CustomBlending, NoBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial } from 'three/webgpu'
import type { Volume } from '../../../volume/format.ts'
import type { Body } from '../../body/body.ts'
import { createPosedRead, type PosedRead } from '../../body/posedRead.ts'
import { createBodySampler, type BodySampler, type Channel } from '../../body/sampler.ts'
import { cutBox } from '../../cuts.ts'
import type { Look } from '../../look.ts'
import { stepShare } from '../quality.ts'
import { createRayQuad, quadMaterial } from '../rayQuad.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import { raytrace, traceIndex, type Raytrace } from './trace.ts'

// The Raytrace style: the skin and the bone traced through the body's 3D textures from the ray quad, with the
// surfaces, layers, shadows and light the look sets. A posed body is traced by a material of its own, made the first
// time one is drawn, which reads it through the posed read; the quad wears whichever the body asks for, so a body with
// no pose is drawn by the material it always was

// Below full Opacity the quad is drawn with the transparent things, after everything opaque, so that what the skin
// lets through is all there
const quadRenderOrder = 1000

// The trace writes the depth of the first surface it meets and tests against what's drawn before it, so the surfaces
// and anything else in the scene hide one another where each is nearer
function traceMaterial(tracer: Raytrace) {
  const material = new NodeMaterial()
  material.colorNode = tracer.colorNode
  material.depthNode = tracer.depthNode
  material.depthTest = true
  material.depthWrite = true
  material.fog = false
  material.blendSrc = OneFactor
  material.blendDst = OneMinusSrcAlphaFactor
  return material
}

export function createRaytrace({ webgpu, cue, events }: StyleContext): StyleDrawing {
  // The trace reads the two fields at every step, together, and the colour only where a ray meets a surface
  const sampler = createBodySampler({ coverage: false, fields: true })
  const tracer = raytrace(sampler, cue)
  const material = traceMaterial(tracer)
  // It's hidden until a body gives it its textures
  const quad = createRayQuad(material)
  quad.renderOrder = quadRenderOrder
  quad.visible = false

  // The posed trace, its read and its sampler, made once a posed body is first drawn
  let posed: { read: PosedRead; sampler: BodySampler; tracer: Raytrace; material: NodeMaterial } | null = null
  const posedOf = () => {
    if (posed) return posed
    const read = createPosedRead()
    const posedSampler = createBodySampler({ coverage: false, fields: true })
    const posedTracer = raytrace(posedSampler, cue, read)
    posed = { read, sampler: posedSampler, tracer: posedTracer, material: quadMaterial(traceMaterial(posedTracer)) }
    return posed
  }

  // The volume whose textures the trace reads, with what the colour's fourth channel holds, the posed body the posed
  // trace reads, and whether the materials are set to blend
  let bound: { volume: Volume; channel: Channel } | null = null
  let posedBound: { body: Body; channel: Channel } | null = null
  let blending: boolean | null = null
  let posedBlending: boolean | null = null

  // Sets a trace from the look: the box the cuts leave of the bounds, which clips every ray and bounds its steps, or
  // which a posed trace cuts the scan by; the steps, sized by Quality and, for the automatic step, by the backend
  // drawing; and the rest straight to its uniforms. The brain's surface is the same field's as the bone's, at the MRI's
  // threshold
  const setTracer = (each: Raytrace, body: Body | null, look: Look) => {
    const { trace, layers, shadows, lightAzimuth, lightElevation, boneThreshold, mriThreshold, rim, opacity, quality } = look.raytrace
    if (body) each.setCuts(cutBox(body.bounds.half, look.cuts))
    each.setStep(stepShare(quality, webgpu))
    each.opacity.value = opacity
    each.trace.value = traceIndex[trace]
    each.layers.value = layers
    each.shadows.value = shadows
    each.setLight(lightAzimuth, lightElevation)
    each.boneThreshold.value = (trace === 'brain' ? mriThreshold : boneThreshold) / 255
    each.rim.value = rim
  }

  // At full Opacity the skin is solid and the quad is drawn as an opaque thing, writing its depth and blending nothing.
  // Below it the quad is drawn with the transparent things and lays its premultiplied colour, the layers already
  // composited, over what's behind, still writing the depth of the first surface
  const blend = (each: NodeMaterial, translucent: boolean) => {
    each.transparent = translucent
    each.blending = translucent ? CustomBlending : NoBlending
    each.needsUpdate = true
  }

  return {
    object: quad,
    update(body, look) {
      const { trace, opacity } = look.raytrace

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
      // A posed body is read through its rig by the posed trace, which takes the body up again whenever the body or
      // its binding changes, and lets it go when the pose does. The unposed trace keeps the body's textures meanwhile,
      // so that a pose on and off rebuilds none
      const posing = body?.posed ? body : null
      if (posing || posed) {
        const made = posedOf()
        if (posedBound?.body !== posing || posedBound.channel !== channel) {
          made.sampler.bind(posing, channel)
          made.read.bind(posing)
          posedBound = posing ? { body: posing, channel } : null
          if (posing) made.tracer.setGrid(posing.volume, posing.bounds.center)
        }
      }
      const shown = posing && posed ? posed.material : material
      if (quad.material !== shown) quad.material = shown

      setTracer(tracer, body, look)
      if (posed) setTracer(posed.tracer, posing, look)

      const translucent = opacity < 1
      if (blending !== translucent) {
        blending = translucent
        blend(material, translucent)
      }
      if (posed && posedBlending !== translucent) {
        posedBlending = translucent
        blend(posed.material, translucent)
      }
    },
    // The posed trace follows the bones once they've turned since it last did
    beforeFrame() {
      if (posedBound) posed?.tracer.pose()
    },
    dispose() {
      quad.geometry.dispose()
      material.dispose()
      sampler.dispose()
      if (posed) {
        posed.material.dispose()
        posed.sampler.dispose()
        posed.read.dispose()
      }
    },
  }
}
