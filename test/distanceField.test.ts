import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distanceField } from '../src/surface/distanceField.ts'
import { cellCount, cellIndex, type Triple } from '../src/volume/format.ts'

// The distance field: each body voxel's Euclidean distance in voxels to the nearest voxel centre outside the body, 0
// outside, checked on a cube, a lone voxel and against a brute-force search

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
