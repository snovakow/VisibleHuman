import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { anglesOfPose, readAnglePose, rotationsOfAngles, writeAnglePose, type AnglePose } from '../src/motion/angles.ts'
import { createAnimator } from '../src/motion/animator.ts'
import { clipOf, readMotionFile } from '../src/motion/clip.ts'
import { createLimbs, handleNames, limbChains, type HandleName, type Limbs } from '../src/motion/ik.ts'
import { readLibrary } from '../src/motion/library.ts'
import { bindSkeleton } from '../src/rig/pose.ts'
import { byJoint, jointNames, limitsOf, readRig, skeletonShape, type JointName } from '../src/rig/rig.ts'
import { createRigSkeleton, type RigSkeleton } from '../src/rig/skeleton.ts'
import type { SceneAxes } from '../src/volume/format.ts'

// The handles' inverse kinematics (src/motion/ik.ts) on the male's skeleton, over three's own CCD solver: the chains'
// shape and limits, reaching a target, holding every joint in its limits, the offsets a drag leaves over a motion,
// and a pose copied out as the library writes one

const maleAxes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } }
const male = readRig(JSON.parse(readFileSync(new URL('../data/male/rig.json', import.meta.url), 'utf8')))
const skeleton = (): RigSkeleton => createRigSkeleton(bindSkeleton(male, { axes: maleAxes, origin: [0, 0, 0], center: [0, 0, 0] }))
const libraryFile = (name: string) => readMotionFile(JSON.parse(readFileSync(new URL(`../public/motion/${name}.json`, import.meta.url), 'utf8')), name)
const libraryPose = (name: string): AnglePose => {
  const file = libraryFile(name)
  if (file.kind !== 'pose') throw new Error(`The ${name} isn't a pose`)
  return file.pose
}
// The library's poses, each by its name
const libraryPoses = readLibrary(JSON.parse(readFileSync(new URL('../public/motion/index.json', import.meta.url), 'utf8')))
  .map((entry) => entry.id)
  .filter((name) => libraryFile(name).kind === 'pose')

// Puts the skeleton in a pose's rotations, the world matrices brought up to date, as the mixer and the stage leave it
const pose = (rig: RigSkeleton, rotations: Record<JointName, Quaternion>) => {
  for (const name of jointNames) rig.bones[name].quaternion.copy(rotations[name])
  rig.root.updateMatrixWorld(true)
}
const placeOf = (rig: RigSkeleton, joint: JointName) => new Vector3().setFromMatrixPosition(rig.bones[joint].matrixWorld)
// One frame of a drag: the motion's rotations set again, as the mixer sets them, then the limbs over them
const frame = (rig: RigSkeleton, limbs: Limbs, rotations: Record<JointName, Quaternion>) => {
  pose(rig, rotations)
  limbs.apply()
  rig.root.updateMatrixWorld(true)
}
const degrees = (radians: number) => (radians * 180) / Math.PI
// How far, in degrees, each joint stands outside its limits, the worst of them
const pastLimits = (rig: RigSkeleton) => {
  let worst = 0
  for (const name of jointNames) {
    const limits = limitsOf(name)
    if (!limits) continue
    const turn = new Euler().setFromQuaternion(rig.bones[name].quaternion, 'XYZ')
    for (const [axis, angle] of [['x', turn.x], ['y', turn.y], ['z', turn.z]] as const) {
      const [least, most] = limits[axis]
      worst = Math.max(worst, least - degrees(angle), degrees(angle) - most)
    }
  }
  return worst
}

void test("each chain runs from the wrist's or the ankle's parent up, each link the parent of the one before", () => {
  const chains = limbChains()
  assert.deepEqual(
    chains.map((chain) => chain.handle),
    [...handleNames],
  )
  const targets = new Set<number>()
  for (const chain of chains) {
    assert.equal(jointNames[chain.effector], chain.handle)
    assert.ok(chain.target >= jointNames.length, `the ${chain.handle}'s target is one of the rig's own bones`)
    targets.add(chain.target)
    let child: JointName = chain.handle
    for (const link of chain.links) {
      assert.equal(skeletonShape[child].parent, link.joint, `the ${link.joint} isn't the ${child}'s parent`)
      assert.equal(jointNames[link.index], link.joint)
      child = link.joint
    }
  }
  assert.equal(targets.size, handleNames.length)
  assert.deepEqual(
    chains.map((chain) => chain.links.map((link) => link.joint)),
    [
      ['leftForearm', 'leftArm', 'leftShoulder'],
      ['rightForearm', 'rightArm', 'rightShoulder'],
      ['leftShin', 'leftThigh'],
      ['rightShin', 'rightThigh'],
    ],
  )
})

