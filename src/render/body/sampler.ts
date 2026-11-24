import { Matrix4, RedFormat, RGBAFormat, SRGBColorSpace, Vector3 } from 'three'
import { colorSpaceToWorking, float, texture3D, uniform, vec4 } from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import { sceneToTexture } from '../rays.ts'
import type { Body } from './body.ts'
import { emptyTexture, type BodyTexture } from './textures.ts'

// What a style's shaders read of the body: its colour, its density and its coverage at a point in the scene, from the
// body's 3D textures, mapped from the scene by the volume's axes and centred on the body's bounds. Every style that
// reads the textures reads them through one of these, so each is written against the same few nodes, and binding a
// body swaps the textures and the mapping under a shader without compiling it again

// What the colour texture's fourth channel holds: the file's density, or the MRI in its place
export type Channel = 'density' | 'mri'

export interface BodySampler {
  // The colour texture's texel at a scene point: R, G and B the photographs' sRGB and A the fourth channel, the
  // density from 0 to 1 of the file's scale, or the MRI where the sampler is bound to it
  texelAt(p: Node<'vec3'>): Node<'vec4'>
  // A texel's colour, decoded from the photographs' sRGB to the linear colour the renderer works in
  colourOf(texel: Node<'vec4'>): Node<'vec3'>
  // The coverage at a scene point, from 0 to 1, which crosses the skin's isolevel where the skin lies. Only a sampler
  // made to read the coverage has it
  coverageAt(p: Node<'vec3'>): Node<'float'>
  // A voxel's size along the scene's x, y and z, in millimetres
  voxel: UniformNode<'vec3'>
  // The smallest of the three, which the styles size their steps and their reads by
  leastVoxel: UniformNode<'float'>
  // Reads a body, with the fourth channel named, or nothing while there's no body. The textures stay the body's; the
  // sampler holds each only while it's bound to it
  bind(body: Body | null, channel?: Channel): void
  // Lets go of the body's textures and of the one-voxel textures the sampler reads without a body
  dispose(): void
}

const colourTexture: Record<Channel, BodyTexture> = { density: 'colour', mri: 'mri' }

export function createBodySampler(reads: { coverage: boolean }): BodySampler {
  const emptyColour = emptyTexture(RGBAFormat)
  const emptyCoverage = emptyTexture(RedFormat)
  const colour = texture3D(emptyColour)
  const coverage = texture3D(emptyCoverage)
  // From a point in the scene to the texture's coordinates, by the volume's axes
  const toTexture = uniform(new Matrix4())
  const voxel = uniform(new Vector3(1, 1, 1))
  const leastVoxel = uniform(1)
  const uvwOf = (p: Node<'vec3'>) => toTexture.mul(vec4(p, 1)).xyz

  // The body bound and its textures held, so that each is released as it was acquired
  let bound: { body: Body; kinds: BodyTexture[] } | null = null
  const unbind = () => {
    if (!bound) return
    for (const kind of bound.kinds) bound.body.textures.release(kind)
    bound = null
  }

  return {
    // The textures have one level, which is named so that the reads need no screen derivatives, which WGSL allows
    // only where every pixel takes the same path, and a ray that has stopped doesn't
    texelAt: (p) => colour.sample(uvwOf(p)).level(float(0)),
    colourOf: (texel) => colorSpaceToWorking(vec4(texel.rgb, 1), SRGBColorSpace).rgb,
    coverageAt: (p) => coverage.sample(uvwOf(p)).level(float(0)).r,
    voxel,
    leastVoxel,
    bind(body, channel = 'density') {
      const kinds: BodyTexture[] = body ? [colourTexture[channel], ...(reads.coverage ? (['coverage'] as const) : [])] : []
      // The new textures are taken before the old are let go, so one that both bindings read is never rebuilt
      const textures = kinds.map((kind) => body?.textures.acquire(kind))
      unbind()
      colour.value = textures[0] ?? emptyColour
      coverage.value = textures[1] ?? emptyCoverage
      if (!body) return
      bound = { body, kinds }
      const { volume, bounds } = body
      toTexture.value.copy(sceneToTexture(volume, bounds.center))
      const { x, y, z } = volume.axes
      voxel.value.set(volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source])
      leastVoxel.value = Math.min(...volume.spacing)
    },
    dispose() {
      unbind()
      emptyColour.dispose()
      emptyCoverage.dispose()
    },
  }
}
