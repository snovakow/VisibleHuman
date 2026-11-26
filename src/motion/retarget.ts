import { Euler, Interpolant, Matrix4, PropertyBinding, Quaternion, Vector3, type AnimationClip, type KeyframeTrack, type Object3D } from 'three'
import type { Triple } from '../volume/format.ts'
import { byJoint, jointNames, limitsOf, skeletonShape, type JointName } from '../rig/rig.ts'
import type { BakedClip, BakedTrack } from './clip.ts'

// Bringing a clip made for another skeleton onto this rig. Another rig's bones have axes of their own and rest in a
// pose of their own, a T-pose, an A-pose or a BVH file's zero rotations, while this rig's joints all take the body's
// own axes in the neutral pose, standing with the arms hanging. So no rotation can be copied across as it stands, and
// three's SkeletonUtils.retarget, which copies a bone's world rotation onto the bone of the same name, would leave
// this rig's arms where the source's rest pose has its own. Instead, each joint takes how far the source's bone has
// turned in the world from where it rests:
//
// - a limb's joint, whose bone hangs or points forward in the neutral pose, is first turned so its bone lies the way
//   the source's bone lies at rest, by the least turn that takes the one direction onto the other, and then turned on
//   by the source bone's turn from its rest, so that the bone points wherever the source's points, frame by frame;
// - a joint whose bone lies as the scan holds it, the trunk's, the head's and the clavicles', takes the source's turn
//   from its rest alone, since its bone lies as the body's own does and a source's rest pose says nothing about it;
// - the hips take their turn the same way and lose their translation, as every clip here plays in place.
//
// Each joint's rotation in the world is then made a turn from its parent's, as a clip's tracks hold them. The source's
// own frame, which way it faces and which way is up, is read from where its hips, legs and neck stand at rest, and
// carried onto the scene's, so that a source lying along another axis, as one exported with z up does, stands up.
// Bones this rig has no joint for, the fingers among them, only carry the bones beneath them, and a joint the source
// has no bone for stands as its parent does. Pure arithmetic over three's math: the page reads the files with three's
// loaders (import.ts) and hands their bones and tracks here

export type Quad = readonly [number, number, number, number]

export interface SourceBone {
  name: string
  // The index of its parent among the bones, or −1 for a bone with none above it
  parent: number
  // Its rest transform from its parent, as the file has it
  position: Triple
  rotation: Quad
  scale: Triple
  // For a bone with no parent bone, the world matrix of whatever holds it, sixteen numbers in three's column order, if
  // anything does
  base?: readonly number[]
}

export interface SourceSkeleton {
  bones: readonly SourceBone[]
}

export interface SourceClip {
  name: string
  // Seconds
  duration: number
  // The times its bones' rotations are given at, from 0 to its duration, and each bone's rotation from its parent at
  // each, four numbers to a time, by the bone's name; a bone left out rests throughout
  times: readonly number[]
  rotations: ReadonlyMap<string, ArrayLike<number>>
}

// Whether an object is drawn, a mesh, a line or points, rather than a node of the skeleton's hierarchy
const isDrawn = (object: Object3D) => ('isMesh' in object && object.isMesh === true) || ('isLine' in object && object.isLine === true) || ('isPoints' in object && object.isPoints === true)
const isBone = (object: Object3D) => 'isBone' in object && object.isBone === true

// A skeleton as three's loaders leave it, read into a source skeleton: every node of the hierarchy under the root but
// what's drawn, its parents first, each with its transform from its parent as loaded. The nodes that hold the bones,
// an armature turned and scaled into the file's frame, are kept as nodes like the bones, since a clip may turn them
// too; a name a bone shares with another node is the bone's
export function skeletonOfBones(root: Object3D): SourceSkeleton {
  root.updateWorldMatrix(true, true)
  const found: Object3D[] = []
  root.traverse((object) => {
    if (!isDrawn(object)) found.push(object)
  })
  // Bones first among nodes of one name, so the tables find the bone
  const named = new Set(found.filter(isBone).map((bone) => bone.name))
  const index = new Map(found.map((node, n) => [node, n]))
  return {
    bones: found.map((node): SourceBone => {
      const parent = node.parent ? (index.get(node.parent) ?? -1) : -1
      const made: SourceBone = {
        name: !isBone(node) && named.has(node.name) ? '' : node.name,
        parent,
        position: [node.position.x, node.position.y, node.position.z],
        rotation: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
        scale: [node.scale.x, node.scale.y, node.scale.z],
      }
      if (parent < 0 && node.parent) made.base = node.parent.matrixWorld.toArray()
      return made
    }),
  }
}

