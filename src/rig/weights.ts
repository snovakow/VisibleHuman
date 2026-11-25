import { boneDensity } from '../volume/density.ts'
import { isBodyVoxel, type Triple, type Volume } from '../volume/format.ts'
import { faceSteps, featureTransform, IndexHeap, inside, voxelOf } from './grid.ts'
import { joinedMask, joinsAcross, nearestSegment, segmentDistanceSquared, type Ball, type Segment } from './parts.ts'
import { noChain, type RigCells } from './rigFile.ts'
import { jointNames } from './rig.ts'

// How each cell's flesh follows the skeleton, on the rig file's grid. A bone's cell follows its home joint alone, the
// joint whose segments it lies nearest in its chain, so bone moves rigidly. Any other cell follows the two joints
// whose bone it lies nearest, by its distance to each through the body, never across a wall, and the nearer the more:
// flesh beside a bone moves with it, and flesh between two bones, as about a joint, is shared between them. A joint's
// bone, for this, is the cells of its part dense enough to be bone, and the cells its segments pass through, which
// stand for the bone where the CT doesn't reach it, as at the outer edge of the male's arms. Pure, so the rig script
// and the tests run it

// How far through the body a joint's bone draws flesh, in millimetres: far enough that a cell finds the two bones
// nearest it wherever it lies. At 120 the male's inner thigh by the groin, further than that from his thigh's bone
// through the flesh, followed the hips alone in places and the thigh alone in the cells beside them, which tore the
// skin there apart as the thigh rose; at 200 the knee up's longest edge at the groin fell from 162 mm to 68, and at
// 400 sitting's from 197 mm to 92
export const reachMm = 400
// How sharply a cell's share falls with its distance to a bone: as the inverse of the distance to this power, so that
// flesh well nearer one bone than the other all but follows the one, while flesh about midway is shared evenly
export const sharpness = 4
// The same about the shoulders, for a cell one of whose two joints is a clavicle's or an upper arm's: gentler, so that a
// raised arm draws the flesh at the back and the front of the shoulder after it over a wider band, rather than tearing
// it where the shares change. Measured on the male with the reach above, from arms out, the T-pose and arms forward,
// the longest edge at the back of a shoulder fell from 94, 102 and 108 mm to 82, 87 and 100, and the triangles there
// stretched past twice their size from 935, 1,098 and 1,566 to 656, 833 and 812. Everywhere at once it cost the hips
// as much: a knee up's longest edge rose from 73 mm to 119
export const shoulderSharpness = 2
const shoulderJoints: ReadonlySet<number> = new Set(
  (['leftShoulder', 'rightShoulder', 'leftArm', 'rightArm'] as const).map((name) => jointNames.indexOf(name)),
)
// How near a segment a cell lies to stand for its joint's bone, as a share of the grid's spacing
const segmentShare = 0.6
// How far into the air the cells beside the body take its nearest cell's values, in cells, so that a read just
// outside the skin, as a filtered read across it is, finds the chain and the joints of the flesh within
export const airCells = 2

// No joint, in a joint block's working arrays
const noJoint = 255

function placeOf(size: Triple, spacing: Triple, origin: Triple, index: number): Triple {
  const [i, j, k] = voxelOf(size, index)
  return [origin[0] + i * spacing[0], origin[1] + j * spacing[1], origin[2] + k * spacing[2]]
}

// Each cell's home joint within its own chain, or noJoint where it has no chain
export function homeJoints(volume: Volume, chain: Uint8Array, segments: readonly Segment[], balls: readonly Ball[]): Uint8Array {
  const { size, spacing, origin } = volume
  const home = new Uint8Array(chain.length).fill(noJoint)
  for (let n = 0; n < chain.length; n++) {
    if (chain[n] === noChain) continue
    const [x, y, z] = placeOf(size, spacing, origin, n)
    home[n] = nearestSegment(x, y, z, segments, balls, chain[n]).joint
  }
  return home
}

