import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SceneAxes, Triple } from '../volume/format.ts'

// The rig: the skeleton a body is posed by, measured from its own CT and written by hand into data/<body>/rig.json.
// Its joints are where its bones meet, in the source frame's millimetres, the volume file's frame before any level's
// grid is laid on it, so that one rig serves every level of the body. The skeleton's shape is the same for every
// body and lives here: which joints there are, which is whose parent, which chain of the body each belongs to, and
// how far each may turn. What's measured, and so what the file holds, is where each joint is, which way a limb's bone
// faces about its own length, the size of the ball joints' heads, and where each last bone ends.
//
// Every joint's frame is the body's own axes in the neutral pose: standing, the trunk and the head as the scan holds
// them, the arms hanging straight down with the palms toward the thighs and the thumbs forward, the legs straight
// down with the kneecaps forward, the feet and the toes pointing straight forward. A joint's rotation is zero there,
// so a clip's rotations, the IK's limits and the scan's own pose are all rotations from that one pose. The scan's
// pose is the one the body was frozen in: the trunk and the clavicles as they lie, which is the neutral pose's, and
// each limb turned from hanging to where its bones are, about each bone's length by the way it faces

// The joints, each after its parent
export const jointNames = [
  'hips',
  'spine',
  'spine1',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftArm',
  'leftForearm',
  'leftHand',
  'rightShoulder',
  'rightArm',
  'rightForearm',
  'rightHand',
  'leftThigh',
  'leftShin',
  'leftFoot',
  'leftToes',
  'rightThigh',
  'rightShin',
  'rightFoot',
  'rightToes',
] as const
export type JointName = (typeof jointNames)[number]

// The bones that end in no joint, by the joint they start at: the head at its crown, each hand at its fingers and each
// foot's toes at their tips
export const endNames = ['head', 'leftHand', 'rightHand', 'leftToes', 'rightToes'] as const
export type EndName = (typeof endNames)[number]

export const isJointName = (name: string): name is JointName => (jointNames as readonly string[]).includes(name)
export const isEndName = (name: string): name is EndName => (endNames as readonly string[]).includes(name)

// A value for every joint, or every end, each made from its name. They're listed by name, as a loop over the names
// can't be typed as a record of them
export function byJoint<T>(make: (name: JointName) => T): Record<JointName, T> {
  return {
    hips: make('hips'),
    spine: make('spine'),
    spine1: make('spine1'),
    chest: make('chest'),
    neck: make('neck'),
    head: make('head'),
    leftShoulder: make('leftShoulder'),
    leftArm: make('leftArm'),
    leftForearm: make('leftForearm'),
    leftHand: make('leftHand'),
    rightShoulder: make('rightShoulder'),
    rightArm: make('rightArm'),
    rightForearm: make('rightForearm'),
    rightHand: make('rightHand'),
    leftThigh: make('leftThigh'),
    leftShin: make('leftShin'),
    leftFoot: make('leftFoot'),
    leftToes: make('leftToes'),
    rightThigh: make('rightThigh'),
    rightShin: make('rightShin'),
    rightFoot: make('rightFoot'),
    rightToes: make('rightToes'),
  }
}

export function byEnd<T>(make: (name: EndName) => T): Record<EndName, T> {
  return { head: make('head'), leftHand: make('leftHand'), rightHand: make('rightHand'), leftToes: make('leftToes'), rightToes: make('rightToes') }
}

// A left joint's right counterpart, or a right joint's left, or the joint itself on the trunk
export function mirrorOf(joint: JointName): JointName {
  const swapped = joint.startsWith('left') ? `right${joint.slice(4)}` : joint.startsWith('right') ? `left${joint.slice(5)}` : joint
  if (!isJointName(swapped)) throw new Error(`The ${joint} has no counterpart`)
  return swapped
}

