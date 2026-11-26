import type { Quaternion } from 'three'
import { bindSkeleton, type Bound, type Placement, type Pose } from '../rig/pose.ts'
import type { JointName } from '../rig/rig.ts'
import type { RigFile } from '../rig/rigFile.ts'
import { applyPose, createRigSkeleton, type RigSkeleton } from '../rig/skeleton.ts'
import type { Volume } from '../volume/format.ts'
import type { Bounds } from '../volume/levels.ts'

// A body's rig bound for drawing it posed: the rig file, the skeleton bound to where this level of the body is placed
// in the scene, three's bones for it, and a key the surface worker knows the rig by. A style that draws a body posed
// skins it to these bones, whose rotations the pose sets frame by frame without the body changing

export interface Posed {
  file: RigFile
  placement: Placement
  bound: Bound
  skeleton: RigSkeleton
  key: string
  // How many times the bones have turned, so a style that keeps something posed can tell it's out of date
  turns: number
}

let bindings = 0

export function bindPosed(volume: Volume, bounds: Bounds, file: RigFile): Posed {
  const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
  const bound = bindSkeleton(file.rig, placement)
  return { file, placement, bound, skeleton: createRigSkeleton(bound), key: `${volume.body}/${++bindings}`, turns: 0 }
}

// Turns the bones to a pose's rotations, the root where the scan holds it
export function posePosed(posed: Posed, rotations: Record<JointName, Quaternion>) {
  const pose: Pose = { rotations, root: posed.bound.offsets.hips }
  applyPose(posed.skeleton, pose)
  posed.turns++
}
