import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial } from 'three/webgpu'
import type { Volume } from '../../../volume/format.ts'
import type { Body } from '../../body/body.ts'
import { createPosedRead, type PosedRead } from '../../body/posedRead.ts'
import { createBodySampler, type BodySampler, type Channel } from '../../body/sampler.ts'
import { cutBox } from '../../cuts.ts'
import type { Look, VolumeMode } from '../../look.ts'
import { stepShare } from '../quality.ts'
import { createRayQuad, quadMaterial } from '../rayQuad.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import { modeIndex, sourceIndex, volumeMarch, type VolumeMarch } from './march.ts'

// The Volume style: the body's 3D texture marched from the ray quad, in the mode, window and quality the look sets. A
// posed body is marched by a material of its own, made the first time one is drawn, which reads it through the posed
// read; the quad wears whichever the body asks for, so a body with no pose is drawn by the material it always was

// The quad is drawn after everything else, so that what the march lays over is all there
const quadRenderOrder = 1000
// The window's ends are kept at least this far apart, since a step function would be undefined where they met
const leastWindow = 1e-3

// The march lays what it gathers over what's behind, with its colour already multiplied by what it covers, so it tests
// and writes no depth and is drawn last
function marchMaterial(march: VolumeMarch) {
  const material = new NodeMaterial()
  material.colorNode = march.colorNode
  material.transparent = true
  material.depthTest = false
  material.depthWrite = false
  material.fog = false
  material.blending = CustomBlending
  material.blendSrc = OneFactor
  return material
}

export function createVolume({ webgpu, cue, events }: StyleContext): StyleDrawing {
  const sampler = createBodySampler({ coverage: false })
  const march = volumeMarch(sampler, cue)
  const material = marchMaterial(march)
  // It's hidden until a body gives it a texture
  const quad = createRayQuad(material)
  quad.renderOrder = quadRenderOrder
  quad.visible = false

  // The posed march, its read and its sampler, which reads the coverage as well, made once a posed body is first drawn
  let posed: { read: PosedRead; sampler: BodySampler; march: VolumeMarch; material: NodeMaterial } | null = null
  const posedOf = () => {
    if (posed) return posed
    const read = createPosedRead()
    const posedSampler = createBodySampler({ coverage: true })
    const posedMarch = volumeMarch(posedSampler, cue, read)
    const posedMaterial = quadMaterial(marchMaterial(posedMarch))
    posedMaterial.blendDst = material.blendDst
    posed = { read, sampler: posedSampler, march: posedMarch, material: posedMaterial }
    return posed
  }

  // The volume whose texture the march reads, with what its fourth channel holds, the posed body the posed march reads,
  // and the mode the materials blend for
  let bound: { volume: Volume; channel: Channel } | null = null
  let posedBound: { body: Body; channel: Channel } | null = null
  let blended: VolumeMode | null = null

  // Sets a march from the look: the box the cuts leave of the bounds, which clips every ray and bounds its steps, or
  // which a posed march cuts the scan by; the steps, sized by Quality and, for the automatic step, by the backend
  // drawing; and the rest straight to its uniforms, the window's high end kept above its low
  const setMarch = (each: VolumeMarch, body: Body | null, look: Look) => {
    const { mode, density, windowLow, windowHigh, quality, shading, grey, opacity } = look.volume
    if (body) each.setCuts(cutBox(body.bounds.half, look.cuts))
    each.setStep(stepShare(quality, webgpu))
    each.mode.value = modeIndex[mode]
    each.densitySource.value = sourceIndex[density]
    each.opacity.value = opacity
    each.windowLow.value = windowLow
    each.windowHigh.value = Math.max(windowHigh, windowLow + leastWindow)
    each.shading.value = shading
    each.grey.value = grey
  }

  return {
    object: quad,
    update(body, look) {
      const { mode, density } = look.volume

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
      // A posed body is read through its rig by the posed march, which takes the body up again whenever the body or
      // its binding changes, and lets it go when the pose does. The unposed march keeps the body's textures meanwhile,
      // so that a pose on and off rebuilds none
      const posing = body?.posed ? body : null
      if (posing || posed) {
        const made = posedOf()
        if (posedBound?.body !== posing || posedBound.channel !== channel) {
          made.sampler.bind(posing, channel)
          made.read.bind(posing)
          posedBound = posing ? { body: posing, channel } : null
          if (posing) made.march.setSpacing(posing.volume.spacing)
        }
      }
      const shown = posing && posed ? posed.material : material
      if (quad.material !== shown) quad.material = shown

      setMarch(march, body, look)
      if (posed) setMarch(posed.march, posing, look)

      // Over, x-ray and MIP lay a premultiplied colour over what's behind, and the glow is added to it whole. three's
      // additive blending would scale the glow by its alpha first, so the factors are given outright
      if (blended !== mode) {
        blended = mode
        material.blendDst = mode === 'glow' ? OneFactor : OneMinusSrcAlphaFactor
        material.needsUpdate = true
      }
      if (posed && posed.material.blendDst !== material.blendDst) {
        posed.material.blendDst = material.blendDst
        posed.material.needsUpdate = true
      }
    },
    // The posed march follows the bones once they've turned since it last did
    beforeFrame() {
      if (posedBound) posed?.march.pose()
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
