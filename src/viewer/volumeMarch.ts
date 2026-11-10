import { Data3DTexture, LinearFilter, Matrix4, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector3 } from 'three'
import {
  Break,
  clamp,
  colorSpaceToWorking,
  dot,
  exp,
  float,
  hash,
  If,
  length,
  Loop,
  max,
  min,
  mix,
  round,
  screenCoordinate,
  select,
  smoothstep,
  texture3D,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import type { DensitySource, VolumeMode } from '../options.ts'
import {
  fatDensity,
  muscleDensity,
  paleFrom,
  paleTo,
  unsaturatedFrom,
  unsaturatedTo,
  whiteDensity,
  xrayFloor,
} from '../volume/density.ts'
import type { Triple } from '../volume/format.ts'
import { darkMax } from '../volume/segment.ts'
import { rayQuad } from './rayQuad.ts'
import { sceneToTexture, type Mapped } from './rays.ts'
import { cueAlongRay } from './shading.ts'

// The volume march: each pixel's ray, from the quad, clipped to the box the cuts leave, is walked in steps from the
// front, and at each step the body's 3D texture is read where the ray is, its colour and its density. What the pixel
// shows of what the ray met is the mode's: laid over step by step until the light is spent, the light an x-ray would
// leave, the most density met, or light the body gives off. Each step counts for less the farther it lies, by the
// depth cue. PDBSplat's field march is the model, with the ray from the quad rather than a box's back face, a step per
// axis spacing rather than one, and the colour from the texture itself

// The light a unit of windowed density takes per millimetre at Opacity 1, chosen by eye on the male: soft tissue,
// which sits about a quarter of the way up the density scale, closes over within a few voxels, so the skin reads as a
// surface at full Opacity and the body as a translucent whole below it
const extinction = 1
// How much of the light an x-ray loses per millimetre of density at the top of the scale, chosen so that the pelvis
// and the femurs come near white and the soft tissue, which the ray crosses far more of, stays a grey behind them
const xrayExtinction = 0.05
// What a millimetre of windowed density adds to the glow, chosen so that the torso's thickness sums to about one
const glowGain = 0.035
// The x-ray's and the maximum's colour, a cold white like film on a light box
const tint = new Vector3(0.85, 0.92, 1)
// The ray stops once this little of the light would still get through
const minTransmittance = 0.01
// The hash of a pixel's place takes its row as this many pixels, more than a 4K screen is wide
const screenHashRow = 4096
// The window's ends are kept at least this far apart, since a step function would be undefined where they met
const leastWindow = 1e-3
// Shading: what the light leaves in the shade, and how steep a density slope, per voxel, counts as a full surface.
// Where the slope is slighter the shade fades toward flat, so the inside of even tissue isn't lit by noise
const shadeAmbient = 0.35
const fullSlopePerVoxel = 0.15

// The modes and the density sources as the shader's integers
const modeIndex: Record<VolumeMode, number> = { over: 0, xray: 1, mip: 2, glow: 3 }
// The MRI is read as the file's density is, from the texture's fourth channel, which holds the MRI then
const sourceIndex: Record<DensitySource, number> = { ct: 0, colour: 1, mri: 0 }

// The density byte a colour reads as, as src/volume/density.ts reads it on the CPU for the file's stand-in where the
// CT doesn't reach, from the same thresholds: pale and unsaturated is bone, red is muscle, yellow is fat, and a dark
// colour fades to the black of 1. Written for r, g and b from 0 to 255
function densityFromColor(r: Node<'float'>, g: Node<'float'>, b: Node<'float'>): Node<'float'> {
  const brightest = max(max(r, g), b)
  const darkest = min(min(r, g), b)
  const luminance = r.mul(0.299).add(g.mul(0.587)).add(b.mul(0.114)).div(255)
  const saturation = select(brightest.equal(0), float(0), brightest.sub(darkest).div(brightest))
  // How red the colour is rather than yellow, with a grey halfway; the division is guarded where r equals b, which
  // the test on r excludes but the GPU evaluates all the same
  const redness = select(r.greaterThan(b), r.sub(g).div(max(r.sub(b), 1e-6)), float(0.5))
  const soft = mix(float(fatDensity), float(muscleDensity), clamp(redness, 0, 1))
  const pale = clamp(luminance.sub(paleFrom).div(paleTo - paleFrom), 0, 1)
  const unsaturated = clamp(float(unsaturatedFrom).sub(saturation).div(unsaturatedFrom - unsaturatedTo), 0, 1)
  const density = mix(soft, float(whiteDensity), pale.mul(unsaturated))
  const dark = clamp(brightest.div(darkMax), 0, 1)
  return clamp(round(density.sub(1).mul(dark).add(1)), 1, 255)
}

export interface VolumeMarch {
  // The quad's colour: what the ray through each pixel gathered, premultiplied, with how much of what's behind it
  // covers as its alpha. The glow is added rather than laid over, so its alpha is its brightest channel, which keeps
  // the colour no brighter than the alpha, as a premultiplied canvas expects
  colorNode: Node<'vec4'>
  // The box the cuts leave, in the scene's millimetres, which clips every ray
  cutMin: UniformNode<'vec3'>
  cutMax: UniformNode<'vec3'>
  mode: UniformNode<'int'>
  densitySource: UniformNode<'int'>
  opacity: UniformNode<'float'>
  windowLow: UniformNode<'float'>
  windowHigh: UniformNode<'float'>
  shading: UniformNode<'bool'>
  // Draws the steps in grey by the density's share of the window, in place of the photographs' colour, and the x-ray
  // and the maximum in white
  grey: UniformNode<'bool'>
  // Reads a volume's texture, mapped from the scene by the volume's axes and centred on the body's bounds. The texture
  // stays its owner's, who releases it; the march only reads it
  show(texture: Data3DTexture, volume: Mapped, center: Triple): void
  // The box the cuts leave, in the scene's millimetres, which clips every ray and bounds the steps one can take
  setCuts(min: Triple, max: Triple): void
  // The step, as a share of the smallest voxel spacing
  setStep(voxelShare: number): void
  // Lets go of what the march owns: the one-voxel texture it reads until a volume is shown
  dispose(): void
}

// A texture of one voxel of nothing, read until a volume is shown, so that the material compiles against a 3D texture
function emptyTexture() {
  const texture = new Data3DTexture(new Uint8Array(4), 1, 1, 1)
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

export function volumeMarch(): VolumeMarch {
  const empty = emptyTexture()
  const body = texture3D(empty)
  // From a point in the scene to the texture's coordinates, by the volume's axes
  const toTexture = uniform(new Matrix4())
  // A voxel's size along the scene's x, y and z, in millimetres, for the shading's differences
  const voxel = uniform(new Vector3(1, 1, 1))
  const cutMin = uniform(new Vector3())
  const cutMax = uniform(new Vector3())
  const mode = uniform(modeIndex.over, 'int')
  const densitySource = uniform(sourceIndex.ct, 'int')
  const opacity = uniform(1)
  const windowLow = uniform(0)
  const windowHigh = uniform(1)
  const shading = uniform(false)
  const grey = uniform(false)
  const stepLength = uniform(1)
  // The most steps a ray through the cut box can take: its diagonal in steps, and one more for the first step's offset
  const maxSteps = uniform(1, 'int')
  const tintNode = uniform(tint)

  // What the step and its count are sized from: the spacing shown, the step's share of it and the cut box
  let spacing: Triple = [1, 1, 1]
  let voxelShare = 1
  let box: { min: Triple; max: Triple } = { min: [0, 0, 0], max: [0, 0, 0] }

  // The density where the ray is, from 0 to 1, from the texel there: the file's, or the colour's reading, which goes
  // to 0 outside the body as the file's does
  const densityAt = (texel: Node<'vec4'>): Node<'float'> => {
    const rgb = texel.rgb.mul(255)
    const inside = clamp(texel.a.mul(255), 0, 1)
    const fromColor = densityFromColor(rgb.r, rgb.g, rgb.b).div(255).mul(inside)
    return select(densitySource.equal(sourceIndex.ct), texel.a, fromColor)
  }
  const densityAtPoint = (p: Node<'vec3'>): Node<'float'> =>
    densityAt(body.sample(toTexture.mul(vec4(p, 1)).xyz).level(float(0)))
  // The window's share of a density: clear below the low end, full above the high end
  const windowed = (density: Node<'float'>) => smoothstep(windowLow, windowHigh, density)
  // A step's colour: the voxel's, decoded from the photographs' sRGB, or in grey its density's share of the window,
  // so that the window sets the grey's black and white as a scan viewer's window and level do. The choice is a
  // branch on the switch's uniform, which every pixel takes the same way
  const stepColor = (texel: Node<'vec4'>, density: Node<'float'>): Node<'vec3'> =>
    select(grey, vec3(windowed(density)), colorSpaceToWorking(vec4(texel.rgb, 1), SRGBColorSpace).rgb)
  // The x-ray's and the maximum's colour: the film's cold white, or white in grey
  const shownTint = select(grey, vec3(1), tintNode)

  const colorNode = rayQuad(cutMin, cutMax, ({ origin, direction, viewDir, tEnter, tExit }) => {
    // The first step is offset by a share of a step from a hash of the pixel's place, which trades the bands that
    // equal steps draw for fine noise
    const offset = hash(screenCoordinate.y.mul(screenHashRow).add(screenCoordinate.x))
    const t = tEnter.add(stepLength.mul(offset)).toVar()
    const end = tExit.toVar()
    const gathered = vec3(0).toVar()
    const transmittance = float(1).toVar()
    const most = float(0).toVar()
    // The light comes from the camera, so a slope facing the camera is lit
    const toCamera = direction.negate().toVar()
    // The depth cue at a distance along the ray, from how much view depth a millimetre of the ray covers
    const cueAtDistance = cueAlongRay(viewDir.z.negate())

    Loop(maxSteps, () => {
      If(t.greaterThan(end).or(transmittance.lessThan(minTransmittance)), () => {
        Break()
      })
      // The texture has one level, which is named so that the read needs no screen derivatives, which WGSL allows
      // only where every pixel takes the same path, and a ray that has stopped doesn't
      const p = origin.add(direction.mul(t)).toVar()
      const texel = body.sample(toTexture.mul(vec4(p, 1)).xyz).level(float(0)).toVar()
      const density = densityAt(texel).toVar()
      // What the depth cue leaves of the step: of its colour where it has one, of what it takes from an x-ray, and of
      // its density toward the maximum, so that in every mode the far side shows less
      const cue = cueAtDistance(t)

      If(mode.equal(modeIndex.over), () => {
        // What the step covers of the light still coming through, in the step's colour, shaded where asked by the
        // density's slope there
        const sigma = opacity.mul(windowed(density)).mul(extinction)
        const alpha = exp(sigma.mul(stepLength).negate()).oneMinus().toVar()
        If(alpha.greaterThan(0), () => {
          const color = stepColor(texel, density).toVar()
          If(shading, () => {
            const dx = vec3(voxel.x, 0, 0)
            const dy = vec3(0, voxel.y, 0)
            const dz = vec3(0, 0, voxel.z)
            const gradient = vec3(
              densityAtPoint(p.add(dx)).sub(densityAtPoint(p.sub(dx))),
              densityAtPoint(p.add(dy)).sub(densityAtPoint(p.sub(dy))),
              densityAtPoint(p.add(dz)).sub(densityAtPoint(p.sub(dz))),
            ).toVar()
            // The slope per voxel, over the two voxels the differences span; the density falls toward the surface, so
            // the surface's normal is the slope's opposite. Where the six reads agree there's no slope, and the
            // division is guarded, since normalizing a zero vector gives a NaN that some GPUs carry into the pixel;
            // the shade is flat there either way
            const change = length(gradient).toVar()
            const slope = change.mul(0.5)
            const normal = gradient.negate().div(max(change, 1e-6))
            const lit = mix(float(shadeAmbient), float(1), max(dot(normal, toCamera), 0))
            color.mulAssign(mix(float(1), lit, clamp(slope.div(fullSlopePerVoxel), 0, 1)))
          })
          gathered.addAssign(color.mul(cue).mul(alpha.mul(transmittance)))
          transmittance.mulAssign(alpha.oneMinus())
        })
      })
        .ElseIf(mode.equal(modeIndex.xray), () => {
          // Beer–Lambert on the density above the x-ray's floor, scaled to the top of the scale
          const above = max(density.sub(xrayFloor / 255), 0).div(1 - xrayFloor / 255)
          const mu = above.mul(opacity).mul(xrayExtinction).mul(cue)
          transmittance.mulAssign(exp(mu.mul(stepLength).negate()))
        })
        .ElseIf(mode.equal(modeIndex.mip), () => {
          most.assign(max(most, windowed(density).mul(cue)))
        })
        .Else(() => {
          const color = stepColor(texel, density)
          gathered.addAssign(color.mul(cue).mul(windowed(density).mul(stepLength).mul(opacity).mul(glowGain)))
        })
      t.addAssign(stepLength)
    })

    const covered = transmittance.oneMinus()
    const result = vec4(gathered, covered).toVar()
    // The x-ray is the negative of what got through, the maximum is itself, faded by Opacity as the other modes are,
    // and the glow is its own light; the over's colour is already premultiplied by what it covered
    If(mode.equal(modeIndex.xray), () => {
      result.assign(vec4(shownTint.mul(covered), covered))
    })
      .ElseIf(mode.equal(modeIndex.mip), () => {
        const shown = most.mul(opacity)
        result.assign(vec4(shownTint.mul(shown), shown))
      })
      .ElseIf(mode.equal(modeIndex.glow), () => {
        result.assign(vec4(gathered, clamp(max(max(gathered.r, gathered.g), gathered.b), 0, 1)))
      })
    return result
  })

  // The step and the most steps follow the voxel spacing, the step's share and the cut box as they stand: the
  // diagonal of the box in steps, and one more for the first step's offset
  const fit = () => {
    stepLength.value = Math.min(...spacing) * voxelShare
    const diagonal = Math.hypot(...box.max.map((high, axis) => high - box.min[axis]))
    maxSteps.value = Math.ceil(diagonal / stepLength.value) + 1
  }

  return {
    colorNode,
    cutMin,
    cutMax,
    mode,
    densitySource,
    opacity,
    windowLow,
    windowHigh,
    shading,
    grey,
    show(texture, volume, center) {
      body.value = texture
      toTexture.value.copy(sceneToTexture(volume, center))
      spacing = volume.spacing
      const { x, y, z } = volume.axes
      voxel.value.set(volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source])
      fit()
    },
    setCuts(low, high) {
      box = { min: low, max: high }
      cutMin.value.fromArray(low)
      cutMax.value.fromArray(high)
      fit()
    },
    setStep(share) {
      voxelShare = share
      fit()
    },
    dispose() {
      empty.dispose()
    },
  }
}

// The window's ends as the march takes them, the high end kept above the low
export function windowEnds(low: number, high: number): [number, number] {
  return [low, Math.max(high, low + leastWindow)]
}

export { modeIndex, sourceIndex }
