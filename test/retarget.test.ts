import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { AnimationClip, Bone, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { readAnglePose, rotationsOfAngles } from '../src/motion/angles.ts'
import { clipOf, readMotionFile, writeBakedClip, type BakedClip, type BakedTrack } from '../src/motion/clip.ts'
import { readSourceRig, restPoseName, restRotations, retargetClip, settle, skeletonOfBones, sourceClipOf, worstPastLimits } from '../src/motion/retarget.ts'
import { bindSkeleton } from '../src/rig/pose.ts'
import { byJoint, jointNames, readRig, skeletonShape, type JointName } from '../src/rig/rig.ts'
import { applyPose, createRigSkeleton } from '../src/rig/skeleton.ts'
import type { SceneAxes, Triple } from '../src/volume/format.ts'

// Retargeting (src/motion/retarget.ts) on skeletons built here from three's bones, as the page's loaders leave them:
// a T-posed source with Mixamo's names and bone axes of its own comes onto this rig's T-pose; a turn of a source's
// bone turns this rig's the same way in the world; the hips keep their turn and lose their travel; bones this rig
// hasn't got are passed over, and a source with no hips refused; a baked clip is written and read back whole

const library = new URL('../public/motion/', import.meta.url)
const tPose = rotationsOfAngles(readAnglePose(JSON.parse(readFileSync(new URL('t-pose.json', library), 'utf8')), 't-pose.json'))
const maleAxes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } }
const male = readRig(JSON.parse(readFileSync(new URL('../data/male/rig.json', import.meta.url), 'utf8')))
const bound = bindSkeleton(male, { axes: maleAxes, origin: [0, 0, 0], center: [0, 0, 0] })

const degreesApart = (a: Quaternion, b: Quaternion) => (a.angleTo(b) * 180) / Math.PI

// A T-posed source skeleton in metres, facing +z with its left along +x, each bone at a place in its world and turned
// as a Mixamo bone is, its y along the bone toward the next, then twisted about it by an angle of its own, so that
// its axes are nothing like this rig's. Its root is held by an armature that may turn the whole and scale it
interface Planned {
  name: string
  parent: string | null
  at: Triple
  // Where its own y points, toward its child or on along its parent's
  toward: Triple
}
const plan: Planned[] = [
  { name: 'Hips', parent: null, at: [0, 1, 0], toward: [0, 1.1, 0] },
  { name: 'Spine', parent: 'Hips', at: [0, 1.1, 0], toward: [0, 1.2, 0] },
  { name: 'Spine1', parent: 'Spine', at: [0, 1.2, 0], toward: [0, 1.35, 0] },
  { name: 'Spine2', parent: 'Spine1', at: [0, 1.35, 0], toward: [0, 1.5, 0] },
  { name: 'Neck', parent: 'Spine2', at: [0, 1.5, 0], toward: [0, 1.6, 0] },
  { name: 'Head', parent: 'Neck', at: [0, 1.6, 0], toward: [0, 1.8, 0] },
  { name: 'HeadTop_End', parent: 'Head', at: [0, 1.8, 0], toward: [0, 1.9, 0] },
  ...(['Left', 'Right'] as const).flatMap((side): Planned[] => {
    const x = side === 'Left' ? 1 : -1
    return [
      { name: `${side}Shoulder`, parent: 'Spine2', at: [0.05 * x, 1.45, 0], toward: [0.18 * x, 1.45, 0] },
      { name: `${side}Arm`, parent: `${side}Shoulder`, at: [0.18 * x, 1.45, 0], toward: [0.45 * x, 1.45, 0] },
      { name: `${side}ForeArm`, parent: `${side}Arm`, at: [0.45 * x, 1.45, 0], toward: [0.7 * x, 1.45, 0] },
      { name: `${side}Hand`, parent: `${side}ForeArm`, at: [0.7 * x, 1.45, 0], toward: [0.8 * x, 1.45, 0] },
      { name: `${side}HandMiddle1`, parent: `${side}Hand`, at: [0.8 * x, 1.45, 0], toward: [0.85 * x, 1.45, 0] },
      { name: `${side}HandIndex1`, parent: `${side}Hand`, at: [0.8 * x, 1.45, 0.03], toward: [0.85 * x, 1.45, 0.03] },
      { name: `${side}UpLeg`, parent: 'Hips', at: [0.1 * x, 0.95, 0], toward: [0.1 * x, 0.5, 0] },
      { name: `${side}Leg`, parent: `${side}UpLeg`, at: [0.1 * x, 0.5, 0], toward: [0.1 * x, 0.08, 0] },
      { name: `${side}Foot`, parent: `${side}Leg`, at: [0.1 * x, 0.08, 0], toward: [0.1 * x, 0.08, 0.12] },
      { name: `${side}ToeBase`, parent: `${side}Foot`, at: [0.1 * x, 0.08, 0.12], toward: [0.1 * x, 0.08, 0.2] },
      { name: `${side}Toe_End`, parent: `${side}ToeBase`, at: [0.1 * x, 0.08, 0.2], toward: [0.1 * x, 0.08, 0.25] },
    ]
  }),
  { name: 'Tail', parent: 'Hips', at: [0, 1, -0.1], toward: [0, 0.8, -0.3] },
]

