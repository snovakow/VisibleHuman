import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockGrid } from '../src/volume/blockGrid.ts'
import { axesFromBytes, cellCount, cellIndex, type Triple, type Volume } from '../src/volume/format.ts'
import { bodyBounds, buildLevel } from '../src/volume/levels.ts'

// The block grid: the dense grid of the blocks a splat level lists sparsely, each block's coverage the mean over every
// voxel it spans and its colour the mean over those that carry colour, starting at the body's lowest voxel as the
// levels do, with a block of outside around the body's

// A volume of a grid size whose coverage and colour are given per voxel by the functions; the male's spacing and axes
function volumeOf(size: Triple, coverageAt: (at: Triple) => number, colourAt: (at: Triple) => Triple): Volume {
  const voxels = cellCount(size)
  const coverage = new Uint8Array(voxels)
  const red = new Uint8Array(voxels)
  const green = new Uint8Array(voxels)
  const blue = new Uint8Array(voxels)
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const n = cellIndex(size, i, j, k)
        coverage[n] = coverageAt([i, j, k])
        ;[red[n], green[n], blue[n]] = colourAt([i, j, k])
      }
    }
  }
  return {
    size,
    spacing: [3.96, 3.96, 4],
    origin: [10, 20, -2],
    firstSlice: 1001,
    lastSlice: 1001 + size[2] * 4 - 1,
    // The male's: x = i, y = −k, z = j
    axes: axesFromBytes([0x00, 0x82, 0x01]),
    body: 'male',
    red,
    green,
    blue,
    coverage,
  }
}

// A seeded generator, so a test's random volume is the same every run
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
}

// A volume like a file's: a body of random voxels inside a margin of coverage 0, with colour on every body voxel and
// on about half the rest, chosen at random wherever they lie, in place of the band a file dilates its colour into
function randomVolume(size: Triple, seed: number) {
  const next = random(seed)
  const inside = (at: Triple) => at.every((value, axis) => value > 0 && value < size[axis] - 1)
  const coverage = new Map<number, number>()
  for (let n = 0; n < cellCount(size); n++) coverage.set(n, Math.floor(next() * 256))
  return volumeOf(
    size,
    (at) => (inside(at) ? (coverage.get(cellIndex(size, ...at)) ?? 0) : 0),
    (at) => {
      const covered = inside(at) ? (coverage.get(cellIndex(size, ...at)) ?? 0) : 0
      // Body voxels and about half the rest carry colour
      return covered >= 128 || next() < 0.5 ? [1 + Math.floor(next() * 255), Math.floor(next() * 256), Math.floor(next() * 256)] : [0, 0, 0]
    },
  )
}

void test('block 1 is the volume\'s own grid: its coverage, and its colour interleaved', () => {
  const volume = randomVolume([5, 4, 6], 1)
  const grid = blockGrid(volume, 1)
  assert.deepEqual(grid.size, volume.size)
  assert.deepEqual(grid.spacing, volume.spacing)
  assert.deepEqual(grid.origin, volume.origin)
  assert.deepEqual(grid.first, [0, 0, 0])
  assert.deepEqual(grid.coverage, volume.coverage)
  for (let n = 0; n < volume.red.length; n++) {
    assert.deepEqual([...grid.colors.subarray(n * 3, n * 3 + 3)], [volume.red[n], volume.green[n], volume.blue[n]])
  }
})

void test('at block 2, every cell the level lists has a block of the same coverage, and the body is ringed by outside', () => {
  const volume = randomVolume([11, 9, 12], 2)
  const bounds = bodyBounds(volume)
  const level = buildLevel(volume, bounds, 2)
  const grid = blockGrid(volume, 2)
  assert.ok(level.count > 10, `the level lists ${level.count} cells`)
  const [bx, by] = grid.size
  // A cell's centre lies among its block's body voxels: back to the volume's voxels through the male's axes (x = i,
  // y = −k, z = j, each times the spacing), then to the block that spans it
  for (let n = 0; n < level.count; n++) {
    const x = level.centers[n * 3] + bounds.center[0]
    const y = level.centers[n * 3 + 1] + bounds.center[1]
    const z = level.centers[n * 3 + 2] + bounds.center[2]
    const voxel: Triple = [x / volume.spacing[0], z / volume.spacing[1], -y / volume.spacing[2]]
    const at = voxel.map((value, axis) => Math.round((value - grid.first[axis]) / 2))
    assert.equal(grid.coverage[at[0] + bx * (at[1] + by * at[2])], level.coverage[n], `cell ${n}`)
  }
  // The grid's outermost blocks are outside the body
  const [, , bz] = grid.size
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        if (i > 0 && j > 0 && k > 0 && i < bx - 1 && j < by - 1 && k < bz - 1) continue
        assert.ok(grid.coverage[i + bx * (j + by * k)] < 128, `block ${i}, ${j}, ${k} is body`)
      }
    }
  }
  // The blocks are spaced two voxels apart, and block 0's centre in the source frame is its place in the voxels
  assert.deepEqual(grid.spacing, [7.92, 7.92, 8])
  grid.origin.forEach((value, axis) => {
    assert.ok(Math.abs(value - (volume.origin[axis] + grid.first[axis] * volume.spacing[axis])) < 1e-9)
  })
})

