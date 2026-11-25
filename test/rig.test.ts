import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Quaternion, Vector3 } from 'three'
import {
  boneEnd,
  byJoint,
  chainNames,
  endNames,
  jointNames,
  limitsOf,
  mirrorOf,
  readRig,
  scanAngles,
  scanFrames,
  sceneDirection,
  scenePoint,
  skeletonShape,
  type JointName,
  type Rig,
} from '../src/rig/rig.ts'
import { cellIndex, isBodyVoxel, readVolume, type SceneAxes, type Triple } from '../src/volume/format.ts'

// The rig (src/rig/rig.ts): the reading of a rig file, the skeleton's shape and limits, and the frames that turn the
// neutral pose into the scan's; and the male's rig as committed, data/male/rig.json, against his 4 mm volume

const maleAxes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } }
const maleText = readFileSync(new URL('../data/male/rig.json', import.meta.url), 'utf8')
const male = readRig(JSON.parse(maleText))

// The male's rig file parsed afresh with one change made to it, for the refusals
interface RigJson {
  joints: Record<string, Record<string, unknown>>
  ends: Record<string, unknown>
}
function changed(change: (json: RigJson) => void): unknown {
  const json: RigJson = JSON.parse(maleText)
  change(json)
  return json
}

const close = (a: Vector3, b: Vector3, tolerance = 1e-6) => a.distanceTo(b) <= tolerance

void test('every joint but the root has its parent before it, and every chain is joined to the trunk', () => {
  const seen = new Set<JointName>()
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    if (parent === null) assert.equal(name, 'hips')
    else assert.ok(seen.has(parent), `${name}'s parent ${parent} comes after it`)
    seen.add(name)
  }
  for (const chain of chainNames) {
    const members = jointNames.filter((name) => skeletonShape[name].chain === chain)
    assert.ok(members.length > 0, `${chain} has no joints`)
    // A chain's first joint hangs from the trunk, or is the trunk's root
    const first = skeletonShape[members[0]].parent
    assert.ok(first === null || skeletonShape[first].chain === 'trunk', `${chain} hangs from ${first}`)
  }
  // Every last bone has an end, and every end a last bone
  const last = jointNames.filter((name) => skeletonShape[name].child === null)
  assert.deepEqual([...last].sort(), [...endNames].sort())
})

void test("a right joint's limits mirror its left's: the same about x, the other way about y and z", () => {
  const pairs = jointNames.filter((name) => name.startsWith('left'))
  for (const left of pairs) {
    const right = mirrorOf(left)
    assert.ok(right.startsWith('right'))
    const l = limitsOf(left)
    const r = limitsOf(right)
    assert.ok(l && r)
    assert.deepEqual(r.x, l.x)
    assert.deepEqual(r.y, [-l.y[1], -l.y[0]])
    assert.deepEqual(r.z, [-l.z[1], -l.z[0]])
  }
  assert.equal(limitsOf('hips'), null)
})

