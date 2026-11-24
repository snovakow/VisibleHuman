import { Data3DTexture, LinearFilter, NoColorSpace, RedFormat, RGBAFormat, RGFormat, UnsignedByteType } from 'three'
import { fieldBytes, rgbaBytes, type Volume } from '../../volume/format.ts'

// A body's volume as 3D textures, one texel per voxel of the loaded file's grid, read between the texels: the colour
// texture, R, G and B the photographs' sRGB and A the density; the coverage texture, one channel of the file's
// coverage block, whose half-way crossing is the skin; and, for a body with an MRI, the colour texture again with the
// MRI in place of the density, which a style binds instead to read the MRI wherever it reads the density, with no
// change to its shader and no read of a third texture at every step. The fields texture holds the coverage and the
// density together, two bytes a texel, for the trace, which asks both at every step of every ray, so that a step reads
// one texel of two bytes in place of two of five; it has its MRI twin too. The colour is decoded from sRGB in the
// shader after the sampling, so the textures take no colour space, and a ray reads one level, so they take no mipmaps.
// Each is built for the first sampler that asks and shared by the rest, and goes once the last has let go, so a body
// holds on the GPU only what the style drawn reads of it

export type BodyTexture = 'colour' | 'mri' | 'coverage' | 'fields' | 'mriFields'

type Format = typeof RGBAFormat | typeof RGFormat | typeof RedFormat
const bytesPerTexel = (format: Format) => (format === RGBAFormat ? 4 : format === RGFormat ? 2 : 1)

export interface BodyTextures {
  // A texture of the volume, built on the first ask and shared until each asker has released it
  acquire(kind: BodyTexture): Data3DTexture
  // Lets go of a texture, which is disposed of once no one holds it
  release(kind: BodyTexture): void
  // Disposes of whatever is still held, when the body goes
  dispose(): void
}

function settle(texture: Data3DTexture, format: Format) {
  texture.format = format
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

// How each texture is built. The coverage is the file's block itself, one byte a texel; a 3D texture's rows are
// unpacked byte by byte, so a width that isn't a multiple of four needs no padding
const build: Record<BodyTexture, (volume: Volume) => Data3DTexture> = {
  colour: (volume) => settle(new Data3DTexture(rgbaBytes(volume), ...volume.size), RGBAFormat),
  mri: (volume) => settle(new Data3DTexture(rgbaBytes(volume, 'mri'), ...volume.size), RGBAFormat),
  coverage: (volume) => settle(new Data3DTexture(volume.coverage, ...volume.size), RedFormat),
  fields: (volume) => settle(new Data3DTexture(fieldBytes(volume), ...volume.size), RGFormat),
  mriFields: (volume) => settle(new Data3DTexture(fieldBytes(volume, 'mri'), ...volume.size), RGFormat),
}

export function createBodyTextures(volume: Volume): BodyTextures {
  const held = new Map<BodyTexture, { texture: Data3DTexture; users: number }>()
  return {
    acquire(kind) {
      let entry = held.get(kind)
      if (!entry) {
        entry = { texture: build[kind](volume), users: 0 }
        held.set(kind, entry)
      }
      entry.users++
      return entry.texture
    },
    release(kind) {
      const entry = held.get(kind)
      if (!entry) return
      entry.users--
      if (entry.users > 0) return
      entry.texture.dispose()
      held.delete(kind)
    },
    dispose() {
      for (const { texture } of held.values()) texture.dispose()
      held.clear()
    },
  }
}

// A texture of one voxel of nothing, which a sampler reads until a body is bound, so that a material compiles against
// a 3D texture
export function emptyTexture(format: Format) {
  return settle(new Data3DTexture(new Uint8Array(bytesPerTexel(format)), 1, 1, 1), format)
}
