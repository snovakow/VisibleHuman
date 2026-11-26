import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noChain, wallMiddle, wallSlope } from '../src/rig/rigFile.ts'
import { chainDistanceField, distanceField, hasWallsTo, skinDistance } from '../src/surface/distanceField.ts'
import { meshRiggedShell } from '../src/surface/rigMesh.ts'
import { cellCount, cellIndex, type SceneAxes, type Triple } from '../src/volume/format.ts'

// The distance field: each body voxel's Euclidean distance in voxels to the nearest voxel centre outside the body, 0
// outside, checked on a cube, a lone voxel and against a brute-force search; and a chain's own, which counts the far
// side of its walls as outside, checked on a box a wall parts

// A coverage block with body (255) where the test says and outside (0) elsewhere
function coverageOf(size: Triple, isBody: (i: number, j: number, k: number) => boolean) {
  const coverage = new Uint8Array(cellCount(size))
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) for (let i = 0; i < size[0]; i++) if (isBody(i, j, k)) coverage[cellIndex(size, i, j, k)] = 255
  }
  return coverage
}

void test('a 9³ body centred in an 11³ grid is 5 at its centre, 1 on its faces and 0 outside', () => {
  const size: Triple = [11, 11, 11]
  const inside = (value: number) => value >= 1 && value <= 9
  const field = distanceField(coverageOf(size, (i, j, k) => inside(i) && inside(j) && inside(k)), size)
  assert.equal(field[cellIndex(size, 5, 5, 5)], 5)
  // The middle of each face, and a corner, all next to the outside
  for (const at of [[1, 5, 5], [9, 5, 5], [5, 1, 5], [5, 9, 5], [5, 5, 1], [5, 5, 9], [1, 1, 1]] as Triple[]) {
    assert.equal(field[cellIndex(size, ...at)], 1, `voxel ${at.join(', ')}`)
  }
  // One in from a face: two
  assert.equal(field[cellIndex(size, 2, 5, 5)], 2)
  for (const at of [[0, 5, 5], [10, 10, 10], [5, 0, 5]] as Triple[]) assert.equal(field[cellIndex(size, ...at)], 0)
  // The field is along a face's axis only: the nearest outside is straight out, never diagonal, inside a cube
  assert.equal(field[cellIndex(size, 3, 4, 5)], 3)
})

void test('a lone body voxel is 1, its neighbours 0', () => {
  const size: Triple = [5, 5, 5]
  const field = distanceField(coverageOf(size, (i, j, k) => i === 2 && j === 2 && k === 2), size)
  assert.equal(field[cellIndex(size, 2, 2, 2)], 1)
  let sum = 0
  for (const value of field) sum += value
  assert.equal(sum, 1)
})

void test('on a random 12³ mask, every voxel\'s distance equals a brute-force nearest search within 1e-5', () => {
  const size: Triple = [12, 12, 12]
  let state = 7
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
  // Mostly body, so some voxels lie several deep
  const coverage = coverageOf(size, () => next() < 0.85)
  const field = distanceField(coverage, size)
  const outside: Triple[] = []
  for (let k = 0; k < 12; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) if (coverage[cellIndex(size, i, j, k)] < 128) outside.push([i, j, k])
  assert.ok(outside.length > 0)
  let deepest = 0
  for (let k = 0; k < 12; k++) {
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 12; i++) {
        const n = cellIndex(size, i, j, k)
        let nearest = 0
        if (coverage[n] >= 128) {
          nearest = Infinity
          for (const [a, b, c] of outside) nearest = Math.min(nearest, Math.hypot(i - a, j - b, k - c))
        }
        assert.ok(Math.abs(field[n] - nearest) < 1e-5, `voxel ${i}, ${j}, ${k}: ${field[n]} against ${nearest}`)
        deepest = Math.max(deepest, nearest)
      }
    }
  }
  // Some voxel lies off the axes from its nearest outside, so the passes along j and k mattered
  assert.ok(deepest > 1)
})

void test('a coverage of the wrong length is refused', () => {
  assert.throws(() => distanceField(new Uint8Array(10), [2, 2, 2]))
})

