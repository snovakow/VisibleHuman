import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Euler, Quaternion, Vector3 } from 'three'
import { poseSplats, skinningBuild, skinSplats } from '../src/rig/cellSkinning.ts'
import { skinPoint } from '../src/rig/inverse.ts'
import { bindSkeleton, neutralPose, packMatrices, scanPose, skinningMatrices, sourceOfScene, type Placement, type Pose } from '../src/rig/pose.ts'
import { jointNames } from '../src/rig/rig.ts'
import { noChain, readRigFile } from '../src/rig/rigFile.ts'
import { chainOfVoxel, mostJoints, skinningAtSource } from '../src/rig/sampling.ts'
import { readVolume } from '../src/volume/format.ts'
import { bodyBounds, bodyIndices, buildLevel, extentOf } from '../src/volume/levels.ts'

// The skinning of a posed body's splats and the pose's arithmetic on their centres (src/rig/cellSkinning.ts), on the
// male's committed 4 mm level and rig file, at the 16 mm Detail, built by chain as the page builds it

const read = (path: string) => new Uint8Array(gunzipSync(readFileSync(new URL(path, import.meta.url))))
const volume = readVolume(read('../public/volume/male-4mm.bin'))
const file = readRigFile(read('../public/volume/male.rig.bin'))
const indices = bodyIndices(volume)
const extent = extentOf(volume, indices)
const bounds = bodyBounds(volume, indices, extent)
const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
const bound = bindSkeleton(file.rig, placement)
const level = buildLevel(volume, bounds, 4, indices, extent, chainOfVoxel(file, volume))
const skinning = skinSplats(level, file, placement, bound)

// A pose far from the scan's: the neutral pose with the arms raised out, a knee up and the head turned
function bentPose(): Pose {
  const pose = neutralPose(bound)
  const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180))
  pose.rotations.leftArm = turn(0, 0, 80)
  pose.rotations.rightArm = turn(0, 0, -80)
  pose.rotations.leftForearm = turn(60, 0, 0)
  pose.rotations.leftThigh = turn(-90, 0, 0)
  pose.rotations.leftShin = turn(90, 0, 0)
  pose.rotations.head = turn(0, 40, 0)
  return pose
}

function posedCentres(pose: Pose) {
  const positions = new Float32Array(level.count * 3)
  const padded = new Float32Array(level.count * 4 + 64)
  poseSplats(level.centers, skinning, packMatrices(skinningMatrices(bound, pose)), positions, padded)
  return { positions, padded }
}

void test('the chain of a voxel on the rig file’s own grid is its cell’s, and none beyond the grid', () => {
  const chainOf = chainOfVoxel(file, volume)
  const [nx, ny, nz] = file.size
  for (let n = 0; n < file.cells.chain.length; n += 997) {
    const i = n % nx
    const j = Math.floor(n / nx) % ny
    const k = Math.floor(n / (nx * ny))
    assert.equal(chainOf(i, j, k), file.cells.chain[n])
  }
  assert.equal(chainOf(-1, 0, 0), noChain)
  assert.equal(chainOf(0, 0, nz), noChain)
})

void test('every cell is skinned to whole shares, as its own chain’s flesh, found alike a share at a time', () => {
  for (let n = 0; n < level.count; n++) {
    let sum = 0
    for (let m = 0; m < mostJoints; m++) sum += skinning.weights[n * mostJoints + m]
    assert.ok(Math.abs(sum - 1) < 1e-5, `cell ${n}'s shares sum to ${sum}`)
  }
  // A cell is skinned on its own chain's side of a wall, as the rig file's flesh of that chain
  for (let n = 0; n < level.count; n += 37) {
    const chain = level.chains?.[n]
    const at = new Vector3().fromArray(level.centers, n * 3)
    const expected = skinningAtSource(file, sourceOfScene(placement, at), chain === noChain ? undefined : chain)
    if (!expected) continue
    expected.joints.forEach((joint, m) => {
      assert.equal(skinning.joints[n * mostJoints + m], joint)
      assert.ok(Math.abs(skinning.weights[n * mostJoints + m] - expected.weights[m]) < 1e-6)
    })
  }
  const build = skinningBuild(level, file, placement, bound)
  let found = build.advance(1000)
  while (!found) found = build.advance(1000)
  assert.deepEqual(found, skinning)
})

void test('the scan’s pose leaves every centre where it was', () => {
  const { positions, padded } = posedCentres(scanPose(bound))
  let worst = 0
  for (let n = 0; n < level.count; n++) {
    for (let axis = 0; axis < 3; axis++) {
      worst = Math.max(worst, Math.abs(positions[n * 3 + axis] - level.centers[n * 3 + axis]))
      assert.equal(padded[n * 4 + axis], positions[n * 3 + axis])
    }
  }
  assert.ok(worst < 1e-3, `a centre moved ${worst} mm`)
})

void test('a bent pose moves every centre where its skinning takes it, and none past the rig’s reach', () => {
  const pose = bentPose()
  const { positions } = posedCentres(pose)
  const matrices = skinningMatrices(bound, pose)
  const byIndex = jointNames.map((name) => matrices[name])
  let worst = 0
  let moved = 0
  for (let n = 0; n < level.count; n += 7) {
    const rest = new Vector3().fromArray(level.centers, n * 3)
    const joints: number[] = []
    const weights: number[] = []
    for (let m = 0; m < mostJoints; m++) {
      if (skinning.weights[n * mostJoints + m] === 0) continue
      joints.push(skinning.joints[n * mostJoints + m])
      weights.push(skinning.weights[n * mostJoints + m])
    }
    const expected = skinPoint(byIndex, { joints, weights }, rest)
    const actual = new Vector3().fromArray(positions, n * 3)
    worst = Math.max(worst, actual.distanceTo(expected))
    if (actual.distanceTo(rest) > 50) moved++
  }
  assert.ok(worst < 1e-3, `a centre lies ${worst} mm from its skinned place`)
  assert.ok(moved > 1000, `only ${moved} sampled centres moved`)
  const center = new Vector3(...skinning.reach.center)
  for (let n = 0; n < level.count; n++) {
    const distance = new Vector3().fromArray(positions, n * 3).distanceTo(center)
    assert.ok(distance <= skinning.reach.radius + 1e-3, `cell ${n} lies ${distance} mm out, past ${skinning.reach.radius}`)
  }
})

void test('a cell of the arm against the chest follows the arm, and the chest’s cell beside it the chest', () => {
  // Cells of two chains split from one block: where they're the arm's and the trunk's, raising the arm parts them
  const pose = bentPose()
  const { positions } = posedCentres(pose)
  const trunk = 0
  const leftArm = 1
  let parted = 0
  let pairs = 0
  // A block's cells are listed one after another, a chain at a time, so a block split between the two is a trunk's
  // cell followed by an arm's within a block's reach of it
  for (let n = 0; n + 1 < level.count; n++) {
    if (level.chains?.[n] !== trunk || level.chains[n + 1] !== leftArm) continue
    const before = new Vector3().fromArray(level.centers, n * 3).distanceTo(new Vector3().fromArray(level.centers, (n + 1) * 3))
    if (before > level.spacing * Math.sqrt(3)) continue
    pairs++
    const apart = new Vector3().fromArray(positions, n * 3).distanceTo(new Vector3().fromArray(positions, (n + 1) * 3))
    if (apart > before + 30) parted++
  }
  assert.ok(pairs > 0, 'no block holds both the trunk and the left arm')
  assert.ok(parted > 0, 'no cell of the arm parted from the chest beside it')
})
