import type { Volume } from '../../volume/format.ts'
import type { Bounds, Levels } from '../../volume/levels.ts'
import type { BodyTextures } from './textures.ts'

// A body as the styles draw it: the level's volume, the body's bounds in it, its splat levels as built so far, which
// grow after the body first draws, and the volume's textures. A new volume makes a new body; more levels of the same
// volume make one that shares its textures
export interface Body {
  volume: Volume
  bounds: Bounds
  levels: Levels
  textures: BodyTextures
}

// What the stage makes a body from: the volume, its bounds and its levels, as the page holds them
export type BodySource = Omit<Body, 'textures'>