interface Built {
  armature: Object3D
  bones: Map<string, Bone>
  // Each bone's rest world rotation, in the armature's frame, as built
  world: Map<string, Quaternion>
}

function buildSource({ prefix = 'mixamorig', armature = new Quaternion(), scale = 1, leave = [] as string[] } = {}): Built {
  const holder = new Object3D()
  holder.quaternion.copy(armature)
  holder.scale.setScalar(scale)
  const bones = new Map<string, Bone>()
  const world = new Map<string, Quaternion>()
  plan.forEach((planned, n) => {
    if (leave.includes(planned.name)) return
    const along = new Vector3(...planned.toward).sub(new Vector3(...planned.at)).normalize()
    const turned = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along)
    // A twist about the bone of its own, so no two bones share their axes
    const rotation = turned.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4 + n * 0.7))
    const bone = new Bone()
    bone.name = `${prefix}${planned.name}`
    const parentBone = planned.parent ? bones.get(planned.parent) : undefined
    const parentWorld = planned.parent ? world.get(planned.parent) : undefined
    const parentAt = plan.find((each) => each.name === planned.parent)?.at
    if (parentBone && parentWorld && parentAt) {
      const inverse = parentWorld.clone().invert()
      bone.position.copy(new Vector3(...planned.at).sub(new Vector3(...parentAt)).applyQuaternion(inverse))
      bone.quaternion.copy(inverse.multiply(rotation))
      parentBone.add(bone)
    } else {
      bone.position.set(...planned.at)
      bone.quaternion.copy(rotation)
      holder.add(bone)
    }
    bones.set(planned.name, bone)
    world.set(planned.name, rotation)
  })
  return { armature: holder, bones, world }
}

// Each joint's world rotation in a pose, from its rotations from its parents
const worldOf = (rotations: Record<JointName, Quaternion>) => {
  const world = byJoint(() => new Quaternion())
  for (const joint of jointNames) {
    const { parent } = skeletonShape[joint]
    world[joint] = parent ? world[parent].clone().multiply(rotations[joint]) : rotations[joint].clone()
  }
  return world
}
const neutralBone = (joint: JointName) => (skeletonShape[joint].lie === 'forward' ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0))

// The male's wrists, as a pose's rotations put them
const handsOf = (rotations: Record<JointName, Quaternion>) => {
  const rig = createRigSkeleton(bound)
  applyPose(rig, { rotations, root: bound.offsets.hips.clone() })
  return (['leftHand', 'rightHand'] as const).map((hand) => new Vector3().setFromMatrixPosition(rig.bones[hand].matrixWorld))
}

