import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Placement } from '../src/rig/pose.ts'
import { jointNames, skeletonShape } from '../src/rig/rig.ts'
import { noChain, wallMiddle, type RigCells } from '../src/rig/rigFile.ts'
import { mostJoints, type RigGridCells } from '../src/rig/sampling.ts'
import { meshIsosurface } from '../src/surface/marchingCubes.ts'
import { meshRigidParts, skinMesh } from '../src/surface/rigSkin.ts'
import type { SceneAxes, Triple } from '../src/volume/format.ts'

// The skinning of a posed body's meshes (src/surface/rigSkin.ts), on a rig file of eight cells built here

const size: Triple = [2, 2, 2]
const axes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: 1 } }
// The scene's frame is the source frame, so a vertex's place is its place among the cells
const placement: Placement = { axes, origin: [0, 0, 0], center: [0, 0, 0] }

// Eight cells of one chain: the first follows joint 5 alone and the other seven joint 7 alone
function rigCells(): RigGridCells {
  const block = (value: number) => new Uint8Array(8).fill(value)
  const joints = block(7)
  joints[0] = 5
  const cells: RigCells = {
    chain: block(0),
    otherChain: block(noChain),
    wall: block(wallMiddle),
    jointA: joints,
    jointB: joints.slice(),
    weight: block(255),
    otherJointA: joints.slice(),
    otherJointB: joints.slice(),
    otherWeight: block(255),
  }
  return { size, spacing: [1, 1, 1], origin: [0, 0, 0], cells }
}

// One vertex at the middle of the eight cells, where each gives an eighth of its skinning
const mesh = { positions: new Float32Array([0.5, 0.5, 0.5]), normals: new Float32Array([0, 0, 1]), indices: new Uint32Array(0) }

void test('a blended vertex follows every joint the cells about it follow, by their shares', () => {
  const { joints, weights } = skinMesh(mesh, rigCells(), placement)
  assert.deepEqual([...joints.slice(0, 2)], [5, 7])
  assert.ok(Math.abs(weights[0] - 1 / 8) < 1e-6 && Math.abs(weights[1] - 7 / 8) < 1e-6, `shares ${weights[0]} and ${weights[1]}`)
})

// A phantom of one limb's bone: a column of bone 2 × 2 voxels across and 8 long, along k, on a grid of 4 × 4 × 10,
// its lower half the upper arm's and its upper half the forearm's, two joints of the left arm's chain, as a bone runs
// on from one joint's cells to the next across an elbow. The scene runs the grid's axes in another order and one of
// them backward, so a part's place in the scene is tested where it's turned
const upperArm = jointNames.indexOf('leftArm')
const forearm = jointNames.indexOf('leftForearm')
const limb = { size: [4, 4, 10] satisfies Triple, spacing: [2, 3, 4] satisfies Triple, origin: [10, -20, 30] satisfies Triple }
const limbAxes: SceneAxes = { x: { source: 2, sign: 1 }, y: { source: 0, sign: -1 }, z: { source: 1, sign: 1 } }
const limbField = new Uint8Array(4 * 4 * 10)
for (let k = 1; k <= 8; k++) for (let j = 1; j <= 2; j++) for (let i = 1; i <= 2; i++) limbField[i + 4 * (j + 4 * k)] = 200
const jointAt = (_i: number, _j: number, k: number) => (k < 5 ? upperArm : forearm)
const limbInput = { field: limbField, ...limb, isolevel: 100, axes: limbAxes }

// The edges a mesh's triangles use once only, where it's open, by the joint of their first corner
function openEdges(indices: Uint32Array, joints: Uint8Array) {
  const uses = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const a = indices[t + corner]
      const b = indices[t + ((corner + 1) % 3)]
      const key = a < b ? `${a} ${b}` : `${b} ${a}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  const open = new Map<number, number>()
  for (const [key, count] of uses) {
    if (count !== 1) continue
    const joint = joints[Number(key.split(' ')[0]) * mostJoints]
    open.set(joint, (open.get(joint) ?? 0) + 1)
  }
  return open
}

void test("a rigid mesh of two joints' bone in one chain keeps no triangle joining them, and each joint's part is closed", () => {
  assert.equal(skeletonShape.leftArm.chain, skeletonShape.leftForearm.chain)
  const { mesh: parts, skinning } = meshRigidParts(limbInput, jointAt, jointNames.length)
  const { joints, weights } = skinning
  const vertices = parts.positions.length / 3
  assert.equal(joints.length, vertices * mostJoints)
  const followed = new Set<number>()
  for (let v = 0; v < vertices; v++) {
    followed.add(joints[v * mostJoints])
    assert.deepEqual([...weights.subarray(v * mostJoints, (v + 1) * mostJoints)], [1, 0, 0, 0])
  }
  assert.deepEqual([...followed].sort((a, b) => a - b), [upperArm, forearm])
  for (let t = 0; t < parts.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) => joints[parts.indices[t + corner] * mostJoints])
    assert.ok(a === b && b === c, `triangle ${t / 3} joins joints ${a}, ${b} and ${c}`)
  }
  assert.deepEqual(openEdges(parts.indices, joints), new Map())
  // Meshed whole, the same column holds triangles across the two joints, which a pose would stretch
  const whole = meshIsosurface(limbInput)
  const wholeJoints = new Uint8Array((whole.positions.length / 3) * mostJoints)
  for (let v = 0; v < whole.positions.length / 3; v++) {
    // The scene's x runs along k, so a vertex's k is where its x lies from the origin
    const k = (whole.positions[v * 3] - limb.origin[0]) / limb.spacing[2]
    wholeJoints[v * mostJoints] = jointAt(0, 0, Math.round(k))
  }
  let joining = 0
  for (let t = 0; t < whole.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) => wholeJoints[whole.indices[t + corner] * mostJoints])
    if (a !== b || b !== c) joining++
  }
  assert.ok(joining > 0, 'the whole column has no triangle across its joints')
})

void test("each joint's part is the mesh of the whole grid with the other joints' voxels emptied, placed where the grid puts it", () => {
  const { mesh: parts, skinning } = meshRigidParts(limbInput, jointAt, jointNames.length)
  const cornersOf = (positions: Float32Array, indices: Uint32Array, keep: (v: number) => boolean) => {
    const triangles: string[] = []
    for (let t = 0; t < indices.length; t += 3) {
      if (!keep(indices[t])) continue
      const corners = [0, 1, 2].map((corner) => [...positions.subarray(indices[t + corner] * 3, indices[t + corner] * 3 + 3)].map((value) => value.toFixed(4)).join(' '))
      triangles.push(corners.join(', '))
    }
    return triangles.sort()
  }
  for (const joint of [upperArm, forearm]) {
    const emptied = limbField.map((value, n) => (jointAt(0, 0, Math.floor(n / 16)) === joint ? value : 0))
    const alone = meshIsosurface({ ...limbInput, field: emptied })
    const part = cornersOf(parts.positions, parts.indices, (v) => skinning.joints[v * mostJoints] === joint)
    assert.ok(part.length > 0)
    assert.deepEqual(part, cornersOf(alone.positions, alone.indices, () => true))
  }
})
