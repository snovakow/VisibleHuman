import { bindSkeleton, type Bound, type Placement } from '../rig/pose.ts'
import type { RigFile } from '../rig/rigFile.ts'
import { createRigSkeleton, type RigSkeleton } from '../rig/skeleton.ts'
import type { Volume } from '../volume/format.ts'
import type { Bounds } from '../volume/levels.ts'
import { createRigTextures, type RigTextures } from './body/rigTextures.ts'

// A body's rig bound for drawing it posed: the rig file, the skeleton bound to where this level of the body is placed
// in the scene, three's bones for it, a key the surface worker knows the rig by, and the rig file's textures for the
// styles that read it point by point. A style that draws a body posed skins it to these bones, whose rotations the
// motion sets frame by frame without the body changing

export interface Posed {
  file: RigFile
  placement: Placement
  bound: Bound
  skeleton: RigSkeleton
  key: string
  // How many times the bones have turned, so a style that keeps something posed can tell it's out of date
  turns: number
  // Built only when a style asks for one, and disposed of by whoever lets the binding go
  textures: RigTextures
}

let bindings = 0

export function bindPosed(volume: Volume, bounds: Bounds, file: RigFile): Posed {
  const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
  const bound = bindSkeleton(file.rig, placement)
  return {
    file,
    placement,
    bound,
    skeleton: createRigSkeleton(bound),
    key: `${volume.body}/${++bindings}`,
    turns: 0,
    textures: createRigTextures(file),
  }
}

// Brings the bones' world matrices and the skeleton's up to date with the rotations the motion has set, the root
// where the scan holds it, since the clips play in place, and counts the turn for the styles that keep something
// posed. It allocates nothing, as it runs every frame a motion plays
export function settlePosed(posed: Posed) {
  const { root, skeleton } = posed.skeleton
  root.position.copy(posed.bound.offsets.hips)
  root.updateMatrixWorld(true)
  skeleton.update()
  posed.turns++
}
