import { Data3DTexture, LinearFilter, Matrix4, NoColorSpace, RedFormat, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { abs, colorSpaceToWorking, dot, normalize, normalView, positionView, pow, texture3D, uniform, vec4 } from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import type { Triple } from '../volume/format.ts'
import { sceneToTexture, type Mapped } from './rays.ts'

// What the surface style's materials read of the body: its colour, its density and its coverage at a point in the
// scene, from the 3D textures the quad styles sample too, mapped from the scene by the volume's axes and centred on
// the body's bounds; and the rim, a light along a surface's edges where it turns away from the eye

// How sharply Rim's light is confined to a surface's edge
const rimPower = 3

export interface BodySampler {
  // The colour of the tissue at a scene point, decoded from the photographs' sRGB
  colourAt(p: Node<'vec3'>): Node<'vec3'>
  // The density at a scene point, from 0 to 1 of the file's scale; or the MRI there, where the colour texture shown
  // is the one that carries the MRI in the density's place
  densityAt(p: Node<'vec3'>): Node<'float'>
  // The coverage at a scene point, from 0 to 1, which crosses the skin's isolevel where the skin mesh lies
  coverageAt(p: Node<'vec3'>): Node<'float'>
  // Half the smallest voxel spacing, in millimetres: how far inside a surface its colour is read
  halfVoxel: UniformNode<'float'>
  // Reads a volume's colour and coverage textures. The textures stay their owner's, who releases them; the sampler
  // only reads them
  show(colour: Data3DTexture, coverage: Data3DTexture, volume: Mapped, center: Triple): void
  // Lets go of what the sampler owns: the one-voxel textures it reads until a volume is shown
  dispose(): void
}

// A texture of one voxel of nothing, read until a volume is shown, so that a material compiles against a 3D texture
function emptyTexture(format: typeof RGBAFormat | typeof RedFormat, channels: number) {
  const texture = new Data3DTexture(new Uint8Array(channels), 1, 1, 1)
  texture.format = format
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

export function createBodySampler(): BodySampler {
  const emptyColour = emptyTexture(RGBAFormat, 4)
  const emptyCoverage = emptyTexture(RedFormat, 1)
  const body = texture3D(emptyColour)
  const skin = texture3D(emptyCoverage)
  // From a point in the scene to the texture's coordinates, by the volume's axes
  const toTexture = uniform(new Matrix4())
  const halfVoxel = uniform(1)
  const uvwOf = (p: Node<'vec3'>) => toTexture.mul(vec4(p, 1)).xyz
  const texelAt = (p: Node<'vec3'>) => body.sample(uvwOf(p))
  return {
    colourAt: (p) => colorSpaceToWorking(vec4(texelAt(p).rgb, 1), SRGBColorSpace).rgb,
    densityAt: (p) => texelAt(p).a,
    coverageAt: (p) => skin.sample(uvwOf(p)).r,
    halfVoxel,
    show(colour, coverage, volume, center) {
      body.value = colour
      skin.value = coverage
      toTexture.value.copy(sceneToTexture(volume, center))
      halfVoxel.value = Math.min(...volume.spacing) / 2
    },
    dispose() {
      emptyColour.dispose()
      emptyCoverage.dispose()
    },
  }
}

// How much a surface's edge lights up at a fragment: Rim's strength where the surface turns right away from the eye,
// falling off sharply toward where it faces the eye. The normal faces the eye on both sides of a surface, so the far
// side of a shell has its rim too
export function rimAt(rim: Node<'float'>): Node<'float'> {
  const facing = abs(dot(normalView, normalize(positionView).negate()))
  return pow(facing.oneMinus(), rimPower).mul(rim)
}
