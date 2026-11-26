import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { AdditiveAnimationBlendMode, Quaternion, type AnimationClip } from 'three'
import { readAnglePose, rotationOf } from '../src/motion/angles.ts'
import { clipOf, isStill, layerClip, poseLength, readMotionFile, type MotionFile } from '../src/motion/clip.ts'
import { readLibrary } from '../src/motion/library.ts'
import { jointNames, type JointName } from '../src/rig/rig.ts'

// The motion files (src/motion/clip.ts): the three kinds told apart and read strictly, the library's committed files
// among them, and the clips they make, sampled at their keys, between them and across a loop's seam

const library = new URL('../public/motion/', import.meta.url)
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, library), 'utf8'))

// A joint's rotation in a clip at a time, as the mixer's interpolant gives it
function sample(clip: AnimationClip, joint: JointName, time: number): Quaternion {
  const track = clip.tracks.find((each) => each.name === `${joint}.quaternion`)
  if (!track) throw new Error(`No track for the ${joint}`)
  // The quaternion track's linear interpolant is its slerp, as the mixer's own
  return new Quaternion().fromArray(track.InterpolantFactoryMethodLinear().evaluate(time))
}

// How far apart two rotations are, as the larger component of their difference, the quaternions taken on the same
// side, since q and −q turn alike. angleTo's arccosine can't tell rotations nearer than about 3e-8 rad apart
const apart = (a: Quaternion, b: Quaternion) => {
  const sign = a.dot(b) < 0 ? -1 : 1
  return Math.max(Math.abs(a.x - sign * b.x), Math.abs(a.y - sign * b.y), Math.abs(a.z - sign * b.z), Math.abs(a.w - sign * b.w))
}
const near = (a: Quaternion, b: Quaternion, tolerance: number, what: string) => {
  const distance = apart(a, b)
  assert.ok(distance <= tolerance, `${what} is ${distance} from where it should be`)
}

const keyed = (keys: unknown[], duration: unknown = 2) => ({ duration, keys })
const baked = (tracks: unknown, duration: unknown = 1) => ({ duration, tracks })
const fails = (json: unknown, message: RegExp) => assert.throws(() => readMotionFile(json, 'The file'), message)