// The rate a clip is baked at, frames a second: its keys' own, within these, read from the middle of the steps between
// the keys of its most finely keyed rotation rather than from how many keys it holds, since three's FBX loader adds
// keys within a frame wherever one of a bone's Euler angles jumps half a turn or more between two keys, which took a
// Mixamo clip keyed at 30 a second to 38
const leastRate = 10
const mostRate = 60
const usualRate = 30

// The middle of the steps between a track's keys, in seconds, or none where it has no step of any length
function middleStep(times: ArrayLike<number>): number | null {
  const steps = Array.from({ length: Math.max(0, times.length - 1) }, (_, n) => times[n + 1] - times[n]).toSorted((a, b) => a - b)
  const middle = steps[Math.floor(steps.length / 2)]
  return middle !== undefined && middle > 0 ? middle : null
}

// A track's own interpolant, by its interpolation: three sets each track's createInterpolant to suit it, the glTF
// loader's cubic spline among them, which three's types leave out. Read through Reflect with a check, and the linear
// interpolant where it's missing; something to check on a three upgrade
type Evaluate = (time: number) => Float32Array | Float64Array
function interpolantOf(track: KeyframeTrack): Evaluate {
  const linear = track.InterpolantFactoryMethodLinear()
  const fallback: Evaluate = (time) => {
    const result = linear.evaluate(time)
    return result instanceof Float64Array ? result : Float32Array.from(result)
  }
  const make: unknown = Reflect.get(track, 'createInterpolant')
  if (typeof make !== 'function') return fallback
  const made: unknown = Reflect.apply(make, track, [])
  if (!(made instanceof Interpolant)) return fallback
  return (time) => {
    const result = made.evaluate(time)
    return result instanceof Float64Array || result instanceof Float32Array ? result : Float32Array.from(result)
  }
}

// A clip as three's loaders leave it, read into a source clip: its rotation tracks sampled by their own interpolants,
// whatever their kind, at a steady rate from 0 to its end. Its other tracks, the hips' position among them, are
// passed over
export function sourceClipOf(clip: AnimationClip): SourceClip {
  const tracks = clip.tracks.flatMap((track) => {
    const parsed = PropertyBinding.parseTrackName(track.name)
    return parsed.propertyName === 'quaternion' && typeof parsed.nodeName === 'string' && parsed.nodeName !== '' ? [{ bone: parsed.nodeName, track }] : []
  })
  const densest = tracks.reduce<KeyframeTrack | null>((most, { track }) => (track.times.length > (most?.times.length ?? 1) ? track : most), null)
  const step = densest ? middleStep(densest.times) : null
  const rate = step === null ? usualRate : Math.min(mostRate, Math.max(leastRate, Math.round(1 / step)))
  const duration = clip.duration
  const times = duration > 0 ? bakeTimes(duration, rate) : [0]
  const rotations = new Map<string, Float64Array>()
  for (const { bone, track } of tracks) {
    if (rotations.has(bone)) continue
    const evaluate = interpolantOf(track)
    const values = new Float64Array(times.length * 4)
    times.forEach((time, n) => values.set(evaluate(time).subarray(0, 4), n * 4))
    rotations.set(bone, values)
  }
  return { name: clip.name, duration, times, rotations }
}

// The names a source gives the bones this rig has joints for, and the bones that end the last of a limb's bones, the
// hand's at the middle finger's first joint and the toes' at their tip, which set the way those bones point
export interface NameTable {
  source: string
  joints: Record<JointName, string>
  ends: Partial<Record<JointName, string>>
}

// Mixamo's rig, read from its FBX files, whose bones are named `mixamorig:Hips` and so on; three's loader drops the
// colon. BVH files from motion capture commonly name theirs the same, without the prefix
const mixamo: NameTable = {
  source: 'Mixamo',
  joints: {
    hips: 'Hips',
    spine: 'Spine',
    spine1: 'Spine1',
    chest: 'Spine2',
    neck: 'Neck',
    head: 'Head',
    leftShoulder: 'LeftShoulder',
    leftArm: 'LeftArm',
    leftForearm: 'LeftForeArm',
    leftHand: 'LeftHand',
    rightShoulder: 'RightShoulder',
    rightArm: 'RightArm',
    rightForearm: 'RightForeArm',
    rightHand: 'RightHand',
    leftThigh: 'LeftUpLeg',
    leftShin: 'LeftLeg',
    leftFoot: 'LeftFoot',
    leftToes: 'LeftToeBase',
    rightThigh: 'RightUpLeg',
    rightShin: 'RightLeg',
    rightFoot: 'RightFoot',
    rightToes: 'RightToeBase',
  },
  ends: { leftHand: 'LeftHandMiddle1', rightHand: 'RightHandMiddle1', leftToes: 'LeftToe_End', rightToes: 'RightToe_End' },
}

