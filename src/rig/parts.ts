import type { Triple } from '../volume/format.ts'
import { boneEnd, chainNames, jointNames, skeletonShape, type Chain, type JointName, type Rig } from './rig.ts'

// The parts of the body each joint moves: a place belongs to the joint whose segments it lies nearest, among those of
// its chain. A joint's segments are its bone's, from the joint to the next or to its end, and any more its rig gives
// it, such as the pelvis's wings. Inside a ball joint's head, the place belongs to the limb's joint, whatever lies
// nearer: the head sits deep in its socket, whose bone is the trunk's. Pure, so the rig script and the tests run it

export interface Segment {
  joint: number
  chain: number
  from: Triple
  to: Triple
}

export interface Ball {
  joint: number
  chain: number
  at: Triple
  radius: number
  // The radius within which the limb's flesh runs on into the trunk's, where it has one
  joined: number
}

export const chainIndex = (chain: Chain) => chainNames.indexOf(chain)
export const jointIndex = (joint: JointName) => jointNames.indexOf(joint)

export function segmentsOf(rig: Rig): Segment[] {
  const segments: Segment[] = []
  for (const name of jointNames) {
    const joint = jointIndex(name)
    const chain = chainIndex(skeletonShape[name].chain)
    segments.push({ joint, chain, from: rig.joints[name].at, to: boneEnd(rig, name) })
    for (const [from, to] of rig.joints[name].seeds ?? []) segments.push({ joint, chain, from, to })
  }
  return segments
}

export function ballsOf(rig: Rig): Ball[] {
  return jointNames.flatMap((name) => {
    const { at, ball, joined } = rig.joints[name]
    if (ball === undefined) return []
    return [{ joint: jointIndex(name), chain: chainIndex(skeletonShape[name].chain), at, radius: ball, joined: joined ?? 0 }]
  })
}

// The squared distance from a point to a segment
export function segmentDistanceSquared(x: number, y: number, z: number, { from, to }: Segment): number {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const length = dx * dx + dy * dy + dz * dz
  let t = length > 0 ? ((x - from[0]) * dx + (y - from[1]) * dy + (z - from[2]) * dz) / length : 0
  t = Math.max(0, Math.min(1, t))
  const ex = from[0] + t * dx - x
  const ey = from[1] + t * dy - y
  const ez = from[2] + t * dz - z
  return ex * ex + ey * ey + ez * ez
}

// The segment a point lies nearest, among those of one chain, or of every chain where none is given; inside a ball
// joint's head, that joint's own bone
export function nearestSegment(x: number, y: number, z: number, segments: readonly Segment[], balls: readonly Ball[], chain?: number): Segment {
  for (const ball of balls) {
    if (chain !== undefined && ball.chain !== chain) continue
    const dx = x - ball.at[0]
    const dy = y - ball.at[1]
    const dz = z - ball.at[2]
    if (dx * dx + dy * dy + dz * dz <= ball.radius * ball.radius) {
      const own = segments.find((segment) => segment.joint === ball.joint)
      if (own) return own
    }
  }
  let best: Segment | null = null
  let bestDistance = Infinity
  for (const segment of segments) {
    if (chain !== undefined && segment.chain !== chain) continue
    const distance = segmentDistanceSquared(x, y, z, segment)
    if (distance < bestDistance) {
      bestDistance = distance
      best = segment
    }
  }
  if (!best) throw new Error(`No segment belongs to chain ${chain}`)
  return best
}

// Which limbs' flesh runs on into the trunk's at a point, around their ball joints: a bit for each such limb's chain
export function joinedMask(x: number, y: number, z: number, balls: readonly Ball[]): number {
  let mask = 0
  for (const ball of balls) {
    const dx = x - ball.at[0]
    const dy = y - ball.at[1]
    const dz = z - ball.at[2]
    if (dx * dx + dy * dy + dz * dz <= ball.joined * ball.joined) mask |= 1 << ball.chain
  }
  return mask
}

// The trunk's chain, into which every limb is joined
const trunk = 0

// Whether two neighbouring places of two chains are of one flesh, with no wall between them: where every limb of the
// two lies within its own joined reach at both places, as an arm and the trunk do about the shoulder and the two
// thighs and the trunk about the groin. A hand against the groin, or two thighs below it, are walled apart
export function joinsAcross(chainA: number, chainB: number, maskA: number, maskB: number): boolean {
  for (const chain of [chainA, chainB]) {
    if (chain === trunk) continue
    const bit = 1 << chain
    if ((maskA & bit) === 0 || (maskB & bit) === 0) return false
  }
  return true
}