// A baked clip's rotation of a joint at one of its key times
const keyOf = (clip: BakedClip, joint: JointName, key: number) => {
  const track = clip.tracks[joint]
  if (!track) throw new Error(`No track for the ${joint}`)
  const at = Math.min(key, track.times.length - 1) * 4
  return new Quaternion().fromArray(track.values.slice(at, at + 4))
}

void test("a T-posed source with Mixamo's names and axes of its own rests in this rig's T-pose, the trunk left as it is", () => {
  // Upright as built, and as an exporter with z up and centimetres leaves it, the armature turned and scaled
  const upright = buildSource()
  const zUp = buildSource({ armature: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), scale: 100 })
  for (const source of [upright, zUp]) {
    const skeleton = skeletonOfBones(source.armature)
    const rig = readSourceRig(skeleton)
    assert.equal(rig.table.source, 'Mixamo')
    assert.ok(rig.square, "the source's frame is taken square to its axes")
    assert.match(restPoseName(rig), /^a T-pose/)
    const rest = restRotations(skeleton, rig)
    for (const joint of jointNames) {
      const apart = degreesApart(rest[joint], tPose[joint])
      if (skeletonShape[joint].lie === 'scanned') assert.ok(apart < 1e-4, `the ${joint} is turned ${apart}°, where it should be left as it is`)
      else assert.ok(apart <= 2, `the ${joint} is ${apart.toFixed(2)}° from the T-pose's`)
    }
    // Each limb's bone lies the way the source's does at rest
    const world = worldOf(rest)
    for (const joint of jointNames) {
      const entry = rig.directions[joint]
      if (!entry) continue
      const along = neutralBone(joint).applyQuaternion(world[joint])
      assert.ok((along.angleTo(entry.direction) * 180) / Math.PI < 1e-4, `the ${joint} points as the source's does`)
    }
    // And so the hands stand where the T-pose puts them, on the male
    const placed = handsOf(rest)
    handsOf(tPose).forEach((hand, n) => assert.ok(hand.distanceTo(placed[n]) < 1, `hand ${n + 1} is ${hand.distanceTo(placed[n]).toFixed(2)} mm off`))
  }
})

void test("a source's arm swung forward a right angle from its rest swings this rig's the same way", () => {
  const source = buildSource()
  const arm = source.bones.get('LeftArm')
  const armWorld = source.world.get('LeftArm')
  const shoulderWorld = source.world.get('LeftShoulder')
  if (!arm || !armWorld || !shoulderWorld) throw new Error('No left arm')
  // Turned in the world about the vertical, which takes the arm from out to the side to straight ahead
  const forward = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
  const swung = shoulderWorld.clone().invert().multiply(forward).multiply(armWorld)
  const clip = new AnimationClip('swing', 1, [new QuaternionKeyframeTrack(`${arm.name}.quaternion`, [0, 1], [...arm.quaternion.toArray(), ...swung.toArray()])])
  const skeleton = skeletonOfBones(source.armature)
  const baked = retargetClip(skeleton, sourceClipOf(clip)).clip
  const last = byJoint((joint) => keyOf(baked, joint, Number.MAX_SAFE_INTEGER))
  const world = worldOf(last)
  for (const joint of ['leftArm', 'leftForearm', 'leftHand'] as const) {
    const along = neutralBone(joint).applyQuaternion(world[joint])
    assert.ok(along.distanceTo(new Vector3(0, 0, 1)) < 1e-5, `the ${joint} points ${along.toArray().map((v) => v.toFixed(4)).join(', ')}, not forward`)
  }
  // The other arm, and the trunk, haven't moved
  for (const joint of ['rightArm', 'chest', 'leftShoulder'] as const) assert.ok(degreesApart(last[joint], keyOf(baked, joint, 0)) < 1e-4)
})