// A box of body, i from 2 to 21, j and k from 2 to 9, in a 24 × 12 × 12 grid of 2 mm voxels: chain 0 up to i = 11 and
// chain 1 from 12, parted by a wall at i = 11.5 that each side records within 12 mm, or one chain with no wall
const box: Triple = [24, 12, 12]
const plainAxes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: 1 } }
function walledBox(walled: boolean) {
  const count = cellCount(box)
  const coverage = coverageOf(box, (i, j, k) => i >= 2 && i <= 21 && j >= 2 && j <= 9 && k >= 2 && k <= 9)
  const chain = new Uint8Array(count)
  const other = new Uint8Array(count).fill(noChain)
  const wall = new Uint8Array(count).fill(wallMiddle)
  if (walled) {
    for (let k = 0; k < box[2]; k++) {
      for (let j = 0; j < box[1]; j++) {
        for (let i = 0; i < box[0]; i++) {
          const n = cellIndex(box, i, j, k)
          chain[n] = i <= 11 ? 0 : 1
          const millimetres = (11.5 - i) * 2
          if (Math.abs(millimetres) > 12) continue
          other[n] = i <= 11 ? 1 : 0
          wall[n] = Math.max(0, Math.min(255, Math.round(wallMiddle + wallSlope * millimetres)))
        }
      }
    }
  }
  return { coverage, chains: { chain, other, wall } }
}

void test('a chain\'s distance falls to nothing at its wall, so its shell at a depth closes on its own side', () => {
  const { coverage, chains } = walledBox(true)
  const plain = distanceField(coverage, box)
  const sides = [0, 1].map((side) => chainDistanceField(coverage, box, chains, side))
  assert.ok(hasWallsTo(chains, 0) && hasWallsTo(chains, 1))
  // Along the box's middle row: each side's voxel beside the wall is one voxel in, the far side outside, while the
  // plain distance there is the box's own
  const middle = (i: number) => cellIndex(box, i, 5, 5)
  assert.equal(sides[0][middle(11)], 1)
  assert.equal(sides[0][middle(12)], 0)
  assert.equal(sides[1][middle(12)], 1)
  assert.equal(sides[1][middle(11)], 0)
  assert.ok(plain[middle(11)] > 3)
  // Far from the wall each side's distance is the plain one
  assert.equal(sides[0][middle(3)], plain[middle(3)])
  assert.equal(sides[1][middle(20)], plain[middle(20)])

  // The shell 1.5 voxels under the skin: each side's is closed, every edge of its triangles shared by two of them, and
  // its faces stay on their own side of the wall, a depth away from it
  const level = skinDistance + 1.5
  const shell = meshRiggedShell({
    distance: plain,
    chainDistances: sides,
    level,
    size: box,
    spacing: [2, 2, 2],
    origin: [0, 0, 0],
    axes: plainAxes,
    ...chains,
  })
  const sideOf = (t: number) => shell.sides[shell.indices[t * 3]]
  for (const side of [0, 1]) {
    const uses = new Map<string, number>()
    for (let t = 0; t < shell.indices.length / 3; t++) {
      if (sideOf(t) !== side) continue
      const corners = [shell.indices[t * 3], shell.indices[t * 3 + 1], shell.indices[t * 3 + 2]]
      for (const corner of corners) assert.equal(shell.sides[corner], side)
      for (let e = 0; e < 3; e++) {
        const a = corners[e]
        const b = corners[(e + 1) % 3]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        uses.set(key, (uses.get(key) ?? 0) + 1)
      }
    }
    assert.ok(uses.size > 0)
    for (const [edge, used] of uses) assert.equal(used, 2, `side ${side}'s edge ${edge} is used ${used} times`)
  }
  // The wall at x = 23 mm: side 0's shell keeps to x below it, side 1's above, each closing face a depth from it, and
  // none is marked as a wall's face to hide, since each lies apart from the other's
  for (let v = 0; v < shell.sides.length; v++) {
    const x = shell.positions[v * 3]
    assert.ok(shell.sides[v] === 0 ? x < 23 - 2 : x > 23 + 2, `side ${shell.sides[v]}'s vertex at x = ${x}`)
    assert.equal(shell.walls[v], 0)
  }
})

void test('with no wall, a chain\'s distance is the plain field bit for bit, and its shell the plain one', () => {
  const { coverage, chains } = walledBox(false)
  const plain = distanceField(coverage, box)
  assert.ok(!hasWallsTo(chains, 0))
  assert.deepEqual(chainDistanceField(coverage, box, chains, 0), plain)
  const level = skinDistance + 1.5
  const shell = meshRiggedShell({ distance: plain, chainDistances: [], level, size: box, spacing: [2, 2, 2], origin: [0, 0, 0], axes: plainAxes, ...chains })
  // Every vertex lies on the plain field's crossing of the level, and none on a wall
  assert.ok(shell.indices.length > 0)
  assert.ok(shell.walls.every((flag) => flag === 0))
  for (let v = 0; v < shell.sides.length; v++) assert.equal(shell.sides[v], 0)
})
