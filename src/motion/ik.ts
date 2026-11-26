import { Bone, BufferGeometry, MathUtils, Matrix4, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three'
import { CCDIKSolver, type IK } from 'three/addons/animation/CCDIKSolver.js'
import { jointNames, limitsOf, type JointName } from '../rig/rig.ts'
import type { RigSkeleton } from '../rig/skeleton.ts'

// Posing by hand: a handle at each wrist and each ankle, which a drag moves, and the limb behind it turned by inverse
// kinematics to bring the wrist or the ankle to it. Each limb is a chain of three's CCD solver: each arm from its
// forearm up to its clavicle, so that a hand raised high lifts the shoulder a little as it does, and each leg from its
// shin up to its thigh. Every link turns only within the rig's own limits, the same ones a pose is written within.
//
// three's solver works on a skinned mesh's bones and wants each target to be one of them, so it's given bones of its
// own: the rig's 22, the very bones the styles skin to, in the joints' order, then a target for each handle, which
// belongs to no skeleton a style reads, so the skeleton the styles skin to stays the rig's.
//
// What a drag leaves is kept as an offset over whatever the motion holds: each turned joint's turn from the motion's
// rotation, in its own frame, laid over the clip each time the clip sets the bones, so that a hand dragged up over the
// walk stays up as he walks. Clearing the offsets gives the motion back exactly

// The joints a handle stands at, the wrists and the ankles, which are also the ends its chain turns to the target
export const handleNames = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const
export type HandleName = (typeof handleNames)[number]

// The joints each handle's chain turns, from the effector's parent up, each the parent of the one before
const chainJoints: Record<HandleName, readonly JointName[]> = {
  leftHand: ['leftForearm', 'leftArm', 'leftShoulder'],
  rightHand: ['rightForearm', 'rightArm', 'rightShoulder'],
  leftFoot: ['leftShin', 'leftThigh'],
  rightFoot: ['rightShin', 'rightThigh'],
}

// How many passes up the chain the solver makes each time it solves
const solverIterations = 24

// How many times a frame may solve: again while each solve brings the wrist or the ankle closeEnough nearer the
// target, in millimetres, until it's that near. One solve can stop short with the limb lying along the line to the
// target, as a long jump of the target leaves a straight leg pointing at a fold it hasn't made, and the next solve,
// from there, makes the fold. A target in reach then comes within 5 mm of the wrist or the ankle in one frame, from
// any pose of the library toward where any other puts it, and along a drag (test/ik.test.ts), for a few hundredths of
// a millisecond a frame of a drag
const solvesAtMost = 4
const closeEnough = 1

// How far an elbow or a knee is bent before the solver folds it toward a target nearer than the hand or the foot, in
// radians: enough for the first pass to fold it the right way, and little enough not to show
const leastBend = (10 * Math.PI) / 180

export interface LimbLink {
  joint: JointName
  // The link's bone, in the solver's bones array
  index: number
  // Its limits in radians, as Euler angles in the limits' order
  rotationMin: Vector3
  rotationMax: Vector3
}

export interface LimbChain {
  handle: HandleName
  // The wrist's or the ankle's bone, and its target's, in the solver's bones array
  effector: number
  target: number
  links: readonly LimbLink[]
}

const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))

// The chains as the solver takes them: each link's bone by its joint's place among the joints, and each target after
// the 22, in the handles' order
export function limbChains(): LimbChain[] {
  return handleNames.map((handle, n) => ({
    handle,
    effector: jointNames.indexOf(handle),
    target: jointNames.length + n,
    links: chainJoints[handle].map((joint): LimbLink => {
      const limits = limitsOf(joint)
      if (!limits) throw new Error(`The ${joint} has no limits to turn in`)
      return {
        joint,
        index: jointNames.indexOf(joint),
        rotationMin: new Vector3(MathUtils.degToRad(limits.x[0]), MathUtils.degToRad(limits.y[0]), MathUtils.degToRad(limits.z[0])),
        rotationMax: new Vector3(MathUtils.degToRad(limits.x[1]), MathUtils.degToRad(limits.y[1]), MathUtils.degToRad(limits.z[1])),
      }
    }),
  }))
}

// Each turned joint's offset as data, a rotation's x, y, z and w, for the store to keep across a change of motion,
// style or body and back
export type Offsets = Readonly<Partial<Record<JointName, readonly [number, number, number, number]>>>

