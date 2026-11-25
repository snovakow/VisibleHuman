import type { RigFile } from '../../rig/rigFile.ts'
import type { Volume } from '../../volume/format.ts'
import type { Bounds, Levels } from '../../volume/levels.ts'
import type { Posed } from '../posed.ts'
import type { BodyTextures } from './textures.ts'

// A body as the styles draw it: the level's volume, the body's bounds in it, its splat levels as built so far, which
// grow after the body first draws, the volume's textures, and, while it's posed, its rig bound for drawing. A new
// volume makes a new body; more levels of the same volume make one that shares its textures; posing it or letting it
// go makes another, while a new pose only turns the bones the styles read
export interface Body extends BodySource {
  textures: BodyTextures
  posed: Posed | null
}

// What the stage makes a body from, as the page holds it: the volume, its bounds and its levels, and its rig file
// once it's loaded, which a body with no limbs never has
export interface BodySource {
  volume: Volume
  bounds: Bounds
  levels: Levels
  rig: RigFile | null
}
