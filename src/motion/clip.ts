import { AnimationClip, AnimationUtils, Quaternion, QuaternionKeyframeTrack } from 'three'
import type { Triple } from '../volume/format.ts'
import { byJoint, isJointName, jointNames, type JointName } from '../rig/rig.ts'
import { readAnglePose, rotationOf, type AnglePose } from './angles.ts'

// A motion of the library, public/motion/, as its file holds it, and as three's animation system plays it. A file is
// one of three things, told apart by its keys: a pose, a `joints` object of each joint's turn in degrees (angles.ts);
// a clip written by hand, a `duration` and `keys`, each key a `time` and a pose's `joints`; or a baked clip, a
// `duration` and `tracks`, each joint's `times` and its rotations, four numbers to a time, as a clip is written once
// it's been brought in from elsewhere. Keys the readers don't know are passed over.
//
// Each becomes an AnimationClip of one quaternion track for every joint, named `<joint>.quaternion`, which three
// binds to the bone of that name under the hips, so that going from any motion to any other is a crossfade between
// two clips. A joint a file leaves out stands as in the neutral pose. A pose is a clip of one key, given a nominal
// length, since an action looping over a clip of no length would divide its time by nothing. A clip written by hand
// loops: each joint goes back to its first key at the clip's duration, so the clip's end is its start.

export interface ClipKey {
  // Seconds from the clip's start
  time: number
  joints: AnglePose['joints']
}

export interface KeyedClip {
  // Seconds, after which the clip starts again
  duration: number
  keys: ClipKey[]
}

export interface BakedTrack {
  times: number[]
  // x, y, z and w of each time's rotation, from the neutral pose, in the joint's parent's frame
  values: number[]
}

export interface BakedClip {
  duration: number
  tracks: Partial<Record<JointName, BakedTrack>>
}

export type MotionFile = { kind: 'pose'; pose: AnglePose } | { kind: 'keyed'; clip: KeyedClip } | { kind: 'baked'; clip: BakedClip }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const seconds = (value: number) => `${value} s`

// How far a baked rotation's length may stray from 1 before it's taken for a mistake rather than rounding
const unitSlack = 1e-3

// The keys that tell the kinds of file apart: a pose's, a hand-written clip's and a baked clip's
const kindKeys = ['joints', 'keys', 'tracks']

// Reads a motion file's parsed JSON as its kind, throwing a clear error where it isn't one
export function readMotionFile(json: unknown, where: string): MotionFile {
  if (!isRecord(json) || Array.isArray(json)) throw new Error(`${where} isn't an object`)
  const present = kindKeys.filter((key) => Object.hasOwn(json, key))
  if (present.length === 0) throw new Error(`${where} is neither a pose, with joints, nor a clip, with keys or tracks`)
  if (present.length > 1) throw new Error(`${where} has both ${present.join(' and ')}, so it can't be told what it is`)
  if (Object.hasOwn(json, 'joints')) return { kind: 'pose', pose: readAnglePose(json, where) }
  const duration = readDuration(json, where)
  if (Object.hasOwn(json, 'keys')) return { kind: 'keyed', clip: { duration, keys: readKeys(json.keys, duration, where) } }
  return { kind: 'baked', clip: { duration, tracks: readTracks(json.tracks, duration, where) } }
}

function readDuration(json: Record<string, unknown>, where: string) {
  const { duration } = json
  if (duration === undefined) throw new Error(`${where} has no duration`)
  if (!isFiniteNumber(duration) || duration <= 0) throw new Error(`${where}'s duration isn't a length of time in seconds`)
  return duration
}

function readKeys(value: unknown, duration: number, where: string): ClipKey[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where} has no keys`)
  let last = -Infinity
  return value.map((key: unknown, n): ClipKey => {
    const at = `${where}'s key ${n + 1}`
    if (!isRecord(key)) throw new Error(`${at} isn't an object`)
    const { time } = key
    if (!isFiniteNumber(time) || time < 0) throw new Error(`${at} has no time from the clip's start`)
    if (time <= last) throw new Error(`${where}'s keys don't rise in time: key ${n + 1}, at ${seconds(time)}, follows one at ${seconds(last)}`)
    // The clip comes back to its first key at its duration, so nothing can be keyed there or later
    if (time >= duration) throw new Error(`${at}, at ${seconds(time)}, is past the clip's end, at ${seconds(duration)}`)
    last = time
    return { time, joints: readAnglePose(key, at).joints }
  })
}

