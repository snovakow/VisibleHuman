import { Bone, Skeleton, Vector3 } from 'three'
import { byJoint, jointNames, skeletonShape, type JointName } from './rig.ts'
import type { Bound, Pose } from './pose.ts'

// The rig's skeleton as three's bones, for three's skinning: each bone at its joint's neutral offset from its parent,
// turned by its rotation, its inverse bind matrix the bind pose's, the scan's, so that a mesh skinned to it is drawn as
// scanned until the bones turn. The bones are never added to a scene: whoever poses them brings their world matrices
// up to date, and the skeleton's matrices with them, before a frame draws

export interface RigSkeleton {
  skeleton: Skeleton
  bones: Record<JointName, Bone>
  root: Bone
}

export function createRigSkeleton(bound: Bound): RigSkeleton {
  const bones = byJoint((name) => {
    const bone = new Bone()
    bone.name = name
    bone.position.copy(bound.offsets[name])
    bone.quaternion.copy(bound.scan[name])
    return bone
  })
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    if (parent) bones[parent].add(bones[name])
  }
  const ordered = jointNames.map((name) => bones[name])
  const skeleton = new Skeleton(
    ordered,
    jointNames.map((name) => bound.bindInverse[name].clone()),
  )
  return { skeleton, bones, root: bones.hips }
}

// Puts a skeleton in a pose: each bone turned as the pose says, the root where it stands, and every matrix brought up
// to date
export function applyPose(rig: RigSkeleton, pose: Pose) {
  for (const name of jointNames) rig.bones[name].quaternion.copy(pose.rotations[name])
  rig.root.position.copy(pose.root)
  rig.root.updateMatrixWorld(true)
  rig.skeleton.update()
}

// Each joint's place in the scene as the skeleton stands, for drawing it
export function jointPlaces(rig: RigSkeleton): Record<JointName, Vector3> {
  return byJoint((name) => new Vector3().setFromMatrixPosition(rig.bones[name].matrixWorld))
}