// The Quaternius Universal Animation Library's rig, read from its GLB and FBX files, named as Unreal's mannequin is
const quaternius: NameTable = {
  source: 'Quaternius',
  joints: {
    hips: 'pelvis',
    spine: 'spine_01',
    spine1: 'spine_02',
    chest: 'spine_03',
    neck: 'neck_01',
    head: 'Head',
    leftShoulder: 'clavicle_l',
    leftArm: 'upperarm_l',
    leftForearm: 'lowerarm_l',
    leftHand: 'hand_l',
    rightShoulder: 'clavicle_r',
    rightArm: 'upperarm_r',
    rightForearm: 'lowerarm_r',
    rightHand: 'hand_r',
    leftThigh: 'thigh_l',
    leftShin: 'calf_l',
    leftFoot: 'foot_l',
    leftToes: 'ball_l',
    rightThigh: 'thigh_r',
    rightShin: 'calf_r',
    rightFoot: 'foot_r',
    rightToes: 'ball_r',
  },
  ends: { leftHand: 'middle_01_l', rightHand: 'middle_01_r', leftToes: 'ball_leaf_l', rightToes: 'ball_leaf_r' },
}

export const nameTables: readonly NameTable[] = [mixamo, quaternius]

// A bone's name as the tables match it: Mixamo's prefix dropped, as some exports number it (mixamorig1:) and some keep
// the colon, and the case ignored
const plainName = (name: string) => name.replace(/^mixamorig\d*:?/i, '').toLowerCase()

// How a source's skeleton is read for retargeting: which of its bones each joint follows, where each points at rest
// in the scene's axes, and the turn that takes its world onto the scene's
export interface SourceRig {
  table: NameTable
  // Each joint's bone among the source's, or −1 where the source has none
  bones: Record<JointName, number>
  // The rest world rotation of every source bone
  rest: readonly Quaternion[]
  // The turn from the source's world axes to the scene's
  frame: Quaternion
  // Whether that turn was taken square to the source's axes, as it is for any upright rest pose
  square: boolean
  // For each limb's joint the source has, the way its bone points at rest in the scene's axes, and the bone it was
  // measured to, or none where the source has no bone beyond it, when the joint points as its parent does
  directions: Partial<Record<JointName, { direction: Vector3; to: string | null }>>
  // The turn that lays each limb joint's neutral bone along the source's rest bone
  alignments: Partial<Record<JointName, Quaternion>>
  // The bones no joint follows, by name
  unmapped: readonly string[]
}

// The way each of this rig's bones points in the neutral pose: down for the limbs, forward for the feet and toes
const neutralDirection = (joint: JointName) => (skeletonShape[joint].lie === 'forward' ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0))
const isLimb = (joint: JointName) => skeletonShape[joint].lie !== 'scanned'

// Each bone's rest world matrix, its parents' first
function restWorlds(skeleton: SourceSkeleton): Matrix4[] {
  const worlds: Matrix4[] = []
  skeleton.bones.forEach((bone, n) => {
    if (bone.parent >= n) throw new Error(`The source's ${bone.name} comes before its parent`)
    const local = new Matrix4().compose(new Vector3(...bone.position), new Quaternion(...bone.rotation), new Vector3(...bone.scale))
    const above = bone.parent >= 0 ? worlds[bone.parent] : bone.base ? new Matrix4().fromArray(bone.base) : new Matrix4()
    worlds.push(above.clone().multiply(local))
  })
  return worlds
}

// The rotation part of a world matrix
const rotationOfMatrix = (matrix: Matrix4) => {
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, rotation, scale)
  return rotation
}

