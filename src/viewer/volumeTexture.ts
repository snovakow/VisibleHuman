import { Data3DTexture, LinearFilter, NoColorSpace, RedFormat, RGBAFormat, UnsignedByteType } from 'three'
import { rgbaBytes, type Volume } from '../volume/format.ts'

// The body as 3D textures the quad styles sample, one texel per voxel of the loaded file's grid, read between the
// texels: the colour texture, R, G and B the photographs' sRGB and A the density; the coverage texture, one
// channel of the file's coverage block, whose half-way crossing is the skin; and, for a body with an MRI, the colour
// texture again with the MRI in place of the density, which a style binds instead to read the MRI wherever it reads
// the density, with no change to its shader and no read of a third texture at every step. The colour is decoded from sRGB in the
// shader after the sampling, so the textures take no colour space, and a ray reads one level, so they take no mipmaps.
// Each texture serves every style that reads the same volume: the first to ask builds it, and the last to let go
// disposes of it, each from the effect that owns its use, so that it goes both when the volume changes and when the
// Canvas remounts

interface Shared {
  texture: Data3DTexture
  users: number
}

// A kind of texture held per volume, with how it's built
interface Kind {
  held: WeakMap<Volume, Shared>
  create(volume: Volume): Data3DTexture
}

function settle(texture: Data3DTexture) {
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

const colour: Kind = {
  held: new WeakMap(),
  create(volume) {
    const [nx, ny, nz] = volume.size
    const texture = new Data3DTexture(rgbaBytes(volume), nx, ny, nz)
    texture.format = RGBAFormat
    return settle(texture)
  },
}

// The coverage block itself, one byte a texel; a 3D texture's rows are unpacked byte by byte, so a width that isn't a
// multiple of four needs no padding
const coverage: Kind = {
  held: new WeakMap(),
  create(volume) {
    const [nx, ny, nz] = volume.size
    const texture = new Data3DTexture(volume.coverage, nx, ny, nz)
    texture.format = RedFormat
    return settle(texture)
  },
}

// The colour with the MRI block as its fourth channel, for a volume that has one
const mri: Kind = {
  held: new WeakMap(),
  create(volume) {
    const [nx, ny, nz] = volume.size
    const texture = new Data3DTexture(rgbaBytes(volume, 'mri'), nx, ny, nz)
    texture.format = RGBAFormat
    return settle(texture)
  },
}

// A kind's texture of the volume, built on the first call for the volume and shared by the rest until each has
// released it
function acquire(kind: Kind, volume: Volume): Data3DTexture {
  let entry = kind.held.get(volume)
  if (!entry) {
    entry = { texture: kind.create(volume), users: 0 }
    kind.held.set(volume, entry)
  }
  entry.users++
  return entry.texture
}

// Lets go of a kind's texture of the volume, disposing of it once no one holds it
function release(kind: Kind, volume: Volume) {
  const entry = kind.held.get(volume)
  if (!entry) return
  entry.users--
  if (entry.users > 0) return
  entry.texture.dispose()
  kind.held.delete(volume)
}

export const acquireVolumeTexture = (volume: Volume) => acquire(colour, volume)
export const releaseVolumeTexture = (volume: Volume) => release(colour, volume)
export const acquireCoverageTexture = (volume: Volume) => acquire(coverage, volume)
export const releaseCoverageTexture = (volume: Volume) => release(coverage, volume)
export const acquireMriTexture = (volume: Volume) => acquire(mri, volume)
export const releaseMriTexture = (volume: Volume) => release(mri, volume)