void test('the hips keep their turn and lose their travel, in the scene\'s axes whatever the source\'s', () => {
  const zUp = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  for (const armature of [new Quaternion(), zUp]) {
    const source = buildSource({ armature })
    const hips = source.bones.get('Hips')
    const hipsWorld = source.world.get('Hips')
    if (!hips || !hipsWorld) throw new Error('No hips')
    // A turn of 30° about the source's own up, toward its left, as it walks somewhere
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6)
    const turned = turn.clone().multiply(hipsWorld)
    const clip = new AnimationClip('turn', 2, [
      new QuaternionKeyframeTrack(`${hips.name}.quaternion`, [0, 2], [...hips.quaternion.toArray(), ...turned.toArray()]),
      new VectorKeyframeTrack(`${hips.name}.position`, [0, 2], [0, 1, 0, 3, 1, 4]),
    ])
    const baked = retargetClip(skeletonOfBones(source.armature), sourceClipOf(clip)).clip
    const hipsTrack = baked.tracks.hips
    assert.ok(hipsTrack)
    assert.deepEqual(Object.keys(hipsTrack), ['times', 'values'])
    assert.ok(degreesApart(keyOf(baked, 'hips', Number.MAX_SAFE_INTEGER), turn) < 1e-4, 'the hips turn as the source\'s do, about the scene\'s up')
    assert.ok(degreesApart(keyOf(baked, 'hips', 0), new Quaternion()) < 1e-4)
    // Everything beneath them goes with them, unturned from them
    assert.ok(degreesApart(keyOf(baked, 'spine', Number.MAX_SAFE_INTEGER), new Quaternion()) < 1e-4)
  }
})

void test("a bone this rig hasn't got is passed over, a joint the source hasn't got follows its parent, and a source with no hips, or nothing above them to stand it up by, is refused", () => {
  const source = buildSource()
  const skeleton = skeletonOfBones(source.armature)
  const rig = readSourceRig(skeleton)
  assert.ok(rig.unmapped.includes('mixamorigTail'))
  assert.ok(rig.unmapped.includes('mixamorigLeftHandIndex1'))
  const tail = source.bones.get('Tail')
  if (!tail) throw new Error('No tail')
  const wag = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1).multiply(tail.quaternion)
  const wagging = new AnimationClip('wag', 1, [new QuaternionKeyframeTrack(`${tail.name}.quaternion`, [0, 1], [...tail.quaternion.toArray(), ...wag.toArray()])])
  const still = new AnimationClip('still', 1, [new QuaternionKeyframeTrack(`${tail.name}.quaternion`, [0, 1], [...tail.quaternion.toArray(), ...tail.quaternion.toArray()])])
  assert.deepEqual(retargetClip(skeleton, sourceClipOf(wagging)).clip, retargetClip(skeleton, sourceClipOf(still)).clip)

  // With no toes, the toes stand as the foot does; the rest pose is a T-pose all the same
  const toeless = skeletonOfBones(buildSource({ leave: ['LeftToeBase', 'LeftToe_End'] }).armature)
  const toelessRig = readSourceRig(toeless)
  assert.equal(toelessRig.bones.leftToes, -1)
  assert.ok(degreesApart(restRotations(toeless, toelessRig).leftToes, new Quaternion()) < 1e-4)

  assert.throws(() => readSourceRig(skeletonOfBones(buildSource({ prefix: 'other:' }).armature)), /no hips this rig knows/)
  const hipless = buildSource()
  const hips = hipless.bones.get('Hips')
  if (!hips) throw new Error('No hips')
  hips.name = 'Root'
  assert.throws(() => readSourceRig(skeletonOfBones(hipless.armature)), /no hips this rig knows/)
  // With no neck, head or chest, which way is up can't be told
  const headless = skeletonOfBones(buildSource({ leave: ['Spine2', 'Neck', 'Head', 'HeadTop_End'] }).armature)
  assert.throws(() => readSourceRig(headless), /no Spine2, which says which way it faces/)
})