void test("every link's limits are the rig's in radians, and the right side's mirror the left's", () => {
  const chains = limbChains()
  for (const chain of chains) {
    for (const link of chain.links) {
      const limits = limitsOf(link.joint)
      assert.ok(limits)
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.equal(link.rotationMin[axis], MathUtils.degToRad(limits[axis][0]), `${link.joint} ${axis}`)
        assert.equal(link.rotationMax[axis], MathUtils.degToRad(limits[axis][1]), `${link.joint} ${axis}`)
      }
    }
  }
  const [leftArm, rightArm, leftLeg, rightLeg] = chains
  for (const [left, right] of [
    [leftArm, rightArm],
    [leftLeg, rightLeg],
  ]) {
    left.links.forEach((link, n) => {
      const mirror = right.links[n]
      assert.equal(mirror.rotationMin.x, link.rotationMin.x)
      assert.equal(mirror.rotationMax.x, link.rotationMax.x)
      for (const axis of ['y', 'z'] as const) {
        assert.equal(mirror.rotationMin[axis], -link.rotationMax[axis], `${mirror.joint} ${axis}`)
        assert.equal(mirror.rotationMax[axis], -link.rotationMin[axis], `${mirror.joint} ${axis}`)
      }
    })
  }
})

void test("the solver's bones are the rig's 22 and a target for each handle, and the styles' skeleton keeps its 22", () => {
  const rig = skeleton()
  const limbs = createLimbs(rig)
  assert.equal(limbs.bones.length, jointNames.length + handleNames.length)
  jointNames.forEach((name, n) => assert.equal(limbs.bones[n], rig.bones[name]))
  for (const target of limbs.bones.slice(jointNames.length)) {
    assert.equal(target.parent, null)
    assert.ok(!rig.skeleton.bones.includes(target))
  }
  assert.equal(rig.skeleton.bones.length, jointNames.length)
})

// Solves once for a handle's target, from one pose of the library toward where another puts the handle
const solveOnce = (from: string, to: string, handle: HandleName) => {
  const rig = skeleton()
  pose(rig, rotationsOfAngles(libraryPose(to)))
  const goal = placeOf(rig, handle)
  const start = rotationsOfAngles(libraryPose(from))
  pose(rig, start)
  const limbs = createLimbs(rig)
  limbs.grab(handle)
  limbs.aim(goal)
  frame(rig, limbs, start)
  return { miss: placeOf(rig, handle).distanceTo(goal), rig }
}

// A straight leg drawn in one frame to a knee raised or bent to sit, or a bent one drawn straight, among them
void test('a target in reach brings the wrist or the ankle within 5 mm in one frame, from any pose of the library toward where any other puts it', () => {
  assert.ok(libraryPoses.includes('standing') && libraryPoses.includes('knee-up') && libraryPoses.includes('sitting'))
  for (const from of libraryPoses) {
    for (const to of libraryPoses) {
      if (to === from) continue
      for (const handle of handleNames) {
        const { miss } = solveOnce(from, to, handle)
        assert.ok(miss < 5, `the ${handle} toward ${to} from ${from} misses by ${miss.toFixed(2)} mm`)
      }
    }
  }
})

void test('a straight leg or arm folds to follow a handle drawn in toward it, step by step as a drag moves it', () => {
  for (const handle of handleNames) {
    const rig = skeleton()
    const standing = rotationsOfAngles(libraryPose('standing'))
    pose(rig, standing)
    const limbs = createLimbs(rig)
    const start = placeOf(rig, handle)
    limbs.grab(handle)
    // 150 steps of 3 mm, a pixel each at the page's opening view, straight up toward the shoulder or the hip
    let worst = 0
    for (let step = 1; step <= 150; step++) {
      const goal = start.clone().add(new Vector3(0, 3 * step, 0))
      limbs.aim(goal)
      frame(rig, limbs, standing)
      worst = Math.max(worst, placeOf(rig, handle).distanceTo(goal))
    }
    assert.ok(worst < 5, `the ${handle} drawn up 450 mm strays ${worst.toFixed(2)} mm from its target`)
  }
})