export interface Limbs {
  // The solver's bones: the rig's, in the joints' order, then each handle's target
  readonly bones: readonly Bone[]
  readonly chains: readonly LimbChain[]
  // The handle being dragged, or none
  readonly dragging: HandleName | null
  // Whether the bones wait on a change the limbs made: a target moved, or other offsets set
  readonly pending: boolean
  // The offsets to lay over the motion from now on; nothing changes where they're the ones laid already
  setOffsets(offsets: Offsets): void
  // Starts a drag of a handle, its target where it stands
  grab(handle: HandleName): void
  // Moves the dragged handle's target, in the scene
  aim(point: Vector3): void
  // Ends the drag, its offsets kept, and gives them back
  release(): Offsets
  // Ahead of the motion setting the bones' rotations: puts back what it set last where the offsets went on over it,
  // since three's mixer sets a bone only when its own value changes, and would leave a still pose's bones offset
  restore(): void
  // Once the motion has set the bones' rotations: lays the offsets over them, and while a handle is dragged, turns its
  // chain toward the target and keeps what that turned as its offsets
  apply(): void
}

export function createLimbs(rig: RigSkeleton): Limbs {
  const rigBones = jointNames.map((name) => rig.bones[name])
  const targets = handleNames.map((handle) => {
    const bone = new Bone()
    bone.name = `${handle} target`
    return bone
  })
  const bones: readonly Bone[] = [...rigBones, ...targets]
  const chains = limbChains()
  const iks: IK[] = chains.map(({ effector, target, links }) => ({
    effector,
    target,
    iteration: solverIterations,
    links: links.map(({ index, rotationMin, rotationMax }) => ({ index, rotationMin, rotationMax })),
  }))
  // The solver reads only its mesh's skeleton's bones, so the mesh draws nothing and is never added to a scene. The
  // skeleton's inverses are never read either, so they're given rather than worked out from bones not yet placed
  const mesh = new SkinnedMesh(new BufferGeometry())
  mesh.skeleton = new Skeleton([...bones], bones.map(() => new Matrix4()))
  const solver = new CCDIKSolver(mesh, iks)

  // Each joint's offset, and whether it has one
  const offset = jointNames.map(() => new Quaternion())
  const held = jointNames.map(() => false)
  // The motion's own rotation of each joint the offsets or a drag turned last time, which restore puts back
  const base = jointNames.map(() => new Quaternion())
  const based = jointNames.map(() => false)
  // The dragged chain's rotations as the solve found them, should it leave the end further off
  const before = jointNames.map(() => new Quaternion())
  let dragging: number | null = null
  let pending = false

  // CCD turns each link to point the chain's end at the target, which can't fold a straight elbow or knee: every link
  // of a straight limb points it along the line it already lies on, so a target nearer than the hand or the foot is
  // never reached, and a hinge bent a little with the end off that line is unbent by the first pass. So where the
  // target is nearer the limb's upper joint than its end is, and the hinge is straighter than leastBend, the hinge is
  // bent that far its own way and the upper link swung to bring the end back where it was, beside the target; from
  // there each pass folds the hinge on toward it
  const upperAt = new Vector3()
  const endAt = new Vector3()
  const endWas = new Vector3()
  const upperTurn = new Quaternion()
  const unturn = new Quaternion()
  const scale = new Vector3()
  const unstraighten = (chain: LimbChain, target: Bone) => {
    const hinge = chain.links[0]
    const upper = chain.links[1]
    if (!hinge || !upper) return
    const upperBone = rigBones[upper.index]
    upperAt.setFromMatrixPosition(upperBone.matrixWorld)
    endWas.setFromMatrixPosition(rigBones[chain.effector].matrixWorld)
    if (target.position.distanceTo(upperAt) >= endWas.distanceTo(upperAt)) return
    const bone = rigBones[hinge.index]
    // The way the hinge bends, its greater reach about x: the elbow forward, which is negative, the knee back
    const way = Math.abs(hinge.rotationMin.x) > Math.abs(hinge.rotationMax.x) ? -1 : 1
    if (bone.rotation.x * way >= leastBend) return
    bone.rotation.x = way * leastBend
    bone.updateMatrixWorld(true)
    // The turn, in the upper link's own frame, that takes the bent limb's end back onto the line to where it was
    upperBone.matrixWorld.decompose(upperAt, unturn, scale)
    unturn.invert()
    endAt.setFromMatrixPosition(rigBones[chain.effector].matrixWorld).sub(upperAt).applyQuaternion(unturn).normalize()
    endWas.sub(upperAt).applyQuaternion(unturn).normalize()
    upperBone.quaternion.multiply(upperTurn.setFromUnitVectors(endAt, endWas))
    // Held within the link's limits, as the solver holds every turn it makes
    const turn = upperBone.rotation
    const least = upper.rotationMin
    const most = upper.rotationMax
    turn.set(clamp(turn.x, least.x, most.x), clamp(turn.y, least.y, most.y), clamp(turn.z, least.z, most.z))
    upperBone.updateMatrixWorld(true)
  }

  const toData = (): Offsets => {
    const data: Partial<Record<JointName, readonly [number, number, number, number]>> = {}
    jointNames.forEach((name, n) => {
      if (held[n]) data[name] = [offset[n].x, offset[n].y, offset[n].z, offset[n].w]
    })
    return data
  }

  return {
    bones,
    chains,
    get dragging() {
      return dragging === null ? null : handleNames[dragging]
    },
    get pending() {
      return pending
    },
    setOffsets(next) {
      const same = jointNames.every((name, n) => {
        const value = next[name]
        if (!value) return !held[n]
        const kept = offset[n]
        return held[n] && kept.x === value[0] && kept.y === value[1] && kept.z === value[2] && kept.w === value[3]
      })
      if (same) return
      jointNames.forEach((name, n) => {
        const value = next[name]
        held[n] = value !== undefined
        if (value) offset[n].set(value[0], value[1], value[2], value[3])
        else offset[n].identity()
      })
      pending = true
    },
    grab(handle) {
      dragging = handleNames.indexOf(handle)
      const target = targets[dragging]
      target.position.setFromMatrixPosition(rig.bones[handle].matrixWorld)
      target.updateMatrixWorld(true)
    },
    aim(point) {
      if (dragging === null) return
      const target = targets[dragging]
      if (target.position.equals(point)) return
      target.position.copy(point)
      target.updateMatrixWorld(true)
      pending = true
    },
    release() {
      dragging = null
      return toData()
    },
    restore() {
      for (let n = 0; n < rigBones.length; n++) if (based[n]) rigBones[n].quaternion.copy(base[n])
    },
    apply() {
      pending = false
      const solving = dragging
      const links = solving === null ? null : chains[solving].links
      for (let n = 0; n < rigBones.length; n++) based[n] = held[n]
      if (links) for (let k = 0; k < links.length; k++) based[links[k].index] = true
      for (let n = 0; n < rigBones.length; n++) {
        if (!based[n]) continue
        base[n].copy(rigBones[n].quaternion)
        if (held[n]) rigBones[n].quaternion.multiply(offset[n])
      }
      if (solving === null || !links) return
      // The solver reads the links' world matrices, which follow the rotations just set only once brought up to date
      rig.root.updateMatrixWorld(true)
      const chain = chains[solving]
      const target = targets[solving]
      const effector = rigBones[chain.effector]
      // Solves that leave the end further from the target than they found it are undone: one that meets a limit can
      // turn a link to another set of angles for the same limit and flail, where staying put loses nothing
      const missed = endAt.setFromMatrixPosition(effector.matrixWorld).distanceTo(target.position)
      for (let k = 0; k < links.length; k++) before[links[k].index].copy(rigBones[links[k].index].quaternion)
      let miss = missed
      for (let n = 0; n < solvesAtMost; n++) {
        unstraighten(chain, target)
        solver.updateOne(iks[solving])
        const now = endAt.setFromMatrixPosition(effector.matrixWorld).distanceTo(target.position)
        const nearer = miss - now
        miss = now
        if (now < closeEnough || nearer < closeEnough) break
      }
      if (miss > missed) {
        for (let k = 0; k < links.length; k++) rigBones[links[k].index].quaternion.copy(before[links[k].index])
        rigBones[links[links.length - 1].index].updateMatrixWorld(true)
      }
      for (let k = 0; k < links.length; k++) {
        const index = links[k].index
        offset[index].copy(base[index]).invert().multiply(rigBones[index].quaternion)
        held[index] = true
      }
    },
  }
}