function readTracks(value: unknown, duration: number, where: string): BakedClip['tracks'] {
  if (!isRecord(value)) throw new Error(`${where} has no tracks`)
  const tracks: BakedClip['tracks'] = {}
  for (const [name, track] of Object.entries(value)) {
    if (!isJointName(name)) throw new Error(`${where} turns a joint no skeleton has, ${name}`)
    const at = `${where}'s ${name}`
    if (!isRecord(track) || !Array.isArray(track.times) || !Array.isArray(track.values)) throw new Error(`${at} has no times and values`)
    const times: unknown[] = track.times
    const values: unknown[] = track.values
    if (times.length === 0 || !times.every(isFiniteNumber)) throw new Error(`${at} has no times`)
    if (!values.every(isFiniteNumber) || values.length !== times.length * 4) throw new Error(`${at} hasn't a rotation for each of its times`)
    times.forEach((time, n) => {
      if (n === 0 ? time < 0 : time <= times[n - 1]) throw new Error(`${at}'s times don't rise from 0`)
      if (time > duration) throw new Error(`${at} has a key at ${seconds(time)}, past the clip's end, at ${seconds(duration)}`)
      const [x, y, z, w] = values.slice(n * 4, n * 4 + 4)
      if (Math.abs(Math.hypot(x, y, z, w) - 1) > unitSlack) throw new Error(`${at}'s rotation at ${seconds(time)} isn't of unit length`)
    })
    tracks[name] = { times, values }
  }
  return tracks
}

// three keeps a track's times and values in single precision by default, while the mixer blends in double and the
// bones hold double. A pose was set on the bones in double before it was a clip, so its clip's track keeps double
// too, and draws exactly as it did; the times are kept the same way, so a clip's last key falls exactly on its end
class DoubleQuaternionTrack extends QuaternionKeyframeTrack {}
DoubleQuaternionTrack.prototype.TimeBufferType = Float64Array
DoubleQuaternionTrack.prototype.ValueBufferType = Float64Array

// The length given a pose's clip, in seconds. It holds one key, so any length plays it the same; one keeps a looping
// action's time finite
export const poseLength = 1

const trackName = (joint: JointName) => `${joint}.quaternion`
const restTrack = (joint: JointName) => new DoubleQuaternionTrack(trackName(joint), [0], [0, 0, 0, 1])

// The clips that hold one rotation for each joint whatever the time, which a clip running needn't advance
const stillClips = new WeakSet<AnimationClip>()
export const isStill = (clip: AnimationClip) => stillClips.has(clip)

// A clip of one key holding each joint at its rotation
export function poseClip(name: string, rotations: Record<JointName, Quaternion>): AnimationClip {
  const tracks = jointNames.map((joint) => new DoubleQuaternionTrack(trackName(joint), [0], rotations[joint].toArray()))
  const clip = new AnimationClip(name, poseLength, tracks)
  stillClips.add(clip)
  return clip
}

// The neutral pose's clip, every rotation none
export const neutralClip = () => poseClip('neutral', byJoint(() => new Quaternion()))

// A hand-written clip's tracks: each joint keyed at the keys that name it, and back at its first key at the end
function keyedTracks(clip: KeyedClip) {
  return jointNames.map((joint) => {
    const keyed = clip.keys.flatMap((key) => {
      const turn: Triple | undefined = key.joints[joint]
      return turn ? [{ time: key.time, rotation: rotationOf(turn) }] : []
    })
    const [first] = keyed
    if (!first) return restTrack(joint)
    const times = [...keyed.map((key) => key.time), clip.duration]
    const values = [...keyed, first].flatMap((key) => key.rotation.toArray())
    return new DoubleQuaternionTrack(trackName(joint), times, values)
  })
}

function bakedTracks(clip: BakedClip) {
  return jointNames.map((joint) => {
    const track = clip.tracks[joint]
    return track ? new DoubleQuaternionTrack(trackName(joint), track.times, track.values) : restTrack(joint)
  })
}

// A motion file's clip, named for the motion
export function clipOf(name: string, file: MotionFile): AnimationClip {
  if (file.kind === 'pose') {
    const { joints } = file.pose
    return poseClip(
      name,
      byJoint((joint) => {
        const turn = joints[joint]
        return turn ? rotationOf(turn) : new Quaternion()
      }),
    )
  }
  const tracks = file.kind === 'keyed' ? keyedTracks(file.clip) : bakedTracks(file.clip)
  return new AnimationClip(name, file.clip.duration, tracks)
}

// A clip as a layer: each joint's rotation taken as a turn from the neutral pose, which the mixer adds over whatever
// the motion beneath it holds, by the layer's weight. three makes a clip additive in place, so the layer is a copy
export function layerClip(clip: AnimationClip): AnimationClip {
  const layer = AnimationUtils.makeClipAdditive(clip.clone(), 0, neutralClip())
  if (isStill(clip)) stillClips.add(layer)
  return layer
}
