import { Euler, MathUtils, Quaternion } from 'three'
import type { Triple } from '../volume/format.ts'
import { byJoint, isJointName, type JointName } from '../rig/rig.ts'
import type { Pose } from '../rig/pose.ts'

// A pose written by hand: each joint's turn from the neutral pose, as Euler angles in degrees in the limits' order, X
// then Y then Z, about the joint's own axes as they stand in the neutral pose: for a bone that hangs, x swings it back
// (forward is negative), y twists it and z swings it out to the body's left; for a foot or the toes, x points them down;
// for the trunk, x bends it forward. A joint left out stands as in the neutral pose. Written for no one body: the same
// angles pose the male and the female alike, from each one's own neutral pose

export interface AnglePose {
  joints: Partial<Record<JointName, Triple>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Reads a pose file's parsed JSON, throwing a clear error where it isn't one
export function readAnglePose(json: unknown, where: string): AnglePose {
  if (!isRecord(json) || !isRecord(json.joints)) throw new Error(`${where} has no joints`)
  const joints: Partial<Record<JointName, Triple>> = {}
  for (const [name, value] of Object.entries(json.joints)) {
    if (!isJointName(name)) throw new Error(`${where} turns a joint no skeleton has, ${name}`)
    const [x, y, z]: unknown[] = Array.isArray(value) && value.length === 3 ? value : []
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) throw new Error(`${where}'s ${name} isn't three angles`)
    joints[name] = [x, y, z]
  }
  return { joints }
}

// A joint's rotation from its turn in degrees
export function rotationOf(angles: Triple): Quaternion {
  return new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(angles[0]), MathUtils.degToRad(angles[1]), MathUtils.degToRad(angles[2]), 'XYZ'))
}

// Each joint's rotation in a hand-written pose
export function rotationsOfAngles(angles: AnglePose): Record<JointName, Quaternion> {
  return byJoint((name) => {
    const turn = angles.joints[name]
    return turn ? rotationOf(turn) : new Quaternion()
  })
}

// A pose's turns in degrees, as a hand-written pose writes them, rounded to a tenth, so that a pose can be written into
// the library
export function anglesOfPose(pose: Pose): AnglePose {
  const joints: Partial<Record<JointName, Triple>> = {}
  const round = (radians: number) => Math.round(MathUtils.radToDeg(radians) * 10) / 10
  for (const [name, rotation] of Object.entries(pose.rotations)) {
    if (!isJointName(name)) continue
    const euler = new Euler().setFromQuaternion(rotation, 'XYZ')
    const angles: Triple = [round(euler.x), round(euler.y), round(euler.z)]
    if (angles.some((angle) => angle !== 0)) joints[name] = angles
  }
  return { joints }
}

// A pose as the library's pose files are written, a joint to a line, ready to save as one
export function writeAnglePose(pose: AnglePose): string {
  const lines = Object.entries(pose.joints).map(([joint, angles]) => `    "${joint}": [${angles.join(', ')}]`)
  if (lines.length === 0) return '{ "joints": {} }\n'
  return `{\n  "joints": {\n${lines.join(',\n')}\n  }\n}\n`
}
