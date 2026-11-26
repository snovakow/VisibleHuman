import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Quaternion, type AnimationClip } from 'three'
import { createAnimator, fadeSeconds, stepSeconds, type Animator } from '../src/motion/animator.ts'
import { clipOf, layerClip, neutralClip, poseLength, readMotionFile } from '../src/motion/clip.ts'
import { bindSkeleton } from '../src/rig/pose.ts'
import { jointNames, readRig } from '../src/rig/rig.ts'
import { createRigSkeleton, type RigSkeleton } from '../src/rig/skeleton.ts'
import type { SceneAxes } from '../src/volume/format.ts'

// The animator (src/motion/animator.ts) on the male's skeleton, in Node over three's own mixer: the neutral pose held,
// crossfades between motions, layers by weight, speed, pause and a single step, and actions let go once faded out

const maleAxes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } }
const male = readRig(JSON.parse(readFileSync(new URL('../data/male/rig.json', import.meta.url), 'utf8')))
const skeleton = (): RigSkeleton => createRigSkeleton(bindSkeleton(male, { axes: maleAxes, origin: [0, 0, 0], center: [0, 0, 0] }))
const library = (name: string) => clipOf(name, readMotionFile(JSON.parse(readFileSync(new URL(`../public/motion/${name}.json`, import.meta.url), 'utf8')), name))

// A clip over time written here, of the kind the library's are: the left arm swinging and the right knee bending,
// round a loop of 1.2 s
const swing = clipOf(
  'swing',
  readMotionFile(
    {
      duration: 1.2,
      keys: [
        { time: 0, joints: { leftArm: [20, 0, 0], rightShin: [0, 0, 0] } },
        { time: 0.3, joints: { leftArm: [0, 0, 10], rightShin: [40, 0, 0] } },
        { time: 0.6, joints: { leftArm: [-20, 0, 0], rightShin: [10, 0, 0] } },
        { time: 0.9, joints: { leftArm: [0, 0, 5], rightShin: [60, 0, 0] } },
      ],
    },
    'swing',
  ),
)

const rotations = (rig: RigSkeleton) => jointNames.map((name) => rig.bones[name].quaternion.clone())
// A clip's rotation for each joint at a time, as its own tracks give it
const posed = (clip: AnimationClip, time = 0) =>
  jointNames.map((name) => {
    const track = clip.tracks.find((each) => each.name === `${name}.quaternion`)
    if (!track) throw new Error(`No track for the ${name}`)
    return new Quaternion().fromArray(track.InterpolantFactoryMethodLinear().evaluate(time))
  })
// The larger component of two rotations' difference, taken on the same side, since q and −q turn alike
const apart = (a: Quaternion, b: Quaternion) => {
  const sign = a.dot(b) < 0 ? -1 : 1
  return Math.max(Math.abs(a.x - sign * b.x), Math.abs(a.y - sign * b.y), Math.abs(a.z - sign * b.z), Math.abs(a.w - sign * b.w))
}
const sameAs = (actual: Quaternion[], expected: Quaternion[], tolerance: number, what: string) =>
  actual.forEach((rotation, n) => {
    const distance = apart(rotation, expected[n])
    assert.ok(distance <= tolerance, `${what}: the ${jointNames[n]} is ${distance} from where it should be`)
  })
const frames = (animator: Animator, seconds: number, count: number) => {
  for (let n = 0; n < count; n++) animator.update(seconds)
}

void test('a skeleton in the neutral pose playing the neutral clip moves nothing, and the bones start there', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  for (const name of jointNames) assert.deepEqual(rig.bones[name].quaternion.toArray(), [0, 0, 0, 1], `the ${name} isn't neutral`)
  const before = jointNames.map((name) => rig.bones[name].position.clone())
  animator.play(neutralClip())
  frames(animator, 1 / 60, 30)
  for (const name of jointNames) assert.deepEqual(rig.bones[name].quaternion.toArray(), [0, 0, 0, 1], `the ${name} turned`)
  jointNames.forEach((name, n) => assert.deepEqual(rig.bones[name].position.toArray(), before[n].toArray(), `the ${name} moved`))
  assert.equal(animator.moving, false)
})