// The turn from the source's axes to the scene's: its left from the right thigh to the left, its up from the hips to
// the neck, square to its left, and its front from the two. An upright rest pose leans a little, so where each axis
// lies within 25° of one of the source's own, the turn is taken square to them
const squareCosine = Math.cos((25 * Math.PI) / 180)
function sourceFrame(places: Record<'hips' | 'neck' | 'left' | 'right', Vector3>): { frame: Quaternion; square: boolean } {
  const left = places.left.clone().sub(places.right).normalize()
  const rise = places.neck.clone().sub(places.hips)
  const up = rise.sub(left.clone().multiplyScalar(rise.dot(left))).normalize()
  if (!Number.isFinite(left.x) || !Number.isFinite(up.x) || left.lengthSq() === 0 || up.lengthSq() === 0) {
    throw new Error("The source's hips, legs and neck don't stand apart, so which way it faces can't be told")
  }
  const snap = (axis: Vector3) => {
    const parts = [axis.x, axis.y, axis.z]
    const most = parts.reduce((best, value, n) => (Math.abs(value) > Math.abs(parts[best]) ? n : best), 0)
    if (Math.abs(parts[most]) < squareCosine) return null
    const square = new Vector3()
    square.setComponent(most, Math.sign(parts[most]))
    return square
  }
  const squareLeft = snap(left)
  const squareUp = snap(up)
  const square = squareLeft !== null && squareUp !== null && Math.abs(squareLeft.dot(squareUp)) === 0
  const x = square && squareLeft ? squareLeft : left
  const y = square && squareUp ? squareUp : up
  const z = new Vector3().crossVectors(x, y)
  // The columns are the source's left, up and front in its own world; the scene's are its x, y and z, so the turn
  // from the source's world to the scene's is that basis undone
  const basis = new Matrix4().makeBasis(x, y, z)
  return { frame: new Quaternion().setFromRotationMatrix(basis).invert(), square }
}

// Reads a source skeleton: the table its bone names fit best, the bone each joint follows, the source's frame and each
// limb's rest direction. A source with no hips the table knows can't be retargeted, since every joint hangs from them
export function readSourceRig(skeleton: SourceSkeleton): SourceRig {
  const byName = new Map<string, number>()
  skeleton.bones.forEach((bone, n) => {
    const name = plainName(bone.name)
    if (!byName.has(name)) byName.set(name, n)
  })
  const find = (name: string | undefined) => (name === undefined ? -1 : (byName.get(plainName(name)) ?? -1))
  // The table that finds the most of the joints, of those that find the hips
  const scored = nameTables.map((table) => ({
    table,
    found: find(table.joints.hips) < 0 ? -1 : jointNames.filter((joint) => find(table.joints[joint]) >= 0).length,
  }))
  const best = scored.reduce((most, each) => (each.found > most.found ? each : most))
  const { table } = best
  if (find(table.joints.hips) < 0) {
    throw new Error(`The source has no hips this rig knows, by the names of ${nameTables.map((each) => each.source).join(' or ')}`)
  }
  const bones = byJoint((joint) => find(table.joints[joint]))

  const worlds = restWorlds(skeleton)
  const rest = worlds.map(rotationOfMatrix)
  const placeOf = (index: number) => new Vector3().setFromMatrixPosition(worlds[index])
  const placeOfJoint = (joint: JointName) => {
    const index = bones[joint]
    if (index < 0) throw new Error(`The source has no ${table.joints[joint]}, which says which way it faces`)
    return placeOf(index)
  }
  const { frame, square } = sourceFrame({
    hips: placeOfJoint('hips'),
    neck: bones.neck >= 0 ? placeOf(bones.neck) : bones.head >= 0 ? placeOf(bones.head) : placeOfJoint('chest'),
    left: placeOfJoint('leftThigh'),
    right: placeOfJoint('rightThigh'),
  })

  // Each limb's bone points from its joint to the next joint the source has, its child's, or for a last bone to the
  // bone that ends it; a joint with neither points as its parent's does
  const directions: SourceRig['directions'] = {}
  const alignments: SourceRig['alignments'] = {}
  for (const joint of jointNames) {
    if (!isLimb(joint) || bones[joint] < 0) continue
    const { child, parent } = skeletonShape[joint]
    const toIndex = child ? bones[child] : find(table.ends[joint])
    if (toIndex >= 0) {
      const direction = placeOf(toIndex).sub(placeOf(bones[joint])).applyQuaternion(frame).normalize()
      if (Number.isFinite(direction.x) && direction.lengthSq() > 0) {
        directions[joint] = { direction, to: skeleton.bones[toIndex].name }
        alignments[joint] = new Quaternion().setFromUnitVectors(neutralDirection(joint), direction)
        continue
      }
    }
    const above = parent ? alignments[parent] : undefined
    const alignment = above ? above.clone() : new Quaternion()
    alignments[joint] = alignment
    directions[joint] = { direction: neutralDirection(joint).applyQuaternion(alignment), to: null }
  }

  const used = new Set(Object.values(bones))
  const unmapped = skeleton.bones.filter((_, n) => !used.has(n)).map((bone) => bone.name)
  return { table, bones, rest, frame, square, directions, alignments, unmapped }
}