void test('each kind of file is read as its kind, told apart by its keys, and keys it does not know are passed over', () => {
  const pose = readMotionFile({ joints: { leftArm: [0, 0, 90] }, label: 'ignored' }, 'A pose')
  assert.deepEqual(pose, { kind: 'pose', pose: { joints: { leftArm: [0, 0, 90] } } })
  const clip = readMotionFile({ ...keyed([{ time: 0, joints: { spine: [1, 2, 3] } }, { time: 1, joints: {} }]), note: 'ignored' }, 'A clip')
  assert.deepEqual(clip, { kind: 'keyed', clip: { duration: 2, keys: [{ time: 0, joints: { spine: [1, 2, 3] } }, { time: 1, joints: {} }] } })
  const tracks = { neck: { times: [0, 0.5], values: [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2] } }
  assert.deepEqual(readMotionFile(baked(tracks), 'A baked clip'), { kind: 'baked', clip: { duration: 1, tracks } })
  fails({ label: 'nothing' }, /neither a pose/)
  fails({ joints: {}, keys: [] }, /both joints and keys/)
  fails([], /isn't an object/)
})

void test('an unknown joint, times that do not rise, a missing duration and a key past the duration are refused', () => {
  fails({ joints: { tail: [0, 0, 0] } }, /a joint no skeleton has, tail/)
  fails(keyed([{ time: 0, joints: { tail: [0, 0, 0] } }]), /a joint no skeleton has, tail/)
  fails(baked({ tail: { times: [0], values: [0, 0, 0, 1] } }), /a joint no skeleton has, tail/)

  fails(keyed([{ time: 0.5, joints: {} }, { time: 0.5, joints: {} }]), /keys don't rise in time/)
  fails(keyed([{ time: 1, joints: {} }, { time: 0.5, joints: {} }]), /keys don't rise in time/)
  fails(baked({ neck: { times: [0, 0.5, 0.25], values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] } }), /times don't rise/)

  fails({ keys: [{ time: 0, joints: {} }] }, /has no duration/)
  fails({ tracks: {} }, /has no duration/)
  fails(keyed([{ time: 0, joints: {} }], 0), /duration isn't a length of time/)
  fails(keyed([{ time: 0, joints: {} }], '2'), /duration isn't a length of time/)

  // A hand-written clip comes back to its first key at its end, so a key there is as much past it as one later
  fails(keyed([{ time: 0, joints: {} }, { time: 2, joints: {} }]), /past the clip's end/)
  fails(keyed([{ time: 0, joints: {} }, { time: 2.5, joints: {} }]), /past the clip's end/)
  fails(baked({ neck: { times: [0, 1.5], values: [0, 0, 0, 1, 0, 0, 0, 1] } }), /past the clip's end/)

  fails(keyed([]), /has no keys/)
  fails(keyed([{ joints: {} }]), /has no time/)
  fails(keyed([{ time: -1, joints: {} }]), /has no time/)
  fails(keyed([{ time: 0 }]), /key 1 has no joints/)
  fails(keyed([{ time: 0, joints: { neck: [0, 0] } }]), /isn't three angles/)
  fails(baked({ neck: { times: [0], values: [0, 0, 1] } }), /hasn't a rotation for each/)
  fails(baked({ neck: { times: [0], values: [0, 0, 0, 2] } }), /isn't of unit length/)
})

// The poses the library held when poses were all it held, each read as the page then read it
const posesOf030 = ['standing', 't-pose', 'arms-out', 'arms-forward', 'knee-up', 'sitting']

void test("a pose file of 0.3.0 reads as before, and its clip holds each joint's rotation exactly as the page set it", () => {
  for (const name of posesOf030) {
    const json = readJson(`${name}.json`)
    const before = readAnglePose(json, name)
    const file = readMotionFile(json, name)
    assert.deepEqual(file, { kind: 'pose', pose: before })
    const clip = clipOf(name, file)
    assert.equal(clip.duration, poseLength)
    assert.ok(isStill(clip))
    assert.equal(clip.tracks.length, jointNames.length)
    for (const joint of jointNames) {
      const turn = before.joints[joint]
      const rotation = turn ? rotationOf(turn) : new Quaternion()
      const track = clip.tracks.find((each) => each.name === `${joint}.quaternion`)
      assert.ok(track)
      // Kept in double, as the page set each quaternion, so a pose draws exactly as it did before it was a clip
      assert.ok(track.values instanceof Float64Array, `${name}'s ${joint} lost precision`)
      assert.deepEqual([...track.values], rotation.toArray())
      for (const time of [0, 0.25, poseLength, 7.5]) assert.deepEqual(sample(clip, joint, time).toArray(), rotation.toArray())
    }
  }
})

void test("the library's index lists a file of its own kind for each motion, and offers the poses and the breathing as layers", () => {
  const entries = readLibrary(readJson('index.json'))
  const kinds = Object.fromEntries(entries.map((entry) => [entry.id, readMotionFile(readJson(entry.file.replace('motion/', '')), entry.id).kind]))
  assert.deepEqual(kinds, {
    standing: 'pose',
    anatomical: 'pose',
    't-pose': 'pose',
    'arms-out': 'pose',
    'arms-forward': 'pose',
    'knee-up': 'pose',
    sitting: 'pose',
    breathing: 'keyed',
    walk: 'keyed',
    'ual-idle': 'baked',
    'ual-walk': 'baked',
    'ual-jog': 'baked',
    'ual-jump': 'baked',
    'ual-reach': 'baked',
    'mixamo-idle': 'baked',
    'mixamo-walk': 'baked',
    'mixamo-jog': 'baked',
    'mixamo-jump': 'baked',
    'mixamo-big-jump': 'baked',
    'mixamo-wave': 'baked',
    'mixamo-sitting': 'baked',
    'mixamo-goalkeeper': 'baked',
    'mixamo-batter': 'baked',
  })
  assert.deepEqual(
    entries.filter((entry) => entry.layer).map((entry) => entry.id),
    ['anatomical', 't-pose', 'arms-out', 'arms-forward', 'knee-up', 'sitting', 'breathing'],
  )
})

void test("an index entry may give a shorter label for a layer's slider, and none that's empty", () => {
  const entries = readLibrary(readJson('index.json'))
  assert.deepEqual(
    entries.filter((entry) => entry.short !== undefined).map((entry) => [entry.id, entry.short]),
    [['anatomical', 'anatomical']],
  )
  const entry = { id: 'a', label: 'a pose with a long name', file: 'motion/a.json', layer: true }
  assert.equal(readLibrary({ motions: [{ ...entry, short: 'a pose' }] })[0].short, 'a pose')
  assert.throws(() => readLibrary({ motions: [{ ...entry, short: '' }] }), /Motion 1 has no short/)
})

void test('a clip is sampled at its keys, between them, and across its loop, which comes back to its first key at its end', () => {
  const file: MotionFile = readMotionFile(
    keyed(
      [
        { time: 0, joints: { leftArm: [-40, 0, 0], neck: [0, 10, 0] } },
        { time: 0.5, joints: { leftArm: [-80, 0, 20] } },
        { time: 1.5, joints: { leftArm: [-10, 0, 0], neck: [0, -10, 0] } },
      ],
      2,
    ),
    'A clip',
  )
  const clip = clipOf('test', file)
  assert.equal(clip.duration, 2)
  assert.ok(!isStill(clip))
  const at = (x: number, y: number, z: number) => rotationOf([x, y, z])
  const first = at(-40, 0, 0)
  const second = at(-80, 0, 20)
  const third = at(-10, 0, 0)
  near(sample(clip, 'leftArm', 0), first, 1e-12, 'The arm at its first key')
  near(sample(clip, 'leftArm', 0.5), second, 1e-12, 'The arm at its second key')
  near(sample(clip, 'leftArm', 1.5), third, 1e-12, 'The arm at its third key')
  near(sample(clip, 'leftArm', 1), new Quaternion().slerpQuaternions(second, third, 0.5), 1e-9, 'The arm between its keys')
  // From its last key it goes back toward its first, which it reaches at the clip's end, where the loop starts again
  near(sample(clip, 'leftArm', 1.75), new Quaternion().slerpQuaternions(third, first, 0.5), 1e-9, 'The arm across the seam')
  near(sample(clip, 'leftArm', 2), first, 1e-12, 'The arm at the end')
  near(sample(clip, 'leftArm', 1.999999), sample(clip, 'leftArm', 0), 1e-5, 'The arm just before the end')
  // A joint keyed twice holds between and comes back at the end; one never keyed stands as in the neutral pose
  near(sample(clip, 'neck', 0.75), new Quaternion().slerpQuaternions(at(0, 10, 0), at(0, -10, 0), 0.5), 1e-9, 'The neck between its keys')
  near(sample(clip, 'neck', 2), at(0, 10, 0), 1e-12, 'The neck at the end')
  assert.deepEqual(sample(clip, 'rightThigh', 1.2).toArray(), [0, 0, 0, 1])
})

void test('a clip as a layer is a copy, made additive, whose turns from the neutral pose are its own', () => {
  const file = readMotionFile(readJson('arms-out.json'), 'arms out')
  const clip = clipOf('arms-out', file)
  const layer = layerClip(clip)
  assert.notEqual(layer, clip)
  assert.equal(layer.blendMode, AdditiveAnimationBlendMode)
  assert.notEqual(clip.blendMode, AdditiveAnimationBlendMode)
  assert.ok(isStill(layer))
  for (const joint of jointNames) near(sample(layer, joint, 0), sample(clip, joint, 0), 1e-12, `The layer's ${joint}`)
})
