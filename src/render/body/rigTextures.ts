import { Data3DTexture, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three'
import { ownerBytes } from '../../rig/owners.ts'
import type { RigFile } from '../../rig/rigFile.ts'

// A posed body's rig file as 3D textures on the file's own grid, the default level's, one texel a cell, for the styles
// that read the body point by point: the owners texture, each cell's owner byte, the joint it moves with and its chain
// (src/rig/owners.ts). A cell names its own joints, so a value between two cells means nothing: the textures are
// fetched texel by texel, never filtered, and are set to the nearest texel so that no backend blends them. Like the
// body's textures, each is built for the first style that asks and goes once the last has let go, so a posed body holds
// it on the GPU only while a style that reads it is drawn

export type RigTexture = 'owners'

export interface RigTextures {
  // A texture of the rig file, built on the first ask and shared until each asker has released it
  acquire(kind: RigTexture): Data3DTexture
  // Lets go of a texture, which is disposed of once no one holds it
  release(kind: RigTexture): void
  // Disposes of whatever is still held, when the binding goes
  dispose(): void
}

const build: Record<RigTexture, (file: RigFile) => Data3DTexture> = {
  owners: (file) => {
    const texture = new Data3DTexture(ownerBytes(file.cells), ...file.size)
    texture.format = RedFormat
    texture.type = UnsignedByteType
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = NoColorSpace
    texture.needsUpdate = true
    return texture
  },
}

export function createRigTextures(file: RigFile): RigTextures {
  const held = new Map<RigTexture, { texture: Data3DTexture; users: number }>()
  return {
    acquire(kind) {
      let entry = held.get(kind)
      if (!entry) {
        entry = { texture: build[kind](file), users: 0 }
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
