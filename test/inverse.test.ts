import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { skinPoint, skinningAt, unskinPoint } from '../src/rig/inverse.ts'
import { bindSkeleton, scanPose, skinningMatrices, sourceOfScene, worldMatrices, type Placement, type Pose } from '../src/rig/pose.ts'
import { jointNames, scenePoint, type JointName } from '../src/rig/rig.ts'
import { noChain, readRigFile } from '../src/rig/rigFile.ts'
import { readVolume } from '../src/volume/format.ts'
import { bodyBounds } from '../src/volume/levels.ts'

// The skeleton bound to the male's committed 4 mm level, and the warp back from a pose to the scan
// (src/rig/pose.ts, src/rig/inverse.ts), against his committed rig file

const read = (path: string) => new Uint8Array(gunzipSync(readFileSync(new URL(path, import.meta.url))))
const volume = readVolume(read('../public/volume/male-4mm.bin'))
const file = readRigFile(read('../public/volume/male.rig.bin'))
const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bodyBounds(volume).center }
const bound = bindSkeleton(file.rig, placement)

void test('the scan pose puts every joint back where it was measured, and skinned to it nothing moves', () => {
  const world = worldMatrices(bound, scanPose(bound))
  for (const name of jointNames) {
    const at = new Vector3().setFromMatrixPosition(world[name])
    assert.ok(at.distanceTo(scenePoint(placement, placement.center, file.rig.joints[name].at)) < 1e-6, `${name} moved`)
  }
  const matrices = skinningMatrices(bound, scanPose(bound))
  for (const name of jointNames) assert.ok(matrices[name].equals(new Matrix4()) || near(matrices[name], new Matrix4()), `${name}'s matrix isn't none`)
})

function near(a: Matrix4, b: Matrix4) {
  return a.elements.every((value, n) => Math.abs(value - b.elements[n]) < 1e-9)
}

void test("a scene point taken back to the source frame is the voxel's own place", () => {
  const source = sourceOfScene(placement, scenePoint(placement, placement.center, [200, 150, 900]))
  assert.ok(source.every((value, n) => Math.abs(value - [200, 150, 900][n]) < 1e-9))
})

// The scan's pose with some joints turned further: an elbow bent, an arm raised to the side, a hip and a knee bent, the
// lower back bent forward and the neck turned
function bentPose(): Pose {
  const pose = scanPose(bound)
  const turn = (joint: JointName, x: number, y: number, z: number) => pose.rotations[joint].multiply(new Quaternion().setFromEuler(new Euler(x, y, z)))
  turn('rightForearm', -0.5, 0, 0)
  turn('leftArm', 0, 0, 0.6)
  turn('rightThigh', -0.5, 0, 0)
  turn('leftShin', 0.6, 0, 0)
  turn('spine1', 0.15, 0, 0)
  turn('neck', 0, 0.4, 0)
  return pose
}

// How much the forward warp swells or shrinks the flesh about a point: the determinant of its Jacobian, by a step along
// each axis. Below 0 the pose folds the flesh over itself there, and no warp can tell its layers apart
function swelling(matrices: Matrix4[], rest: Vector3) {
  const at = skinPoint(matrices, skinningAt(file, placement, rest)!, rest)
  const columns = [0, 1, 2].map((axis) => {
    const nudged = rest.clone()
    nudged.setComponent(axis, nudged.getComponent(axis) + 0.5)
    return skinPoint(matrices, skinningAt(file, placement, nudged)!, nudged).sub(at).divideScalar(0.5)
  })
  const [a, b, c] = columns
  return new Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z).determinant()
}

void test('points of the body skinned to a pose and warped back return to where they began, where the pose keeps the flesh unfolded', () => {
  const pose = bentPose()
  const byName = skinningMatrices(bound, pose)
  const matrices = jointNames.map((name) => byName[name])
  // Every hundredth cell of the body, at its centre
  const [nx, ny] = file.size
  let tried = 0
  let found = 0
  let folded = 0
  const missed: string[] = []
  for (let n = 0; n < file.cells.chain.length; n += 100) {
    if (file.cells.chain[n] === noChain || volume.coverage[n] < 128) continue
    const i = n % nx
    const j = Math.floor(n / nx) % ny
    const k = Math.floor(n / (nx * ny))
    const rest = scenePoint(placement, placement.center, [
      file.origin[0] + i * file.spacing[0],
      file.origin[1] + j * file.spacing[1],
      file.origin[2] + k * file.spacing[2],
    ])
    const skinning = skinningAt(file, placement, rest)
    assert.ok(skinning)
    // Where the pose folds the flesh, or squeezes or swells it fivefold, the way back isn't one point
    const swell = swelling(matrices, rest)
    if (swell < 0.2 || swell > 5) {
      folded++
      continue
    }
    const posed = skinPoint(matrices, skinning, rest)
    tried++
    const points = unskinPoint(file, placement, matrices, posed)
    // Every point the warp gives back is one the pose brings to the posed point
    for (const point of points) assert.ok(skinPoint(matrices, skinningAt(file, placement, point)!, point).distanceTo(posed) <= 0.5)
    if (points.some((point) => point.distanceTo(rest) < 0.5)) found++
    else if (missed.length < 5) missed.push(`(${i}, ${j}, ${k}) of ${skinning.joints.map((joint, m) => `${jointNames[joint]} ${skinning.weights[m].toFixed(2)}`).join(', ')}`)
  }
  assert.ok(tried > 10000, `only ${tried} points tried`)
  // Where a fold elsewhere brings a second point of the scan to the same place, the warp may give that one alone
  assert.ok(found / tried > 0.995, `${found} of ${tried} came back; missed ${missed.join('; ')}`)
  // The pose folds little of the body, which is the skinning's quality as much as the warp's
  assert.ok(folded / (tried + folded) < 0.02, `the pose folds ${folded} of ${tried + folded} points`)
})