// The parts of the body the rig is grouped into: the trunk, which holds the head and the shoulder girdles, whose
// clavicles and scapulae lie in the trunk's flesh, and each limb from its ball joint on. Two chains touch where a limb
// lies against the trunk or another limb in the scan, along the walls that part them there; a limb is joined to the
// trunk only around its ball joint, where its flesh runs on into the trunk's
export const chainNames = ['trunk', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const
export type Chain = (typeof chainNames)[number]

// How a joint's bone lies in the neutral pose: as the scan holds it, for the trunk, the head and the clavicles; straight
// down, for a limb's long bones and the hands; straight forward, for the feet and the toes
export type Lie = 'scanned' | 'down' | 'forward'

interface JointShape {
  parent: JointName | null
  chain: Chain
  lie: Lie
  // The joint its bone runs to, which sets the bone's length and direction, or none for a last bone, which runs to its
  // end. The hips' bone runs to the spine's joint, which only the rig's drawings use
  child: JointName | null
}

const shape = (parent: JointName | null, chain: Chain, lie: Lie, child: JointName | null): JointShape => ({ parent, chain, lie, child })

export const skeletonShape: Record<JointName, JointShape> = {
  hips: shape(null, 'trunk', 'scanned', 'spine'),
  spine: shape('hips', 'trunk', 'scanned', 'spine1'),
  spine1: shape('spine', 'trunk', 'scanned', 'chest'),
  chest: shape('spine1', 'trunk', 'scanned', 'neck'),
  neck: shape('chest', 'trunk', 'scanned', 'head'),
  head: shape('neck', 'trunk', 'scanned', null),
  leftShoulder: shape('chest', 'trunk', 'scanned', 'leftArm'),
  leftArm: shape('leftShoulder', 'leftArm', 'down', 'leftForearm'),
  leftForearm: shape('leftArm', 'leftArm', 'down', 'leftHand'),
  leftHand: shape('leftForearm', 'leftArm', 'down', null),
  rightShoulder: shape('chest', 'trunk', 'scanned', 'rightArm'),
  rightArm: shape('rightShoulder', 'rightArm', 'down', 'rightForearm'),
  rightForearm: shape('rightArm', 'rightArm', 'down', 'rightHand'),
  rightHand: shape('rightForearm', 'rightArm', 'down', null),
  leftThigh: shape('hips', 'leftLeg', 'down', 'leftShin'),
  leftShin: shape('leftThigh', 'leftLeg', 'down', 'leftFoot'),
  leftFoot: shape('leftShin', 'leftLeg', 'forward', 'leftToes'),
  leftToes: shape('leftFoot', 'leftLeg', 'forward', null),
  rightThigh: shape('hips', 'rightLeg', 'down', 'rightShin'),
  rightShin: shape('rightThigh', 'rightLeg', 'down', 'rightFoot'),
  rightFoot: shape('rightShin', 'rightLeg', 'forward', 'rightToes'),
  rightToes: shape('rightFoot', 'rightLeg', 'forward', null),
}

// How far a joint may turn from the neutral pose, in degrees, as the least and the most of each of its Euler angles in
// three's default order, X then Y then Z, about its own axes: x across the body from its right to its left, y up and
// z toward its front, as they stand in the neutral pose. For a bone that hangs, a turn about x is its swing forward
// (negative) or back, about y its twist and about z its swing out to the side; for a bone that points forward, about
// x its pitch down (positive) or up, about y its swing in or out and about z its roll. These are the left side's and
// the trunk's; a right joint's are their mirror image, which keeps x and turns y and z the other way. The ranges are
// a healthy adult's, a little inside what a joint can reach, so that a solved pose stays a likely one. A hinge, or a
// turn the joint hardly has, keeps 5 to 10° of play, as much as the scan's own pose, measured by hand, strays from it
type Range = readonly [number, number]
export interface Limits {
  x: Range
  y: Range
  z: Range
}

const leftAndTrunkLimits: Record<string, Limits> = {
  // The lumbar spine bends forward more than back and turns little; the thorax, one rigid piece with its ribs, turns
  // more about the spine's lower end
  spine: { x: [-20, 30], y: [-10, 10], z: [-15, 15] },
  spine1: { x: [-20, 30], y: [-10, 10], z: [-15, 15] },
  chest: { x: [-15, 25], y: [-20, 20], z: [-15, 15] },
  neck: { x: [-40, 45], y: [-50, 50], z: [-30, 30] },
  head: { x: [-25, 25], y: [-30, 30], z: [-15, 15] },
  // The clavicle, pointing out to the side: raised about z, drawn forward or back about y, and turned a little along
  // its length
  shoulder: { x: [-15, 15], y: [-25, 15], z: [-10, 30] },
  // The arm swings forward to 170° and back to 50°, out to 170°, and turns 90° either way
  arm: { x: [-170, 50], y: [-90, 90], z: [-20, 170] },
  // The elbow is a hinge that bends forward to 150°; the forearm's twist is its pronation and supination
  forearm: { x: [-150, 5], y: [-90, 90], z: [-5, 5] },
  // The wrist bends toward the palm or its back about z, since the palm faces in, and to the thumb's side or the little
  // finger's about x; it hardly twists, the forearm does
  hand: { x: [-20, 35], y: [-10, 10], z: [-80, 70] },
  // The hip swings forward to 125° and back to 30°, out to 50° and in to 30°, and turns 45° either way
  thigh: { x: [-125, 30], y: [-45, 45], z: [-30, 50] },
  // The knee is a hinge that bends back to 150°, with a little twist
  shin: { x: [-5, 150], y: [-20, 20], z: [-5, 5] },
  // The ankle points the foot down to 55° and up to 25°, swings it in or out and rolls it
  foot: { x: [-25, 55], y: [-20, 20], z: [-25, 25] },
  toes: { x: [-60, 40], y: [-10, 10], z: [-10, 10] },
}

const mirrored = ({ x, y, z }: Limits): Limits => ({ x, y: [-y[1], -y[0]], z: [-z[1], -z[0]] })

// A joint's limits, or none for the hips, which as the skeleton's root move freely
export function limitsOf(joint: JointName): Limits | null {
  if (joint === 'hips') return null
  const side = joint.startsWith('right') ? 'right' : joint.startsWith('left') ? 'left' : null
  const kind = side ? joint.slice(side.length).toLowerCase() : joint
  const limits = leftAndTrunkLimits[kind]
  if (!limits) throw new Error(`No limits are set for the ${joint}`)
  return side === 'right' ? mirrored(limits) : limits
}

export interface RigJoint {
  // The joint's centre in the source frame, in millimetres: along the slice image's columns and rows, from its
  // top-left pixel's centre, and along the slices from the plane of the body's first
  at: Triple
  // For a limb's joint, the way its bone faces about its own length in the scan, as a direction in the source frame,
  // which the rig takes square to the bone: for a bone that hangs in the neutral pose, the way its front faces, which
  // for the arm is the way the elbow bends and for the forearm and the hand the thumb's side; for a foot and its toes,
  // the way their top faces
  facing?: Triple
  // For a ball joint, the hip's and the shoulder's, the radius of its head's round surface in millimetres, at the joint
  // space around it, inside which the bone belongs to the limb rather than to the socket around it
  ball?: number
  // For a ball joint, the radius in millimetres within which the limb's flesh runs on into the trunk's: the armpit and
  // the shoulder, the groin and the buttock. Where the limb lies against the trunk or another limb further out, a wall
  // parts them
  joined?: number
  // More segments, each from one point to another in the source frame, along which the joint's part of the body runs,
  // beside its bone's own from the joint to the next: the pelvis's wings and the ribcage's sides, say, so that every
  // place in a chain is nearest the part it belongs to
  seeds?: (readonly [Triple, Triple])[]
}

export interface Rig {
  // The body's id, as its volume file names it
  body: string
  joints: Record<JointName, RigJoint>
  // Where each last bone ends, in the source frame
  ends: Record<EndName, Triple>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function point(value: unknown, where: string): Triple {
  const [a, b, c]: unknown[] = Array.isArray(value) && value.length === 3 ? value : []
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || !isFiniteNumber(c)) throw new Error(`${where} isn't three numbers`)
  return [a, b, c]
}

// The limbs' joints, whose bones have a way to face, and the ball joints, which have a head's radius
const facingJoints = new Set(jointNames.filter((name) => skeletonShape[name].lie !== 'scanned'))
const ballJoints = new Set<JointName>(['leftArm', 'rightArm', 'leftThigh', 'rightThigh'])

// Reads a rig file's parsed JSON, throwing a clear error where it isn't a whole rig: every joint and every end, a
// facing for each limb's joint and none for the trunk's, a ball's radius for each ball joint, and nothing else
export function readRig(json: unknown): Rig {
  if (!isRecord(json)) throw new Error("The rig isn't an object")
  const { body, joints, ends } = json
  if (typeof body !== 'string' || body === '') throw new Error('The rig names no body')
  if (!isRecord(joints)) throw new Error(`The ${body}'s rig has no joints`)
  if (!isRecord(ends)) throw new Error(`The ${body}'s rig has no ends`)
  for (const name of Object.keys(joints)) {
    if (!(jointNames as readonly string[]).includes(name)) throw new Error(`The ${body}'s rig has a joint no skeleton has, ${name}`)
  }
  for (const name of Object.keys(ends)) {
    if (!(endNames as readonly string[]).includes(name)) throw new Error(`The ${body}'s rig has an end no skeleton has, ${name}`)
  }
  const read = byJoint((name): RigJoint => {
    const where = `The ${body}'s ${name}`
    const value = joints[name]
    if (!isRecord(value)) throw new Error(`${where} is missing`)
    const joint: RigJoint = { at: point(value.at, `${where}'s place`) }
    if (facingJoints.has(name)) {
      const facing = point(value.facing, `${where}'s facing`)
      if (Math.hypot(...facing) === 0) throw new Error(`${where} faces no way`)
      joint.facing = facing
    } else if (value.facing !== undefined) throw new Error(`${where} takes no facing: its bone lies as the scan holds it`)
    if (ballJoints.has(name)) {
      const { ball, joined } = value
      if (typeof ball !== 'number' || !(ball > 0)) throw new Error(`${where}'s ball isn't a radius`)
      joint.ball = ball
      if (joined !== undefined) {
        if (typeof joined !== 'number' || !(joined > ball)) throw new Error(`${where}'s joined radius isn't one beyond its ball's`)
        joint.joined = joined
      }
    } else if (value.ball !== undefined || value.joined !== undefined) throw new Error(`${where} isn't a ball joint`)
    const { seeds } = value
    if (seeds !== undefined) {
      if (!Array.isArray(seeds)) throw new Error(`${where}'s seeds aren't a list`)
      joint.seeds = seeds.map((seed: unknown, n) => {
        const [from, to]: unknown[] = Array.isArray(seed) && seed.length === 2 ? seed : []
        return [point(from, `${where}'s seed ${n + 1}'s start`), point(to, `${where}'s seed ${n + 1}'s end`)] as const
      })
    }
    return joint
  })
  return { body, joints: read, ends: byEnd((name) => point(ends[name], `The ${body}'s ${name} end`)) }
}

// A direction in the source frame along the scene's axes, as the volume's axes say: a scene axis that runs against
// its grid axis takes the direction's component negated. Directions need no origin and no centring, so this holds
// for every level of the body
export function sceneDirection(axes: SceneAxes, direction: Triple): Vector3 {
  const along = (axis: SceneAxes['x']) => (axis.sign < 0 ? -direction[axis.source] : direction[axis.source])
  return new Vector3(along(axes.x), along(axes.y), along(axes.z))
}

// A point in the source frame as the scene places it for a level: along each scene axis, the point's distance from
// the level's voxel (0, 0, 0), signed as the axis runs, less the centre of the body's bounds, which every style
// subtracts. Two levels of a body have their own origins and bounds, so the same anatomy lands where each draws it
export function scenePoint(volume: { axes: SceneAxes; origin: Triple }, center: Triple, at: Triple): Vector3 {
  const offset: Triple = [at[0] - volume.origin[0], at[1] - volume.origin[1], at[2] - volume.origin[2]]
  return sceneDirection(volume.axes, offset).sub(new Vector3(...center))
}

// Where a joint's bone runs to: its child joint, or its end
export function boneEnd(rig: Rig, joint: JointName): Triple {
  const { child } = skeletonShape[joint]
  if (child) return rig.joints[child].at
  if (!isEndName(joint)) throw new Error(`The ${joint}'s bone runs to no joint and has no end`)
  return rig.ends[joint]
}

// Each joint's frame in the scan, as a rotation of the scene's axes: none for the trunk's joints and the clavicles,
// which lie as the neutral pose has them, and for a limb's, the turn that takes the neutral pose's bone and facing to
// the scan's, with the facing taken square to the bone. In the neutral pose a hanging bone runs along −y and faces
// z, and a forward one runs along z and faces y, so the turn's matrix has the scan's bone and facing as those columns
export function scanFrames(rig: Rig, axes: SceneAxes): Record<JointName, Quaternion> {
  return byJoint((name) => {
    const { lie } = skeletonShape[name]
    if (lie === 'scanned') return new Quaternion()
    const { at, facing } = rig.joints[name]
    const to = boneEnd(rig, name)
    const along = sceneDirection(axes, [to[0] - at[0], to[1] - at[1], to[2] - at[2]]).normalize()
    if (!facing) throw new Error(`The ${rig.body}'s ${name} has no facing`)
    const faced = sceneDirection(axes, facing)
    const square = faced.sub(along.clone().multiplyScalar(faced.dot(along)))
    if (square.lengthSq() < 1e-6) throw new Error(`The ${rig.body}'s ${name} faces along its own bone`)
    square.normalize()
    return new Quaternion().setFromRotationMatrix(basis(along, square, lie))
  })
}

// The rotation matrix whose columns are where the neutral pose's x, y and z go for a bone along a direction, facing
// another: y and z are the bone's and its facing's, as the neutral pose has them, and x completes them, which for
// either lie is the facing crossed with the bone
function basis(along: Vector3, facing: Vector3, lie: Exclude<Lie, 'scanned'>): Matrix4 {
  const x = new Vector3().crossVectors(facing, along)
  const y = lie === 'down' ? along.clone().negate() : facing.clone()
  const z = lie === 'down' ? facing.clone() : along.clone()
  return new Matrix4().makeBasis(x, y, z)
}

// A joint's rotation from its parent's frame in the scan, which is its turn from the neutral pose there, as Euler
// angles in degrees in the limits' order
export function scanAngles(frames: Record<JointName, Quaternion>, joint: JointName): Triple {
  const { parent } = skeletonShape[joint]
  const local = parent ? frames[parent].clone().invert().multiply(frames[joint]) : frames[joint].clone()
  const euler = new Euler().setFromQuaternion(local, 'XYZ')
  const degrees = (radians: number) => (radians * 180) / Math.PI
  return [degrees(euler.x), degrees(euler.y), degrees(euler.z)]
}