// Each cell's two nearest joints' bones through the body, never across a wall, and the shares they give it
export function skinWeights(
  volume: Volume,
  chain: Uint8Array,
  home: Uint8Array,
  segments: readonly Segment[],
  balls: readonly Ball[],
): Pick<RigCells, 'jointA' | 'jointB' | 'weight'> {
  const { size, spacing, origin, coverage, density } = volume
  const count = chain.length
  const body = (n: number) => isBodyVoxel(coverage[n]) && chain[n] !== noChain
  const joined = new Uint8Array(count)
  for (let n = 0; n < count; n++) {
    if (!body(n)) continue
    const [x, y, z] = placeOf(size, spacing, origin, n)
    joined[n] = joinedMask(x, y, z, balls)
  }
  // A step between two body cells of two chains not of one flesh there crosses a wall
  const crossesWall = (a: number, b: number) => chain[a] !== chain[b] && !joinsAcross(chain[a], chain[b], joined[a], joined[b])
  const isBone = (n: number) => density !== undefined && density[n] >= boneDensity

  // The two nearest joints so far and their distances
  const firstJoint = new Uint8Array(count).fill(noJoint)
  const secondJoint = new Uint8Array(count).fill(noJoint)
  const firstDistance = new Float32Array(count).fill(Infinity)
  const secondDistance = new Float32Array(count).fill(Infinity)

  const distance = new Float32Array(count).fill(Infinity)
  const touched: number[] = []
  const heap = new IndexHeap(1 << 16)
  const nearSegment = (Math.min(...spacing) * segmentShare) ** 2
  const steps = faceSteps(size)
  for (let joint = 0; joint < jointNames.length; joint++) {
    const own = segments.filter((segment) => segment.joint === joint)
    // The joint's bone: its part's bone cells, and the cells its segments pass through
    for (let n = 0; n < count; n++) {
      if (!body(n) || home[n] !== joint) continue
      let source = isBone(n)
      if (!source) {
        const [x, y, z] = placeOf(size, spacing, origin, n)
        source = own.some((segment) => segmentDistanceSquared(x, y, z, segment) <= nearSegment)
      }
      if (!source) continue
      distance[n] = 0
      touched.push(n)
      heap.push(n, 0)
    }
    while (heap.size > 0) {
      const at = heap.pop()
      const reached = heap.topKey
      if (reached > distance[at]) continue
      const place = voxelOf(size, at)
      for (const { axis, step } of steps) {
        if (!inside(size, place[axis], axis, step)) continue
        const next = at + step
        if (!body(next) || crossesWall(at, next)) continue
        const arrival = Math.fround(reached + spacing[axis])
        if (arrival > reachMm || arrival >= distance[next]) continue
        if (distance[next] === Infinity) touched.push(next)
        distance[next] = arrival
        heap.push(next, arrival)
      }
    }
    // Each cell this joint's bone reached, ranked among its nearest two
    for (const n of touched) {
      const d = distance[n]
      if (d < firstDistance[n]) {
        secondDistance[n] = firstDistance[n]
        secondJoint[n] = firstJoint[n]
        firstDistance[n] = d
        firstJoint[n] = joint
      } else if (d < secondDistance[n]) {
        secondDistance[n] = d
        secondJoint[n] = joint
      }
      distance[n] = Infinity
    }
    touched.length = 0
  }

  const jointA = new Uint8Array(count)
  const jointB = new Uint8Array(count)
  const weight = new Uint8Array(count)
  for (let n = 0; n < count; n++) {
    if (!body(n)) continue
    // A bone's cell, or one no bone reached, follows its home joint alone
    if (isBone(n) || firstJoint[n] === noJoint) {
      jointA[n] = home[n]
      jointB[n] = home[n]
      weight[n] = 255
      continue
    }
    if (secondJoint[n] === noJoint) {
      jointA[n] = firstJoint[n]
      jointB[n] = firstJoint[n]
      weight[n] = 255
      continue
    }
    const power = shoulderJoints.has(firstJoint[n]) || shoulderJoints.has(secondJoint[n]) ? shoulderSharpness : sharpness
    const a = firstDistance[n] ** power
    const b = secondDistance[n] ** power
    // The nearer joint's share, which at a bone's own cell, at no distance, is the whole
    const share = a + b === 0 ? 1 : b / (a + b)
    jointA[n] = firstJoint[n]
    jointB[n] = secondJoint[n]
    weight[n] = Math.round(share * 255)
  }
  return { jointA, jointB, weight }
}

// Each body cell beside a wall takes the skinning of the nearest cell across it, of the other chain, so that a vertex
// on the wall knows where its other side goes; every other cell, its own
export function otherSides(
  volume: Volume,
  chain: Uint8Array,
  otherChain: Uint8Array,
  skinning: Pick<RigCells, 'jointA' | 'jointB' | 'weight'>,
): Pick<RigCells, 'otherJointA' | 'otherJointB' | 'otherWeight'> {
  const { size, spacing, coverage } = volume
  const count = chain.length
  const otherJointA = skinning.jointA.slice()
  const otherJointB = skinning.jointB.slice()
  const otherWeight = skinning.weight.slice()
  const present = new Set<number>()
  for (let n = 0; n < count; n++) if (otherChain[n] !== noChain) present.add(otherChain[n])
  for (const c of present) {
    const { nearest } = featureTransform((n) => chain[n] === c && isBodyVoxel(coverage[n]), size, spacing)
    for (let n = 0; n < count; n++) {
      if (otherChain[n] !== c) continue
      const across = nearest[n]
      if (across < 0) continue
      otherJointA[n] = skinning.jointA[across]
      otherJointB[n] = skinning.jointB[across]
      otherWeight[n] = skinning.weight[across]
    }
  }
  return { otherJointA, otherJointB, otherWeight }
}

// The cells of the air within airCells of the body take the values of the body's nearest cell, in every block given
export function spreadIntoAir(volume: Volume, isBody: (index: number) => boolean, blocks: readonly Uint8Array[]) {
  const { size, spacing } = volume
  const { squared, nearest } = featureTransform(isBody, size, spacing)
  const reach = airCells * Math.max(...spacing)
  for (let n = 0; n < squared.length; n++) {
    if (isBody(n) || nearest[n] < 0 || squared[n] > reach * reach) continue
    for (const block of blocks) block[n] = block[nearest[n]]
  }
}
