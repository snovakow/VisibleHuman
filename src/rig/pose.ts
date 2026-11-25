import { Matrix4, Quaternion, Vector3 } from 'three'
import type { SceneAxes, Triple } from '../volume/format.ts'
import { byJoint, jointNames, scanFrames, sceneDirection, scenePoint, skeletonShape, type JointName, type Rig } from './rig.ts'

// The skeleton bound to a body as drawn at a level, and its poses, in the scene's millimetres. A joint sits at its
// neutral offset from its parent, the scan's offset turned back by the parent's frame there, so that in the neutral
// pose, every rotation none, the limbs hang and the feet point forward; the scan's pose turns each joint by its frame
// from its parent's, which puts every joint back where it was measured. That pose is the skeleton's bind pose: a body
// skinned to it is drawn as scanned. A pose is each joint's rotation from the neutral pose, in its parent's frame, and
// where the root stands. Plain arithmetic over three's math, with no scene graph, so the app's skeleton, the shaders'
// matrices and the tests' reference all come from here

export interface Bound {
  // Each joint's offset from its parent in the neutral pose, in the parent's frame; the root's is its place
  offsets: Record<JointName, Vector3>
  // Each joint's rotation in the scan's pose, the bind pose
  scan: Record<JointName, Quaternion>
  // Each joint's world matrix in the bind pose, and its inverse
  bindWorld: Record<JointName, Matrix4>
  bindInverse: Record<JointName, Matrix4>
}

export interface Pose {
  rotations: Record<JointName, Quaternion>
  // Where the root stands, in the scene
  root: Vector3
}

// The level a body is drawn at, as the scene places it: its axes, the source frame's place of its voxel (0, 0, 0)
// and the centre of the body's bounds, which every style subtracts
export interface Placement {
  axes: SceneAxes
  origin: Triple
  center: Triple
}

export function bindSkeleton(rig: Rig, placement: Placement): Bound {
  const frames = scanFrames(rig, placement.axes)
  const offsets = byJoint((name) => {
    const { parent } = skeletonShape[name]
    if (!parent) return scenePoint(placement, placement.center, rig.joints[name].at)
    const from = rig.joints[parent].at
    const to = rig.joints[name].at
    return sceneDirection(placement.axes, [to[0] - from[0], to[1] - from[1], to[2] - from[2]]).applyQuaternion(frames[parent].clone().invert())
  })
  const scan = byJoint((name) => {
    const { parent } = skeletonShape[name]
    return parent ? frames[parent].clone().invert().multiply(frames[name]) : frames[name].clone()
  })
  const partial: Pick<Bound, 'offsets' | 'scan'> = { offsets, scan }
  const bindWorld = worldMatrices(partial, { rotations: scan, root: offsets.hips.clone() })
  const bindInverse = byJoint((name) => bindWorld[name].clone().invert())
  return { offsets, scan, bindWorld, bindInverse }
}

// Each joint's rotation in the scan's pose, which needs only the rig and the volume's axes, not where a level places it
export function scanRotations(rig: Rig, axes: SceneAxes): Record<JointName, Quaternion> {
  const frames = scanFrames(rig, axes)
  return byJoint((name) => {
    const { parent } = skeletonShape[name]
    return parent ? frames[parent].clone().invert().multiply(frames[name]) : frames[name].clone()
  })
}

// The scan's pose, the bind pose, and the neutral pose, every rotation none, each with the root where the scan has it
export const scanPose = (bound: Bound): Pose => ({ rotations: byJoint((name) => bound.scan[name].clone()), root: bound.offsets.hips.clone() })
export const neutralPose = (bound: Bound): Pose => ({ rotations: byJoint(() => new Quaternion()), root: bound.offsets.hips.clone() })

// Each joint's world matrix in a pose: its parent's, then its offset, then its rotation
export function worldMatrices(bound: Pick<Bound, 'offsets'>, pose: Pose): Record<JointName, Matrix4> {
  const world = byJoint(() => new Matrix4())
  const unit = new Vector3(1, 1, 1)
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    const local = new Matrix4().compose(parent ? bound.offsets[name] : pose.root, pose.rotations[name], unit)
    world[name] = parent ? world[parent].clone().multiply(local) : local
  }
  return world
}

// Each joint's skinning matrix in a pose: what takes a point of the scan, where the bind pose holds it, to where the
// pose moves it with that joint
export function skinningMatrices(bound: Bound, pose: Pose): Record<JointName, Matrix4> {
  const world = worldMatrices(bound, pose)
  return byJoint((name) => world[name].clone().multiply(bound.bindInverse[name]))
}

// The skinning matrices as one array, each joint's sixteen in jointNames' order, as a shader takes them
export function packMatrices(matrices: Record<JointName, Matrix4>, into = new Float32Array(jointNames.length * 16)): Float32Array {
  jointNames.forEach((name, n) => into.set(matrices[name].elements, n * 16))
  return into
}

// A point of the scene as the source frame has it, for a level placed as given: scenePoint undone
export function sourceOfScene(placement: Placement, point: Vector3): Triple {
  const source: [number, number, number] = [0, 0, 0]
  const scene = [point.x, point.y, point.z]
  const { x, y, z } = placement.axes
  ;[x, y, z].forEach((axis, n) => {
    source[axis.source] = placement.origin[axis.source] + axis.sign * (scene[n] + placement.center[n])
  })
  return source
}