void test('halfway through a crossfade every joint lies between its two poses, and at its end it equals the second', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  const armsOut = library('arms-out')
  const kneeUp = library('knee-up')
  animator.play(armsOut)
  animator.update(1 / 60)
  sameAs(rotations(rig), posed(armsOut), 0, 'Arms out, shown at once')
  animator.play(kneeUp)
  assert.equal(animator.moving, true)
  animator.update(fadeSeconds / 2)
  const from = posed(armsOut)
  const to = posed(kneeUp)
  rotations(rig).forEach((rotation, n) => {
    const whole = from[n].angleTo(to[n])
    if (whole < 1e-6) return
    // On the arc between the two, and, the fade's eased weight being a half there, in its middle
    assert.ok(Math.abs(rotation.angleTo(from[n]) + rotation.angleTo(to[n]) - whole) < 1e-6, `the ${jointNames[n]} leaves the arc`)
    assert.ok(Math.abs(rotation.angleTo(from[n]) - whole / 2) < 1e-6, `the ${jointNames[n]} isn't halfway`)
  })
  animator.update(fadeSeconds / 2 + 1e-3)
  sameAs(rotations(rig), to, 1e-5, 'Knee up, the fade over')
  // To the last bit: the mixer, given one motion at a weight of one, copies its values
  sameAs(rotations(rig), to, 0, 'Knee up, exactly')
  assert.equal(animator.moving, false)
})

void test('a crossfade picked mid-way goes on from where the body stands, and none faded out is left running', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  const clips = ['arms-out', 'knee-up', 'sitting', 't-pose'].map(library)
  animator.play(clips[0])
  animator.update(1 / 60)
  animator.play(clips[1])
  frames(animator, fadeSeconds / 10, 3)
  const before = rotations(rig)
  animator.play(clips[2])
  animator.update(0)
  sameAs(rotations(rig), before, 1e-12, 'The body as the second fade sets off')
  frames(animator, fadeSeconds / 10, 4)
  // Back to one fading out, which goes on from where it is
  animator.play(clips[1])
  animator.update(0)
  frames(animator, fadeSeconds / 10, 2)
  animator.play(clips[3])
  frames(animator, 1 / 60, Math.ceil(fadeSeconds * 60) + 2)
  sameAs(rotations(rig), posed(clips[3]), 0, 'The T-pose, the fades over')
  assert.equal(animator.mixer.stats.actions.inUse, 1)
})

void test('a pose faded into from a clip over time holds still once the fade is over', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  const sitting = library('sitting')
  animator.play(swing)
  frames(animator, 1 / 60, 10)
  assert.equal(animator.moving, true)
  animator.play(sitting)
  frames(animator, 1 / 60, Math.ceil(fadeSeconds * 60) + 2)
  sameAs(rotations(rig), posed(sitting), 0, 'Sitting, the fade from the clip over')
  // The clip it faded from is let go, so nothing left asks for the bones to be turned again
  assert.equal(animator.mixer.stats.actions.inUse, 1)
  assert.equal(animator.moving, false)
})

void test('a layer at weight 0 changes nothing, and at weight 1 over the neutral pose it equals its pose', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  const sitting = library('sitting')
  const layer = layerClip(sitting)
  animator.play(neutralClip())
  animator.setLayers([{ clip: layer, weight: 0 }])
  animator.update(1 / 60)
  for (const name of jointNames) assert.deepEqual(rig.bones[name].quaternion.toArray(), [0, 0, 0, 1], `the ${name} turned`)
  assert.equal(animator.mixer.stats.actions.inUse, 1)
  animator.setLayers([{ clip: layer, weight: 1 }])
  animator.update(1 / 60)
  sameAs(rotations(rig), posed(sitting), 1e-12, 'Sitting as a layer over the neutral pose')
  animator.setLayers([{ clip: layer, weight: 0.5 }])
  animator.update(1 / 60)
  rotations(rig).forEach((rotation, n) => {
    const whole = posed(sitting)[n].angleTo(new Quaternion())
    assert.ok(Math.abs(rotation.angleTo(new Quaternion()) - whole / 2) < 1e-6, `the ${jointNames[n]} isn't halfway at a half`)
  })
  animator.setLayers([])
  animator.update(1 / 60)
  for (const name of jointNames) assert.ok(apart(rig.bones[name].quaternion, new Quaternion()) === 0, `the ${name} kept its layer`)
  assert.equal(animator.mixer.stats.actions.inUse, 1)
})