// Each joint's rotation from its parent in one frame of the source: the world rotations of the source's bones, from
// the given local rotation of each, and each joint's from them as the header says
function frameRotations(skeleton: SourceSkeleton, rig: SourceRig, local: (bone: number) => Quaternion): Record<JointName, Quaternion> {
  const world: Quaternion[] = []
  skeleton.bones.forEach((bone, n) => {
    const above = bone.parent >= 0 ? world[bone.parent] : bone.base ? rotationOfMatrix(new Matrix4().fromArray(bone.base)) : new Quaternion()
    world.push(above.clone().multiply(local(n)))
  })
  const frameInverse = rig.frame.clone().invert()
  const worldOfJoint = byJoint(() => new Quaternion())
  for (const joint of jointNames) {
    const index = rig.bones[joint]
    const { parent } = skeletonShape[joint]
    if (index < 0) {
      // A joint the source hasn't got turns as its parent does; the hips the source always has
      if (parent) worldOfJoint[joint].copy(worldOfJoint[parent])
      continue
    }
    // The bone's turn in the world from its rest, in the scene's axes
    const turn = world[index].clone().multiply(rig.rest[index].clone().invert())
    const scene = rig.frame.clone().multiply(turn).multiply(frameInverse)
    const alignment = rig.alignments[joint]
    worldOfJoint[joint].copy(alignment ? scene.multiply(alignment) : scene)
  }
  return byJoint((joint) => {
    const { parent } = skeletonShape[joint]
    return parent ? worldOfJoint[parent].clone().invert().multiply(worldOfJoint[joint]) : worldOfJoint[joint].clone()
  })
}

// The rotations the source's rest pose gives this rig's joints, with no clip: for a source resting in a T-pose, this
// rig's T-pose, which is the proof that the neutral pose is the one the library's poses are written from
export function restRotations(skeleton: SourceSkeleton, rig: SourceRig = readSourceRig(skeleton)): Record<JointName, Quaternion> {
  const frame = frameRotations(skeleton, rig, (bone) => new Quaternion(...skeleton.bones[bone].rotation))
  settle(frame)
  return frame
}

// The times a clip of a duration is baked at, at a rate of frames a second, from 0 to the duration itself
export function bakeTimes(duration: number, rate: number): number[] {
  const frames = Math.max(1, Math.round(duration * rate))
  return Array.from({ length: frames + 1 }, (_, n) => (n === frames ? duration : n / rate))
}

// How many decimal places a baked clip keeps: a millionth of a quaternion's unit, a twentieth of a millidegree
const places = 6
const rounded = (value: number) => {
  const scale = 10 ** places
  const result = Math.round(value * scale) / scale
  return Object.is(result, -0) ? 0 : result
}

// A rotation's track as baked: its values on the same side as the one before, since q and −q turn alike and the
// mixer's slerp takes the short way between them either way; and a single key where it never changes
function bakedTrack(times: readonly number[], rotations: readonly Quaternion[]): BakedTrack {
  const values: number[] = []
  let last: Quaternion | null = null
  for (const rotation of rotations) {
    const kept = rotation.clone().normalize()
    if (last && last.dot(kept) < 0) kept.set(-kept.x, -kept.y, -kept.z, -kept.w)
    values.push(kept.x, kept.y, kept.z, kept.w)
    last = kept
  }
  const first = values.slice(0, 4)
  const still = values.every((value, n) => Math.abs(value - first[n % 4]) < 0.5 * 10 ** -places)
  if (still) return { times: [0], values: first.map(rounded) }
  return { times: times.map(rounded), values: values.map(rounded) }
}