void test('a rig file is refused where it lacks a joint or an end, or holds one no skeleton has', () => {
  assert.throws(() => readRig(changed((json) => delete json.joints.leftShin)), /male's leftShin is missing/)
  assert.throws(() => readRig(changed((json) => (json.joints.tail = { at: [0, 0, 0] }))), /joint no skeleton has, tail/)
  assert.throws(() => readRig(changed((json) => delete json.ends.head)), /head end isn't three numbers/)
  assert.throws(() => readRig(changed((json) => (json.ends.leftFinger = [0, 0, 0]))), /end no skeleton has, leftFinger/)
  assert.throws(() => readRig(changed((json) => (json.joints.neck.at = [1, 2]))), /neck's place isn't three numbers/)
  assert.throws(() => readRig(changed((json) => (json.joints.neck.at = [1, 2, 'x']))), /neck's place isn't three numbers/)
  assert.throws(() => readRig({ body: '', joints: {}, ends: {} }), /names no body/)
})

void test("a rig file is refused where a facing or a ball is missing, or given to a joint that hasn't one", () => {
  assert.throws(() => readRig(changed((json) => delete json.joints.leftForearm.facing)), /leftForearm's facing isn't three numbers/)
  assert.throws(() => readRig(changed((json) => (json.joints.leftForearm.facing = [0, 0, 0]))), /leftForearm faces no way/)
  assert.throws(() => readRig(changed((json) => (json.joints.chest.facing = [0, 1, 0]))), /chest takes no facing/)
  assert.throws(() => readRig(changed((json) => delete json.joints.rightThigh.ball)), /rightThigh's ball isn't a radius/)
  assert.throws(() => readRig(changed((json) => (json.joints.rightShin.ball = 20))), /rightShin isn't a ball joint/)
})

void test('the rig reads back as written', () => {
  assert.deepEqual(readRig(JSON.parse(JSON.stringify(male))), male)
})

void test('a direction takes the scene axes the volume gives, a point the level’s origin and the bounds’ centre too', () => {
  assert.deepEqual(sceneDirection(maleAxes, [1, 2, 3]).toArray(), [1, -3, 2])
  const turned: SceneAxes = { x: { source: 0, sign: -1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: -1 } }
  assert.deepEqual(sceneDirection(turned, [1, 2, 3]).toArray(), [-1, -3, -2])
  // A voxel's own centre, at the level's origin plus a whole number of voxels, lands where the levels place it
  const origin: Triple = [53.295, 33.495, -2.5]
  const level = { axes: maleAxes, origin }
  const at: Triple = [53.295 + 10 * 3.96, 33.495 + 4 * 3.96, -2.5 + 7 * 4]
  const center: Triple = [100, -200, 50]
  const expected = new Vector3(10 * 3.96 - 100, -7 * 4 + 200, 4 * 3.96 - 50)
  assert.ok(close(scenePoint(level, center, at), expected, 1e-9))
})

// The offset each joint's frame in the scan gives each child in the neutral pose: from the parent's joint to the
// child's, turned back by the parent's frame. The root's is none
function neutralOffsets(rig: Rig, frames: Record<JointName, Quaternion>) {
  return byJoint((name) => {
    const { parent } = skeletonShape[name]
    if (!parent) return new Vector3()
    const from = rig.joints[parent].at
    const to = rig.joints[name].at
    const offset = sceneDirection(maleAxes, [to[0] - from[0], to[1] - from[1], to[2] - from[2]])
    return offset.applyQuaternion(frames[parent].clone().invert())
  })
}

void test("the scan's frames are turns, none for the trunk, and take each limb's bone from the neutral pose to the scan's", () => {
  const frames = scanFrames(male, maleAxes)
  for (const name of jointNames) {
    const frame = frames[name]
    assert.ok(Math.abs(frame.length() - 1) < 1e-9, `${name}'s frame isn't a turn`)
    const { lie } = skeletonShape[name]
    if (lie === 'scanned') {
      assert.ok(frame.equals(new Quaternion()), `${name} is turned in the scan`)
      continue
    }
    const from = male.joints[name].at
    const to = boneEnd(male, name)
    const along = sceneDirection(maleAxes, [to[0] - from[0], to[1] - from[1], to[2] - from[2]]).normalize()
    const neutral = lie === 'down' ? new Vector3(0, -1, 0) : new Vector3(0, 0, 1)
    assert.ok(close(neutral.applyQuaternion(frame), along, 1e-9), `${name}'s frame doesn't take its bone to the scan's`)
  }
})

void test('in the neutral pose a limb hangs straight down from each of its joints, and its foot points straight forward', () => {
  const frames = scanFrames(male, maleAxes)
  const offsets = neutralOffsets(male, frames)
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    if (parent === null || skeletonShape[parent].lie === 'scanned' || skeletonShape[parent].child !== name) continue
    const offset = offsets[name]
    const length = offset.length()
    const expected = skeletonShape[parent].lie === 'down' ? new Vector3(0, -length, 0) : new Vector3(0, 0, length)
    assert.ok(close(offset, expected, 1e-6), `${name} isn't ${skeletonShape[parent].lie} from ${parent} in the neutral pose`)
  }
})

void test("posed as the scan, the skeleton puts every joint back where it was measured", () => {
  const frames = scanFrames(male, maleAxes)
  const offsets = neutralOffsets(male, frames)
  // Forward kinematics from the root, with each joint turned by its scan rotation from its parent
  const placed = byJoint(() => new Vector3())
  const world = byJoint(() => new Quaternion())
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    const local = parent ? frames[parent].clone().invert().multiply(frames[name]) : frames[name].clone()
    if (!parent) {
      placed[name] = sceneDirection(maleAxes, male.joints[name].at)
      world[name] = local
      continue
    }
    world[name] = world[parent].clone().multiply(local)
    placed[name] = placed[parent].clone().add(offsets[name].clone().applyQuaternion(world[parent]))
  }
  for (const name of jointNames) {
    assert.ok(close(placed[name], sceneDirection(maleAxes, male.joints[name].at), 1e-6), `${name} moved`)
    assert.ok(world[name].angleTo(frames[name]) < 1e-6, `${name} turned`)
  }
})

void test("the male's pose in the scan lies within every joint's limits", () => {
  const frames = scanFrames(male, maleAxes)
  for (const name of jointNames) {
    const limits = limitsOf(name)
    if (!limits) continue
    const angles = scanAngles(frames, name)
    ;(['x', 'y', 'z'] as const).forEach((axis, n) => {
      const [low, high] = limits[axis]
      assert.ok(angles[n] >= low && angles[n] <= high, `${name} turns ${angles[n].toFixed(1)}° about ${axis}, outside ${low} to ${high}`)
    })
  }
})

// The long bones, whose joints both lie at the ends of one bone. The clavicle's runs to the shoulder joint across the
// scapula, which sits where the shoulder's posture puts it: the male's left shoulder is drawn in 15 mm further than
// his right. A last bone's end is placed more loosely than a joint
const longBones = ['Arm', 'Forearm', 'Thigh', 'Shin', 'Foot'] as const

void test("the male's long bones are as long on his left as on his right, within the error of placing their joints by hand", () => {
  const length = (joint: JointName) => {
    const a = male.joints[joint].at
    const b = boneEnd(male, joint)
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  for (const left of longBones.map((bone): JointName => `left${bone}`)) {
    const right = mirrorOf(left)
    const ratio = length(left) / length(right)
    assert.ok(Math.abs(ratio - 1) < 0.06, `${left} is ${length(left).toFixed(0)} mm, ${right} ${length(right).toFixed(0)} mm`)
  }
})

void test('every one of the male’s joints lies in his body on the committed 4 mm level', () => {
  const volume = readVolume(new Uint8Array(gunzipSync(readFileSync(new URL('../public/volume/male-4mm.bin', import.meta.url)))))
  assert.equal(volume.body, 'male')
  for (const name of jointNames) {
    const grid = male.joints[name].at.map((mm, axis) => Math.round((mm - volume.origin[axis]) / volume.spacing[axis]))
    const [i, j, k] = grid
    assert.ok(isBodyVoxel(volume.coverage[cellIndex(volume.size, i, j, k)]), `${name} lies outside the body`)
  }
})
