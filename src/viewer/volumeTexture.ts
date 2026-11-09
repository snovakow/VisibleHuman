import { Data3DTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three'
import { rgbaBytes, type Volume } from '../volume/format.ts'

// The body as a 3D texture the quad styles sample: R, G and B the photographs' sRGB and A the density, one texel per
// voxel of the loaded file's grid, read between the texels. The colour is decoded from sRGB in the shader after the
// sampling, so the texture takes no colour space, and a ray march reads one level, so it takes no mipmaps.
// One texture serves every style that reads the same volume: the first to ask builds it, and the last to let go
// disposes of it, each from the effect that owns its use, so that it goes both when the volume changes and when the
// Canvas remounts

interface Shared {
  texture: Data3DTexture
  users: number
}

const shared = new WeakMap<Volume, Shared>()

function createVolumeTexture(volume: Volume) {
  const [nx, ny, nz] = volume.size
  const texture = new Data3DTexture(rgbaBytes(volume), nx, ny, nz)
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

// The volume's texture, built on the first call for the volume and shared by the rest until each has released it
export function acquireVolumeTexture(volume: Volume): Data3DTexture {
  let entry = shared.get(volume)
  if (!entry) {
    entry = { texture: createVolumeTexture(volume), users: 0 }
    shared.set(volume, entry)
  }
  entry.users++
  return entry.texture
}

// Lets go of the volume's texture, disposing of it once no one holds it
export function releaseVolumeTexture(volume: Volume) {
  const entry = shared.get(volume)
  if (!entry) return
  entry.users--
  if (entry.users > 0) return
  entry.texture.dispose()
  shared.delete(volume)
}