void test("the Quaternius library's names are read by their own table", () => {
  const names: Record<string, string> = {
    Hips: 'pelvis',
    Spine: 'spine_01',
    Spine1: 'spine_02',
    Spine2: 'spine_03',
    Neck: 'neck_01',
    LeftShoulder: 'clavicle_l',
    LeftArm: 'upperarm_l',
    LeftUpLeg: 'thigh_l',
    RightUpLeg: 'thigh_r',
  }
  const source = buildSource({ prefix: '' })
  for (const [from, to] of Object.entries(names)) {
    const bone = source.bones.get(from)
    if (bone) bone.name = to
  }
  const rig = readSourceRig(skeletonOfBones(source.armature))
  assert.equal(rig.table.source, 'Quaternius')
  assert.ok(rig.bones.hips >= 0 && rig.bones.leftArm >= 0 && rig.bones.rightThigh >= 0)
})

void test('a baked clip written and read back is the same to a millionth, and plays as baked', () => {
  const source = buildSource()
  const arm = source.bones.get('LeftArm')
  const forearm = source.bones.get('LeftForeArm')
  if (!arm || !forearm) throw new Error('No left arm')
  const bend = (bone: Bone, angle: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).premultiply(bone.quaternion).toArray()
  const clip = new AnimationClip('wave', 1.5, [
    new QuaternionKeyframeTrack(`${arm.name}.quaternion`, [0, 0.5, 1.5], [...arm.quaternion.toArray(), ...bend(arm, 0.6), ...arm.quaternion.toArray()]),
    new QuaternionKeyframeTrack(`${forearm.name}.quaternion`, [0, 0.75, 1.5], [...forearm.quaternion.toArray(), ...bend(forearm, 1.1), ...forearm.quaternion.toArray()]),
  ])
  const baked = retargetClip(skeletonOfBones(source.armature), sourceClipOf(clip)).clip
  assert.equal(baked.duration, 1.5)
  const text = writeBakedClip(baked, { label: 'a wave', source: 'built in a test' })
  const json: unknown = JSON.parse(text)
  assert.ok(typeof json === 'object' && json !== null && 'source' in json && json.source === 'built in a test')
  const read = readMotionFile(json, 'the baked clip')
  assert.equal(read.kind, 'baked')
  if (read.kind !== 'baked') return
  assert.equal(read.clip.duration, baked.duration)
  for (const joint of jointNames) {
    const written = baked.tracks[joint]
    const readBack: BakedTrack | undefined = read.clip.tracks[joint]
    assert.ok(written && readBack, `the ${joint} has a track`)
    assert.equal(readBack.times.length, written.times.length)
    readBack.times.forEach((time: number, n: number) => assert.ok(Math.abs(time - written.times[n]) <= 1e-6))
    readBack.values.forEach((value: number, n: number) => assert.ok(Math.abs(value - written.values[n]) <= 1e-6, `the ${joint}'s value ${n} moved`))
  }
  // A joint that never turns keeps one key; one that does, a key a frame
  assert.equal(read.clip.tracks.rightArm?.times.length, 1)
  assert.ok((read.clip.tracks.leftForearm?.times.length ?? 0) > 10)
  // And it plays: its clip has a track for every joint, the length the source's had
  const played = clipOf('wave', read)
  assert.equal(played.duration, 1.5)
  assert.equal(played.tracks.length, jointNames.length)
})

