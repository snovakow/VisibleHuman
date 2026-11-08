import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellIndex, maskBytes, scenePosition, type Triple, type Volume } from '../src/volume/format.ts'
import { bodyBounds, bodyIndices, buildBody, buildLevel } from '../src/volume/levels.ts'

// The levels: every 4 mm cell, and the coarser levels' blocks, each at the centre of its body cells and coloured by
// their mean, all centred on the body's bounds

// A volume of a grid size with body cells at the listed places, each with its colour, listed in any order
function volumeOf(size: Triple, cells: { at: Triple; rgb: Triple }[]): Volume {
  const sorted = cells
    .map((cell) => ({ ...cell, index: cellIndex(size, ...cell.at) }))
    .sort((a, b) => a.index - b.index)
  const mask = new Uint8Array(maskBytes(size[0] * size[1] * size[2]))
  for (const { index } of sorted) mask[index >> 3] |= 1 << (index & 7)
  return {
    size,
    spacing: [3.96, 3.96, 4],
    offset: [0, 0, 0],
    firstSlice: 1001,
    lastSlice: 1001 + size[2] * 4 - 1,
    mask,
    colors: Uint8Array.from(sorted.flatMap((cell) => [...cell.rgb])),
  }
}

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-3, `${actual} is not close to ${expected}`)

// A cell's centre in a level, in the scene, and where it's expected: a grid place, centred on the bounds
function assertCentre(centers: Float32Array, n: number, volume: Volume, center: Triple, at: Triple) {
  const expected = scenePosition(volume, ...at)
  for (let axis = 0; axis < 3; axis++) close(centers[n * 3 + axis], expected[axis] - center[axis])
}

void test('the body cells are listed in index order, skipping the mask padding', () => {
  const volume = volumeOf(
    [3, 2, 2],
    [
      { at: [2, 1, 1], rgb: [1, 2, 3] },
      { at: [0, 0, 0], rgb: [4, 5, 6] },
      { at: [1, 1, 0], rgb: [7, 8, 9] },
    ],
  )
  // A set bit past the last cell, in the mask's last byte, isn't a cell
  volume.mask[1] |= 0x80
  assert.deepEqual([...bodyIndices(volume)], [0, 4, 11])
})

void test('the bounds reach half a cell past the body cells, in the scene axes', () => {
  const volume = volumeOf(
    [4, 3, 5],
    [
      { at: [1, 0, 1], rgb: [0, 0, 0] },
      { at: [3, 2, 4], rgb: [0, 0, 0] },
    ],
  )
  const { center, half } = bodyBounds(volume)
  // Across i, from cell 1 to cell 3: x from 3.96 to 11.88, then half a cell either way
  close(center[0], 7.92)
  close(half[0], 3.96 * 1.5)
  // Down the slices, k from 1 to 4: y from −4 to −16, which runs backwards
  close(center[1], -10)
  close(half[1], 4 * 2)
  // Down the image, j from 0 to 2: z from 0 to 7.92
  close(center[2], 3.96)
  close(half[2], 3.96 * 1.5)
})

void test('the 4 mm level is every body cell, at its centre and in its colour', () => {
  const cells: { at: Triple; rgb: Triple }[] = [
    { at: [0, 0, 0], rgb: [10, 20, 30] },
    { at: [2, 1, 0], rgb: [40, 50, 60] },
    { at: [1, 1, 2], rgb: [70, 80, 90] },
  ]
  const volume = volumeOf([3, 2, 3], cells)
  const bounds = bodyBounds(volume)
  const level = buildLevel(volume, bounds, 1)
  assert.equal(level.count, 3)
  close(level.spacing, (3.96 + 3.96 + 4) / 3)
  cells.forEach((cell, n) => assertCentre(level.centers, n, volume, bounds.center, cell.at))
  assert.deepEqual([...level.colors], [10, 20, 30, 40, 50, 60, 70, 80, 90])
})

void test('a coarser block sits at the centre of its body cells, in their mean colour', () => {
  // Three body cells in the first 2 × 2 × 2 block, one in the block above it along k, and one in a partial block at
  // the grid's edge along i, which is three cells wide
  const volume = volumeOf(
    [3, 2, 4],
    [
      { at: [0, 0, 0], rgb: [10, 0, 100] },
      { at: [1, 0, 0], rgb: [20, 0, 100] },
      { at: [1, 1, 1], rgb: [31, 0, 101] },
      { at: [2, 1, 1], rgb: [200, 200, 200] },
      { at: [0, 1, 3], rgb: [5, 6, 7] },
    ],
  )
  const bounds = bodyBounds(volume)
  const level = buildLevel(volume, bounds, 2)
  assert.equal(level.count, 3)
  close(level.spacing, ((3.96 + 3.96 + 4) / 3) * 2)
  // In index order: the first block, then the edge block beside it, then the block above along k
  assertCentre(level.centers, 0, volume, bounds.center, [2 / 3, 1 / 3, 1 / 3])
  assertCentre(level.centers, 1, volume, bounds.center, [2, 1, 1])
  assertCentre(level.centers, 2, volume, bounds.center, [0, 1, 3])
  // (10 + 20 + 31) / 3 rounds to 20, and (100 + 100 + 101) / 3 to 100
  assert.deepEqual([...level.colors], [20, 0, 100, 200, 200, 200, 5, 6, 7])
})

void test('the 16 mm level merges 4 × 4 × 4 blocks, and every level shares the bounds', () => {
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) cells.push({ at: [i, k % 2, k], rgb: [i * 10, 0, 0] })
  cells.push({ at: [5, 0, 7], rgb: [255, 255, 255] })
  const volume = volumeOf([6, 2, 8], cells)
  const { bounds, levels } = buildBody(volume)
  assert.equal(levels[4].count, 17)
  assert.equal(levels[16].count, 2)
  // The first block's sixteen cells average 1.5 across i, 0.5 down j and 1.5 down k, and 15 in red
  assertCentre(levels[16].centers, 0, volume, bounds.center, [1.5, 0.5, 1.5])
  assertCentre(levels[16].centers, 1, volume, bounds.center, [5, 0, 7])
  assert.deepEqual([...levels[16].colors], [15, 0, 0, 255, 255, 255])
})