void test('a target out of reach leaves every joint within its limits', () => {
  for (const handle of handleNames) {
    for (const away of [new Vector3(3000, 0, 0), new Vector3(-3000, 0, 0), new Vector3(0, 3000, 0), new Vector3(0, -3000, 0), new Vector3(0, 0, 3000), new Vector3(0, 0, -3000)]) {
      const rig = skeleton()
      const start = rotationsOfAngles(libraryPose('sitting'))
      pose(rig, start)
      const limbs = createLimbs(rig)
      limbs.grab(handle)
      // Drawn out there over a few frames, as a drag past the limb's reach is
      for (let step = 1; step <= 10; step++) {
        limbs.aim(placeOf(rig, handle).add(away.clone().multiplyScalar(step / 10)))
        frame(rig, limbs, start)
      }
      const worst = pastLimits(rig)
      assert.ok(worst < 1e-6, `dragging the ${handle} toward ${away.toArray().join(', ')} leaves a joint ${worst}° past its limits`)
    }
  }
})

// The rotations of every joint, each as its four numbers
const rotations = (rig: RigSkeleton) => jointNames.map((name) => rig.bones[name].quaternion.toArray())

void test("what a drag leaves goes on over a clip as it plays, and clearing it gives back the clip's pose exactly", () => {
  const walk = clipOf('walk', libraryFile('walk'))
  const rig = skeleton()
  const limbs = createLimbs(rig)
  const animator = createAnimator(rig.root, limbs)
  // The same clip on a skeleton with no limbs to drag, for the clip's own pose at each moment
  const plain = skeleton()
  const reference = createAnimator(plain.root)
  for (const each of [animator, reference]) each.play(walk, true)
  const step = (seconds: number) => {
    animator.update(seconds)
    reference.update(seconds)
    rig.root.updateMatrixWorld(true)
  }
  step(0.2)
  assert.deepEqual(rotations(rig), rotations(plain))

  const hand = placeOf(rig, 'leftHand')
  limbs.grab('leftHand')
  limbs.aim(hand.clone().add(new Vector3(0, 150, 120)))
  step(0.05)
  const offsets = limbs.release()
  assert.deepEqual(Object.keys(offsets).sort(), ['leftArm', 'leftForearm', 'leftShoulder'])
  // The walk goes on with the arm raised over it, and the rest of him walking as he did
  step(0.3)
  const moved = rotations(rig)
  const clip = rotations(plain)
  jointNames.forEach((name, n) => {
    if (name in offsets) assert.notDeepEqual(moved[n], clip[n], `the ${name} isn't turned`)
    else assert.deepEqual(moved[n], clip[n], `the ${name} is turned`)
  })
  // Set again as they are, the offsets change nothing and wait on no frame
  limbs.setOffsets(offsets)
  assert.equal(limbs.pending, false)

  limbs.setOffsets({})
  assert.equal(animator.moving, true)
  step(0.1)
  assert.deepEqual(rotations(rig), rotations(plain))
})

void test('a drag let go over a pose leaves the animator still, so the bones turn only on a change', () => {
  const rig = skeleton()
  const limbs = createLimbs(rig)
  const animator = createAnimator(rig.root, limbs)
  animator.play(clipOf('arms-out', libraryFile('arms-out')), true)
  animator.update(1 / 60)
  rig.root.updateMatrixWorld(true)
  assert.equal(animator.moving, false)
  limbs.grab('rightFoot')
  assert.equal(animator.moving, false, 'a handle taken but not moved turns nothing')
  limbs.aim(placeOf(rig, 'rightFoot').add(new Vector3(0, 80, 60)))
  assert.equal(animator.moving, true)
  animator.update(1 / 60)
  assert.equal(animator.moving, false, 'a target held still turns nothing more')
  limbs.release()
  assert.equal(animator.moving, false)
  // Frames that turn the bones for something else, a step asked for, lay the offsets over the pose afresh rather than
  // over the last frame's, though three's mixer leaves a bone whose clip holds still as it was
  rig.root.updateMatrixWorld(true)
  const held = rotations(rig)
  for (let n = 0; n < 5; n++) {
    animator.step()
    animator.update(1 / 60)
  }
  assert.deepEqual(rotations(rig), held)
})

void test('a pose copied out reads back as the same rotations to a tenth of a degree', () => {
  const { rig } = solveOnce('standing', 'arms-out', 'leftHand')
  const copied = anglesOfPose({ rotations: byJoint((name) => rig.bones[name].quaternion), root: rig.root.position })
  const text = writeAnglePose(copied)
  const read = rotationsOfAngles(readAnglePose(JSON.parse(text), 'the copied pose'))
  assert.ok(Object.keys(copied.joints).length > 0)
  for (const name of jointNames) {
    const apart = degrees(read[name].angleTo(rig.bones[name].quaternion))
    assert.ok(apart <= 0.1, `the ${name} comes back ${apart.toFixed(3)}° from where it stood`)
  }
  assert.equal(writeAnglePose({ joints: {} }), '{ "joints": {} }\n')
})