void test("a clip is baked at its keys' own rate, though three's FBX loader adds keys within the frames where an angle wraps round", () => {
  const source = buildSource()
  const arm = source.bones.get('LeftArm')
  const forearm = source.bones.get('LeftForeArm')
  if (!arm || !forearm) throw new Error('No left arm')
  const swung = (bone: Bone, time: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.sin(time * 3)).premultiply(bone.quaternion).toArray()
  const track = (bone: Bone, times: number[]) => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, times.flatMap((time) => swung(bone, time)))
  // Two seconds keyed thirty times a second, as Mixamo keys a clip, the forearm's track as the loader leaves one whose
  // angles wrap round, with a key more halfway through every fourth frame: by its count of keys, 38 a second
  const frames = Array.from({ length: 61 }, (_, n) => n / 30)
  const split = frames.flatMap((time, n) => (n > 0 && n % 4 === 0 ? [time - 1 / 60, time] : [time]))
  const clip = new AnimationClip('swing', 2, [track(arm, frames), track(forearm, split)])
  const baked = retargetClip(skeletonOfBones(source.armature), sourceClipOf(clip)).clip
  for (const joint of ['leftArm', 'leftForearm'] as const) {
    const times = baked.tracks[joint]?.times ?? []
    assert.equal(times.length, 61, `the ${joint} has ${times.length} keys`)
    times.forEach((time, n) => assert.ok(Math.abs(time - n / 30) <= 1e-6, `the ${joint}'s key ${n} is at ${time} s`))
  }
})

void test("a joint is measured against its limits by whichever of its two sets of angles lies nearer them", () => {
  const turned = (x: number, y: number, z: number) => {
    const rotation = rotationsOfAngles({ joints: { leftArm: [x, y, z] } }).leftArm
    return { duration: 1, tracks: { leftArm: { times: [0], values: rotation.toArray() } } }
  }
  assert.equal(worstPastLimits(turned(-90, 0, 0)).degrees, 0)
  // Swung 175° out is 5° past the arm's 170°, though its other angles, turned half round about x, lie further out
  const past = worstPastLimits(turned(0, 0, 175))
  assert.equal(past.joint, 'leftArm')
  assert.ok(Math.abs(past.degrees - 5) < 1e-6, `${past.degrees}`)
})

void test("an elbow or a knee bent sideways, or a hand twisted, is shared out without moving a bone, and what's left past the limits is held", () => {
  const pose = (joints: Partial<Record<JointName, Triple>>) => rotationsOfAngles({ joints })
  // The elbow bent forward 90° and swung 30° out, as another rig's may; the knee bent back 60° and 20° in; the hand
  // twisted 40° where the forearm should be
  const frame = pose({ leftArm: [-20, 0, 10], leftForearm: [-90, 0, 30], leftShin: [60, 0, -20], rightHand: [0, 40, 0] })
  const before = worldOf(frame)
  const { past, held } = settle(frame)
  const after = worldOf(frame)
  for (const joint of jointNames) {
    const a = neutralBone(joint).applyQuaternion(before[joint])
    const b = neutralBone(joint).applyQuaternion(after[joint])
    assert.ok((a.angleTo(b) * 180) / Math.PI < 1e-6, `the ${joint} moved`)
  }
  assert.deepEqual([past.degrees, held.degrees], [0, 0])
  const flat = { duration: 1, tracks: Object.fromEntries(jointNames.map((joint) => [joint, { times: [0], values: frame[joint].toArray() }])) }
  assert.ok(worstPastLimits(flat).degrees < 1e-6, `the ${worstPastLimits(flat).joint} is past its limits`)
  // The hand's twist is now the forearm's
  assert.ok(Math.abs(frame.rightHand.y) < 1e-9)

  // A foot pointed 70°, past the ankle's 55°, is held at 55°
  const pointed = pose({ leftFoot: [70, 0, 0] })
  const settled = settle(pointed)
  assert.equal(settled.past.joint, 'leftFoot')
  assert.ok(Math.abs(settled.past.degrees - 15) < 1e-6)
  assert.ok(Math.abs(settled.held.degrees - 15) < 1e-6)
  assert.ok(degreesApart(pointed.leftFoot, pose({ leftFoot: [55, 0, 0] }).leftFoot) < 1e-6)
})