void test('a block past the grid\'s edge counts the voxels it misses as uncovered', () => {
  // A 4 × 4 × 4 grid all body but its corner voxel (0, 0, 0): the body's lowest voxel is 0 along each axis, so the
  // padding block before it lies wholly off the grid, and block 1 spans voxels 0 and 1 along each axis
  const size: Triple = [4, 4, 4]
  const volume = volumeOf(size, (at) => (at.every((value) => value === 0) ? 0 : 200), () => [10, 20, 30])
  const grid = blockGrid(volume, 2)
  // The body's two blocks along each axis and one either side
  assert.deepEqual(grid.size, [4, 4, 4])
  assert.deepEqual(grid.first, [-1.5, -1.5, -1.5])
  const at = (i: number, j: number, k: number) => grid.coverage[i + 4 * (j + 4 * k)]
  // Off the grid wholly
  assert.equal(at(0, 0, 0), 0)
  assert.equal(at(0, 1, 1), 0)
  // Seven body voxels and the uncovered corner
  assert.equal(at(1, 1, 1), Math.round((7 * 200) / 8))
  assert.equal(at(2, 2, 2), 200)
  // The last block along i spans voxels 4 and 5, past the grid's last, 3
  assert.equal(at(3, 2, 2), 0)
  // A grid five voxels wide, all body: the body's third block along i spans voxels 4 and 5, of which only 4 is on the
  // grid, and the padding block after it spans none
  const wider = volumeOf([5, 4, 4], () => 200, () => [10, 20, 30])
  const wide = blockGrid(wider, 2)
  assert.deepEqual(wide.size, [5, 4, 4])
  const along = (i: number) => wide.coverage[i + 5 * (2 + 4 * 2)]
  assert.deepEqual([along(0), along(1), along(2), along(3), along(4)], [0, 200, 200, 100, 0])
})

void test('a block\'s colour averages only the voxels that carry colour, and is 0 where none does', () => {
  // Body voxels at i = 2 and 3 of a 6 × 2 × 2 grid's first layer row, coloured; the voxel beside them at i = 4
  // dilated; the rest without colour
  const size: Triple = [6, 2, 2]
  const body = (at: Triple) => at[1] === 0 && at[2] === 0 && (at[0] === 2 || at[0] === 3)
  const volume = volumeOf(
    size,
    (at) => (body(at) ? 255 : 0),
    (at) => (at[1] === 0 && at[2] === 0 ? ({ 2: [100, 0, 30], 3: [200, 50, 31], 4: [11, 13, 17] } as Record<number, Triple>)[at[0]] ?? [0, 0, 0] : [0, 0, 0]),
  )
  const grid = blockGrid(volume, 2)
  // The body is one block wide, from voxel 2: blocks from voxel 0 (padding), 2 (the body's) and 4 (padding) along i
  assert.deepEqual(grid.size, [3, 3, 3])
  const colour = (i: number, j: number, k: number) => [...grid.colors.subarray((i + 3 * (j + 3 * k)) * 3, (i + 3 * (j + 3 * k)) * 3 + 3)]
  // The body's block: the mean of its two coloured voxels, its six colourless ones left out
  assert.deepEqual(colour(1, 1, 1), [150, 25, 31])
  // The padding block after it holds the one dilated voxel
  assert.deepEqual(colour(2, 1, 1), [11, 13, 17])
  // And the one before it none
  assert.deepEqual(colour(0, 1, 1), [0, 0, 0])
  // The body's block's coverage is still the mean over all eight
  assert.equal(grid.coverage[1 + 3 * (1 + 3 * 1)], Math.round((2 * 255) / 8))
})