// A source's clip on this rig: every joint's rotation from its parent at each of the clip's times, the hips' among
// them, and nothing of where the hips go; each frame's turns shared out as this rig's joints turn and then held within
// their limits (settle). With it, how far the clip as retargeted strayed past the limits before it was held, and the
// most holding it turned a bone
export interface Retargeted {
  clip: BakedClip
  past: PastLimits
  held: PastLimits
}

export function retargetClip(skeleton: SourceSkeleton, clip: SourceClip, rig: SourceRig = readSourceRig(skeleton)): Retargeted {
  if (!(clip.duration > 0)) throw new Error(`The clip ${clip.name} has no length`)
  const restOf = (bone: number) => new Quaternion(...skeleton.bones[bone].rotation)
  let past: PastLimits = { joint: 'hips', degrees: 0, time: 0 }
  let held: PastLimits = { joint: 'hips', degrees: 0, time: 0 }
  const frames = clip.times.map((time, at) => {
    const frame = frameRotations(skeleton, rig, (bone) => {
      const values = clip.rotations.get(skeleton.bones[bone].name)
      if (!values) return restOf(bone)
      return new Quaternion(values[at * 4], values[at * 4 + 1], values[at * 4 + 2], values[at * 4 + 3]).normalize()
    })
    const settled = settle(frame)
    if (settled.past.degrees > past.degrees) past = { ...settled.past, time }
    if (settled.held.degrees > held.degrees) held = { ...settled.held, time }
    return frame
  })
  const duration = rounded(clip.duration)
  const tracks: BakedClip['tracks'] = {}
  for (const joint of jointNames) {
    tracks[joint] = bakedTrack(
      clip.times.map((time) => Math.min(time, duration)),
      frames.map((frame) => frame[joint]),
    )
  }
  return { clip: { duration, tracks }, past, held }
}

// The hinges, each elbow and knee, by the bone above and the way the hinge bends its bone, forward for an elbow (+z)
// and back for a knee (−z); and the wrists, whose twist is the forearm's
const hinges = [
  ['leftArm', 'leftForearm', 1],
  ['rightArm', 'rightForearm', 1],
  ['leftThigh', 'leftShin', -1],
  ['rightThigh', 'rightShin', -1],
] as const
const wrists = [
  ['leftForearm', 'leftHand'],
  ['rightForearm', 'rightHand'],
] as const
// How far a hinge must bend, as the sine of its bend, before which way it bends can be told: below the first, its
// sideways turn stays its own, past the second it's all handed on, and between the two a share of it
const unbent = Math.sin((3 * Math.PI) / 180)
const bent = Math.sin((15 * Math.PI) / 180)
const along = new Vector3(0, 1, 0)

// Shares one frame's turns out as this rig's joints turn, then holds each joint within its limits, in place. Another
// rig's elbow or knee may turn its bone partly sideways, about the length of the bone above, where this rig's is a
// hinge; that turn is handed to the bone above, as a twist about its own length, so the limb points just as it did
// and the hinge bends in its own plane. A hinge bent backward is kept on its own side, as an elbow straight past
// level is. Another rig's hand may twist where this rig's forearm does; the twist is handed to the forearm, the hand
// pointing as it did. Neither moves a bone. What's still past a joint's limits, a foot pointed further than this
// rig's ankle goes, say, is then held at them, as the handles' solver holds a joint, by whichever of the joint's two
// sets of Euler angles holding moves least. Returns the worst joint past its limits before it was held, and the most
// holding it turned a joint, in degrees
export function settle(frame: Record<JointName, Quaternion>): { past: Omit<PastLimits, 'time'>; held: Omit<PastLimits, 'time'> } {
  for (const [above, hinge, side] of hinges) {
    const bone = new Vector3(0, -1, 0).applyQuaternion(frame[hinge])
    const bend = Math.hypot(bone.x, bone.z)
    if (bend <= unbent) continue
    const share = Math.min(1, (bend - unbent) / (bent - unbent))
    const forward = side * bone.z
    // The turn about the bone above's length that brings the bone into the hinge's plane, on the side it lies
    const turn = forward === 0 ? (side * Math.sign(bone.x) * Math.PI) / 2 : -side * Math.atan(bone.x / forward)
    const twist = new Quaternion().setFromAxisAngle(along, turn * share)
    frame[hinge].premultiply(twist)
    frame[above].multiply(twist.invert())
  }
  for (const [forearm, hand] of wrists) {
    const rotation = frame[hand]
    const twist = new Quaternion(0, rotation.y, 0, rotation.w)
    if (twist.lengthSq() < 1e-12) continue
    twist.normalize()
    frame[hand].premultiply(twist.clone().invert())
    frame[forearm].multiply(twist)
  }
  let past: Omit<PastLimits, 'time'> = { joint: 'hips', degrees: 0 }
  let held: Omit<PastLimits, 'time'> = { joint: 'hips', degrees: 0 }
  for (const joint of jointNames) {
    const by = pastBy(joint, frame[joint])
    if (by <= 0) continue
    if (by > past.degrees) past = { joint, degrees: by }
    const holding = heldAt(joint, frame[joint])
    const moved = degrees(holding.angleTo(frame[joint]))
    if (moved > held.degrees) held = { joint, degrees: moved }
    frame[joint].copy(holding)
  }
  return { past, held }
}

