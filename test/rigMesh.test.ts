import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meshIsosurface } from '../src/surface/marchingCubes.ts'
import { meshRigged } from '../src/surface/rigMesh.ts'
import { noChain, wallMiddle, wallSlope } from '../src/rig/rigFile.ts'
import type { SceneAxes, Triple } from '../src/volume/format.ts'

// The rigged mesher (src/surface/rigMesh.ts): where no wall lies, the mesh meshIsosurface makes; where one does, two
// closed surfaces, one each side, meeting on the wall

const plain: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: 1 } }
const spacing: Triple = [2, 2, 2]
const origin: Triple = [0, 0, 0]

// A box of body, i from 3 to 16, j and k from 2 to 7, in a 20 × 10 × 10 grid
const size: Triple = [20, 10, 10]
const count = size[0] * size[1] * size[2]
const at = (i: number, j: number, k: number) => i + size[0] * (j + size[1] * k)
function box() {
  const field = new Uint8Array(count)
  for (let k = 2; k <= 7; k++) for (let j = 2; j <= 7; j++) for (let i = 3; i <= 16; i++) field[at(i, j, k)] = 255
  return field
}

void test('with no wall about, the rigged mesh is the plain one', () => {
  const field = box()
  const chain = new Uint8Array(count).fill(0)
  const other = new Uint8Array(count).fill(noChain)
  const wall = new Uint8Array(count).fill(wallMiddle)
  const expected = meshIsosurface({ field, size, spacing, origin, isolevel: 128, axes: plain })
  const rigged = meshRigged({ field, size, spacing, origin, isolevel: 128, axes: plain, chain, other, wall })
  assert.deepEqual(rigged.positions, expected.positions)
  assert.deepEqual(rigged.indices, expected.indices)
  assert.ok(rigged.walls.every((flag) => flag === 0))
})

// Each undirected edge of a side's triangles, and how many triangles share it
function edgeUses(indices: Uint32Array, keep: (triangle: number) => boolean) {
  const uses = new Map<string, number>()
  for (let t = 0; t < indices.length / 3; t++) {
    if (!keep(t)) continue
    const corners = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]
    for (let e = 0; e < 3; e++) {
      const a = corners[e]
      const b = corners[(e + 1) % 3]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  return uses
}

void test('a wall across the box parts it into two closed surfaces that meet on the wall', () => {
  const field = box()
  // Chain 0 up to i = 9, chain 1 from 10: the wall lies at i = 9.5, which within reach each side records with the
  // other chain, and the field, positive on chain 0's side, rises a wall slope a millimetre from it
  const chain = new Uint8Array(count)
  const other = new Uint8Array(count).fill(noChain)
  const wall = new Uint8Array(count).fill(wallMiddle)
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const n = at(i, j, k)
        chain[n] = i <= 9 ? 0 : 1
        const distance = (9.5 - i) * spacing[0]
        if (Math.abs(distance) > 12) continue
        other[n] = i <= 9 ? 1 : 0
        wall[n] = Math.max(0, Math.min(255, Math.round(wallMiddle + wallSlope * distance)))
      }
    }
  }
  const mesh = meshRigged({ field, size, spacing, origin, isolevel: 128, axes: plain, chain, other, wall })
  const sideOf = (t: number) => mesh.sides[mesh.indices[t * 3]]
  // Every triangle's corners are on one side
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    assert.equal(mesh.sides[mesh.indices[t * 3 + 1]], sideOf(t))
    assert.equal(mesh.sides[mesh.indices[t * 3 + 2]], sideOf(t))
  }
  // Each side's surface is closed: every edge of its triangles is shared by two of them
  for (const side of [0, 1]) {
    const uses = edgeUses(mesh.indices, (t) => sideOf(t) === side)
    assert.ok(uses.size > 0)
    for (const [edge, used] of uses) assert.equal(used, 2, `side ${side}'s edge ${edge} is used ${used} times`)
  }
  // The wall's vertices lie on the wall, x = 19 mm, on both sides, and only there
  const wallX = 9.5 * spacing[0]
  const onWall = [0, 0]
  for (let v = 0; v < mesh.walls.length; v++) {
    if (mesh.walls[v] === 0) continue
    assert.ok(Math.abs(mesh.positions[v * 3] - wallX) < 0.2, `a wall vertex at x = ${mesh.positions[v * 3]}`)
    onWall[mesh.sides[v]]++
  }
  assert.ok(onWall[0] > 0 && onWall[1] > 0)
})

void test('where a wall ends in flesh the two chains share, each side and the whole skin stay closed', () => {
  const field = box()
  // Chain 0 up to i = 9, chain 1 from 10, walled apart only up to k = 4: above it the two are one flesh, as a limb and
  // the trunk are about a shoulder, and record no wall
  const chain = new Uint8Array(count)
  const other = new Uint8Array(count).fill(noChain)
  const wall = new Uint8Array(count).fill(wallMiddle)
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const n = at(i, j, k)
        chain[n] = i <= 9 ? 0 : 1
        const distance = (9.5 - i) * spacing[0]
        if (k > 4 || Math.abs(distance) > 12) continue
        other[n] = i <= 9 ? 1 : 0
        wall[n] = Math.max(0, Math.min(255, Math.round(wallMiddle + wallSlope * distance)))
      }
    }
  }
  const mesh = meshRigged({ field, size, spacing, origin, isolevel: 128, axes: plain, chain, other, wall })
  const sideOf = (t: number) => mesh.sides[mesh.indices[t * 3]]
  for (const side of [0, 1]) {
    for (const [edge, used] of edgeUses(mesh.indices, (t) => sideOf(t) === side)) {
      assert.equal(used, 2, `side ${side}'s edge ${edge} is used ${used} times`)
    }
  }
  for (const [edge, used] of edgeUses(mesh.indices, () => true)) assert.equal(used % 2, 0, `the edge ${edge} is open`)
})
