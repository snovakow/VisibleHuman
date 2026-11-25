import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Placement } from '../src/rig/pose.ts'
import { noChain, wallMiddle, type RigCells } from '../src/rig/rigFile.ts'
import type { RigGridCells } from '../src/rig/sampling.ts'
import { skinMesh } from '../src/surface/rigSkin.ts'
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

void test('a rigid vertex follows the joint the cells about it follow most, whichever cell names its joint first', () => {
  const { joints, weights } = skinMesh(mesh, rigCells(), placement, 'rigid')
  assert.deepEqual([...joints], [7, 0, 0, 0])
  assert.deepEqual([...weights], [1, 0, 0, 0])
})

void test('a blended vertex follows every joint the cells about it follow, by their shares', () => {
  const { joints, weights } = skinMesh(mesh, rigCells(), placement, 'blended')
  assert.deepEqual([...joints.slice(0, 2)], [5, 7])
  assert.ok(Math.abs(weights[0] - 1 / 8) < 1e-6 && Math.abs(weights[1] - 7 / 8) < 1e-6, `shares ${weights[0]} and ${weights[1]}`)
})