// How far each joint of a clip strays past its limits, the worst of them: the joint, the angle by which, in degrees,
// and the time. A rotation has two sets of Euler angles in any order, and the one nearer the limits is taken
export interface PastLimits {
  joint: JointName
  degrees: number
  time: number
}

const degrees = (radians: number) => (radians * 180) / Math.PI
const wrapped = (angle: number) => {
  const turned = ((((angle + 180) % 360) + 360) % 360) - 180
  return turned === -180 ? 180 : turned
}
function pastBy(joint: JointName, rotation: Quaternion): number {
  const limits = limitsOf(joint)
  if (!limits) return 0
  const euler = new Euler().setFromQuaternion(rotation, 'XYZ')
  const first: Triple = [degrees(euler.x), degrees(euler.y), degrees(euler.z)]
  const second: Triple = [wrapped(first[0] + 180), wrapped(180 - first[1]), wrapped(first[2] + 180)]
  const past = (angles: Triple) =>
    Math.max(
      ...(['x', 'y', 'z'] as const).map((axis, n) => {
        const [least, most] = limits[axis]
        return Math.max(0, least - angles[n], angles[n] - most)
      }),
    )
  return Math.min(past(first), past(second))
}

// A rotation held within a joint's limits: each of its two sets of Euler angles clamped to the limits, and the one
// that moves it least
function heldAt(joint: JointName, rotation: Quaternion): Quaternion {
  const limits = limitsOf(joint)
  if (!limits) return rotation.clone()
  const euler = new Euler().setFromQuaternion(rotation, 'XYZ')
  const first: Triple = [degrees(euler.x), degrees(euler.y), degrees(euler.z)]
  const second: Triple = [wrapped(first[0] + 180), wrapped(180 - first[1]), wrapped(first[2] + 180)]
  const radians = (angle: number) => (angle * Math.PI) / 180
  const clamped = (angles: Triple) => {
    const [x, y, z] = (['x', 'y', 'z'] as const).map((axis, n) => radians(Math.min(limits[axis][1], Math.max(limits[axis][0], angles[n]))))
    return new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'))
  }
  const a = clamped(first)
  const b = clamped(second)
  return a.angleTo(rotation) <= b.angleTo(rotation) ? a : b
}

export function worstPastLimits(clip: BakedClip): PastLimits {
  let worst: PastLimits = { joint: 'hips', degrees: 0, time: 0 }
  for (const joint of jointNames) {
    const track = clip.tracks[joint]
    if (!track) continue
    track.times.forEach((time, n) => {
      const [x, y, z, w] = track.values.slice(n * 4, n * 4 + 4)
      const by = pastBy(joint, new Quaternion(x, y, z, w))
      if (by > worst.degrees) worst = { joint, degrees: by, time }
    })
  }
  return worst
}

// The arms' rest pose in words, from how far the upper arms lie below level, for the log: a T-pose within 15° of
// level, an A-pose beyond it
export function restPoseName(rig: SourceRig): string {
  const arms = (['leftArm', 'rightArm'] as const).flatMap((joint) => {
    const entry = rig.directions[joint]
    return entry ? [degrees(Math.asin(Math.max(-1, Math.min(1, -entry.direction.y))))] : []
  })
  if (arms.length === 0) return 'a pose with no arms'
  const below = arms.reduce((sum, angle) => sum + angle, 0) / arms.length
  const kind = Math.abs(below) <= 15 ? 'a T-pose' : below > 15 && below < 75 ? 'an A-pose' : 'neither a T-pose nor an A-pose'
  return `${kind}, the upper arms ${below.toFixed(1)}° below level`
}