void test('speed 0 holds the pose, a paused clip holds, and a step moves it on one thirtieth of a second', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  animator.play(swing)
  animator.update(0)
  sameAs(rotations(rig), posed(swing, 0), 0, 'The clip at its start')
  frames(animator, 0.1, 3)
  sameAs(rotations(rig), posed(swing, 0.3), 1e-9, 'The clip at 0.3 s')
  animator.setSpeed(0)
  assert.equal(animator.moving, true)
  animator.update(0.1)
  assert.equal(animator.moving, false)
  const held = rotations(rig)
  frames(animator, 0.1, 20)
  sameAs(rotations(rig), held, 0, 'The clip at speed 0')

  animator.setSpeed(1)
  animator.setPlaying(false)
  frames(animator, 0.1, 20)
  sameAs(rotations(rig), held, 0, 'The clip paused')
  assert.equal(animator.moving, false)
  animator.step()
  assert.equal(animator.moving, true)
  animator.update(0.1)
  sameAs(rotations(rig), posed(swing, 0.3 + stepSeconds), 1e-9, 'The clip a step on')
  animator.setPlaying(true)
  animator.setSpeed(0.5)
  frames(animator, 0.1, 2)
  sameAs(rotations(rig), posed(swing, 0.3 + stepSeconds + 0.1), 1e-9, 'The clip at half speed')
})

void test("a clip's end is its start: after a whole loop it is where it began", () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  for (const clip of [swing]) {
    const { name } = clip
    animator.play(clip, true)
    animator.update(0)
    const start = rotations(rig)
    const count = Math.round(clip.duration * 60)
    frames(animator, clip.duration / count, count)
    sameAs(rotations(rig), start, 1e-9, `The ${name} a loop on`)
    // Stepping a whole loop round by single steps
    animator.setPlaying(false)
    for (let n = 0; n < Math.round(clip.duration / stepSeconds); n++) animator.step()
    animator.update(0)
    sameAs(rotations(rig), start, 1e-9, `The ${name} stepped a loop on`)
    animator.setPlaying(true)
  }
})

void test('a pose of one key, looping, keeps a finite time and its pose', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  const sitting = library('sitting')
  animator.play(sitting)
  frames(animator, 0.7, 200)
  const action = animator.mixer.existingAction(sitting)
  assert.ok(action)
  assert.ok(Number.isFinite(action.time) && action.time >= 0 && action.time < poseLength, `its time is ${action.time}`)
  sameAs(rotations(rig), posed(sitting), 0, 'Sitting, 140 s on')
  // Held still, it doesn't ask to be drawn again
  assert.equal(animator.moving, false)
})

void test('letting the animator go leaves the bones in the neutral pose and the mixer holding nothing', () => {
  const rig = skeleton()
  const animator = createAnimator(rig.root)
  animator.play(swing)
  animator.setLayers([{ clip: layerClip(library('arms-out')), weight: 0.5 }])
  frames(animator, 0.1, 5)
  animator.dispose()
  for (const name of jointNames) assert.deepEqual(rig.bones[name].quaternion.toArray(), [0, 0, 0, 1], `the ${name} wasn't let go`)
  assert.equal(animator.mixer.stats.actions.inUse, 0)
  assert.equal(animator.mixer.stats.bindings.inUse, 0)
})

// A clip has a track for every joint, named for its bone, so every motion binds every bone and none goes unbound
void test('every track of a clip binds to a bone of the skeleton', () => {
  const rig = skeleton()
  for (const clip of [swing]) {
    const joints: string[] = clip.tracks.map((track) => track.name.replace('.quaternion', ''))
    assert.deepEqual(joints, [...jointNames])
    const animator = createAnimator(rig.root)
    animator.play(clip)
    assert.equal(animator.mixer.stats.bindings.inUse, jointNames.length)
    animator.dispose()
  }
})
