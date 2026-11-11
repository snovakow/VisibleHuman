import assert from 'node:assert/strict'
import { test } from 'node:test'
import { axesFromBytes, cellCount, cellIndex, scenePosition, type Triple, type Volume } from '../src/volume/format.ts'
import { bodyBounds, bodyIndices, buildBody, buildLevel, levelOf, stageBody } from '../src/volume/levels.ts'

// The levels: every body voxel, and the coarser levels' blocks, each at the centre of its body voxels and coloured by
// their mean, all centred on the body's bounds

// A volume of a grid size with body voxels at the listed places, each with its colour, listed in any order. The rest
// of the grid has coverage under the body's 128 and a colour of its own, which no level may take
function volumeOf(size: Triple, cells: { at: Triple; rgb: Triple }[]): Volume {
  const voxels = cellCount(size)
  const coverage = new Uint8Array(voxels).fill(90)
  const red = new Uint8Array(voxels).fill(250)
  const green = new Uint8Array(voxels).fill(250)
  const blue = new Uint8Array(voxels).fill(250)
  for (const { at, rgb } of cells) {
    const index = cellIndex(size, ...at)
    coverage[index] = 200
    red[index] = rgb[0]
    green[index] = rgb[1]
    blue[index] = rgb[2]
  }
  return {
    size,
    spacing: [3.96, 3.96, 4],
    origin: [0, 0, 0],
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

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-3, `${actual} is not close to ${expected}`)

// A cell's centre in a level, in the scene, and where it's expected: a grid place, centred on the bounds
function assertCentre(centers: Float32Array, n: number, volume: Volume, center: Triple, at: Triple) {
  const expected = scenePosition(volume, ...at)
  for (let axis = 0; axis < 3; axis++) close(centers[n * 3 + axis], expected[axis] - center[axis])
}

void test('the body voxels are listed in index order, by a coverage of at least 128', () => {
  const volume = volumeOf(
    [3, 2, 2],
    [
      { at: [2, 1, 1], rgb: [1, 2, 3] },
      { at: [0, 0, 0], rgb: [4, 5, 6] },
      { at: [1, 1, 0], rgb: [7, 8, 9] },
    ],
  )
  // At the threshold is body, a step under it isn't
  volume.coverage[cellIndex(volume.size, 2, 0, 0)] = 128
  volume.coverage[cellIndex(volume.size, 0, 1, 1)] = 127
  assert.deepEqual([...bodyIndices(volume)], [0, 2, 4, 11])
})

void test('the bounds reach half a voxel past the body voxels, in the scene axes', () => {
  const volume = volumeOf(
    [4, 3, 5],
    [
      { at: [1, 0, 1], rgb: [0, 0, 0] },
      { at: [3, 2, 4], rgb: [0, 0, 0] },
    ],
  )
  const { center, half } = bodyBounds(volume)
  // Across i, from voxel 1 to voxel 3: x from 3.96 to 11.88, then half a voxel either way
  close(center[0], 7.92)
  close(half[0], 3.96 * 1.5)
  // Down the slices, k from 1 to 4: y from −4 to −16, which runs backwards
  close(center[1], -10)
  close(half[1], 4 * 2)
  // Down the image, j from 0 to 2: z from 0 to 7.92
  close(center[2], 3.96)
  close(half[2], 3.96 * 1.5)
})

void test('the finest level is every body voxel, at its centre and in its colour', () => {
  const cells: { at: Triple; rgb: Triple }[] = [
    { at: [0, 0, 0], rgb: [10, 20, 30] },
    { at: [2, 1, 0], rgb: [40, 50, 60] },
    { at: [1, 1, 2], rgb: [70, 80, 90] },
  ]
  const volume = volumeOf([3, 2, 3], cells)
  const bounds = bodyBounds(volume)
  const level = buildLevel(volume, bounds, 1)
  assert.equal(level.block, 1)
  assert.equal(level.label, '4 mm')
  assert.equal(level.count, 3)
  close(level.spacing, (3.96 + 3.96 + 4) / 3)
  cells.forEach((cell, n) => assertCentre(level.centers, n, volume, bounds.center, cell.at))
  assert.deepEqual([...level.colors], [10, 20, 30, 40, 50, 60, 70, 80, 90])
})

void test('a coarser block sits at the centre of its body voxels, in their mean colour', () => {
  // Three body voxels in the first 2 × 2 × 2 block, one in the block above it along k, and one in a partial block at
  // the grid's edge along i, which is three voxels wide
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
  assert.equal(level.block, 2)
  assert.equal(level.label, '8 mm')
  assert.equal(level.count, 3)
  close(level.spacing, ((3.96 + 3.96 + 4) / 3) * 2)
  // In index order: the first block, then the edge block beside it, then the block above along k
  assertCentre(level.centers, 0, volume, bounds.center, [2 / 3, 1 / 3, 1 / 3])
  assertCentre(level.centers, 1, volume, bounds.center, [2, 1, 1])
  assertCentre(level.centers, 2, volume, bounds.center, [0, 1, 3])
  // (10 + 20 + 31) / 3 rounds to 20, and (100 + 100 + 101) / 3 to 100
  assert.deepEqual([...level.colors], [20, 0, 100, 200, 200, 200, 5, 6, 7])
})

void test('the blocks start at the body, not at the margin around it', () => {
  // A one-voxel margin on every face, as the files have: the body is voxels 1 and 2 along each axis, which one
  // 2 × 2 × 2 block holds. Blocks started at the grid's first voxel would split it into eight
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let k = 1; k <= 2; k++) {
    for (let j = 1; j <= 2; j++) for (let i = 1; i <= 2; i++) cells.push({ at: [i, j, k], rgb: [8 * i, 8 * j, 8 * k] })
  }
  const volume = volumeOf([4, 4, 4], cells)
  const bounds = bodyBounds(volume)
  const level = buildLevel(volume, bounds, 2)
  assert.equal(level.count, 1)
  assertCentre(level.centers, 0, volume, bounds.center, [1.5, 1.5, 1.5])
  assert.deepEqual([...level.colors], [12, 12, 12])
})

void test('the 16 mm level merges 4 × 4 × 4 blocks, and every level shares the bounds', () => {
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) cells.push({ at: [i, k % 2, k], rgb: [i * 10, 0, 0] })
  cells.push({ at: [5, 0, 7], rgb: [255, 255, 255] })
  const volume = volumeOf([6, 2, 8], cells)
  const { bounds, levels } = buildBody(volume)
  assert.deepEqual(
    levels.map((level) => level.label),
    ['4 mm', '8 mm', '16 mm', '32 mm'],
  )
  const finest = levelOf(levels, 1)
  const merged = levelOf(levels, 4)
  assert.ok(finest && merged)
  assert.equal(finest.count, 17)
  assert.equal(merged.count, 2)
  // The first block's sixteen voxels average 1.5 across i, 0.5 down j and 1.5 down k, and 15 in red
  assertCentre(merged.centers, 0, volume, bounds.center, [1.5, 0.5, 1.5])
  assertCentre(merged.centers, 1, volume, bounds.center, [5, 0, 7])
  assert.deepEqual([...merged.colors], [15, 0, 0, 255, 255, 255])
})

void test('a level over the cap is left out, and the default is the finest within its limit', () => {
  // Twelve body voxels in a row along i: 12 at the finest level, then 6, 3 and 2
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let i = 0; i < 12; i++) cells.push({ at: [i, 0, 0], rgb: [i, i, i] })
  const volume = volumeOf([12, 1, 1], cells)
  const counts = (limits: { maxCells: number; defaultCells: number }) => {
    const { levels, defaultDetail } = buildBody(volume, limits)
    return { blocks: levels.map((level) => [level.block, level.count]), defaultDetail }
  }
  // Under the limits the page uses, every level is kept and the finest is the default
  assert.deepEqual(buildBody(volume).levels.length, 4)
  assert.equal(buildBody(volume).defaultDetail, 1)
  // A cap of 6 leaves out the finest level; the finest of at most 3 is the 4-voxel block's
  assert.deepEqual(counts({ maxCells: 6, defaultCells: 3 }), {
    blocks: [
      [2, 6],
      [4, 3],
      [8, 2],
    ],
    defaultDetail: 4,
  })
  // At exactly the cap a level is kept, and with no level within the default's limit the coarsest is opened on
  assert.deepEqual(counts({ maxCells: 12, defaultCells: 1 }).defaultDetail, 8)
  assert.equal(counts({ maxCells: 12, defaultCells: 1 }).blocks.length, 4)
  assert.throws(() => buildBody(volume, { maxCells: 1, defaultCells: 1 }), /more than 1 cells/)
})

void test('a cell\'s coverage is its voxel\'s, and a block\'s the mean over all eight of its voxels', () => {
  // One 2 × 2 × 2 block, with three body voxels and five under the body's 128, all of whose coverages count; and a
  // second block along i with one body voxel, past the grid's edge: its four voxels outside the grid count as uncovered
  const volume = volumeOf(
    [3, 2, 2],
    [
      { at: [0, 0, 0], rgb: [0, 0, 0] },
      { at: [1, 1, 0], rgb: [0, 0, 0] },
      { at: [0, 1, 1], rgb: [0, 0, 0] },
      { at: [2, 0, 0], rgb: [0, 0, 0] },
    ],
  )
  const set = (at: Triple, value: number) => {
    volume.coverage[cellIndex(volume.size, ...at)] = value
  }
  set([0, 0, 0], 255)
  set([1, 1, 0], 128)
  set([0, 1, 1], 200)
  set([1, 0, 0], 127)
  set([0, 1, 0], 10)
  set([1, 0, 1], 0)
  set([0, 0, 1], 40)
  set([1, 1, 1], 1)
  set([2, 0, 0], 240)
  set([2, 1, 0], 100)
  set([2, 0, 1], 20)
  set([2, 1, 1], 0)
  const bounds = bodyBounds(volume)
  assert.deepEqual([...buildLevel(volume, bounds, 1).coverage], [255, 240, 128, 200])
  const merged = buildLevel(volume, bounds, 2)
  // (255 + 127 + 10 + 128 + 40 + 0 + 200 + 1) / 8 = 95.125, and (240 + 100 + 20 + 0) / 8 = 45
  assert.deepEqual([...merged.coverage], [95, 45])
})

// A body of scattered voxels over several layers of blocks, with a margin, partial blocks at the grid's far edges, and
// colours and coverages that vary voxel by voxel, from a fixed sequence so every run builds the same
function scatteredVolume(): Volume {
  const size: Triple = [13, 11, 19]
  let seed = 12345
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let k = 1; k < size[2]; k++) {
    for (let j = 1; j < size[1]; j++) {
      for (let i = 1; i < size[0]; i++) {
        if (next() < 0.6) cells.push({ at: [i, j, k], rgb: [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)] })
      }
    }
  }
  const volume = volumeOf(size, cells)
  for (let index = 0; index < volume.coverage.length; index++) {
    volume.coverage[index] = volume.coverage[index] === 200 ? 128 + Math.floor(next() * 128) : Math.floor(next() * 128)
  }
  return volume
}

void test('the levels built a share at a time, in any order, equal those built at once, element for element', () => {
  const volume = scatteredVolume()
  // Limits under which the opening is the 16 mm level, which leaves the 4 mm level to build after it
  const limits = { maxCells: 5000, defaultCells: 100 }
  const atOnce = buildBody(volume, limits)
  assert.equal(atOnce.levels.length, 4)
  assert.equal(atOnce.defaultDetail, 4)
  const coarsestFirst = (built: readonly { block: number }[]) => [8, 4, 2, 1].find((block) => !built.some((level) => level.block === block))
  for (const opening of [undefined, '8 mm', '32 mm', '4 mm']) {
    for (const voxels of [1, 7, 1000]) {
      for (const order of ['finest', 'coarsest', 'alternating'] as const) {
        const staged = stageBody(volume, { limits, opening })
        let turn = 0
        for (;;) {
          const first = order === 'finest' ? undefined : order === 'coarsest' || turn % 2 === 0 ? coarsestFirst(staged.levels) : 1
          turn++
          if (!staged.advance(voxels, first)) break
        }
        assert.deepEqual(staged.bounds, atOnce.bounds)
        assert.deepEqual(staged.levels, atOnce.levels, `opening ${opening}, ${voxels} voxels a share, ${order} first`)
        assert.deepEqual(
          staged.details,
          atOnce.levels.map((level) => ({ block: level.block, label: level.label })),
        )
      }
    }
  }
})

void test('the opening level is built first, without the finest, whose count is the body voxel count', () => {
  const volume = scatteredVolume()
  const limits = { maxCells: 5000, defaultCells: 100 }
  const bodyVoxels = bodyIndices(volume).length
  assert.ok(bodyVoxels > limits.defaultCells && bodyVoxels <= limits.maxCells)
  // The 8 mm level is over the opening's limit, which is only known once it's built, so the search builds it on its
  // way to the 16 mm level; the 4 mm and 32 mm levels wait, and every Detail is listed from the start
  const staged = stageBody(volume, { limits })
  assert.equal(staged.opening.block, 4)
  assert.deepEqual(
    staged.levels.map((level) => level.block),
    [2, 4],
  )
  assert.deepEqual(
    staged.details.map((detail) => detail.label),
    ['4 mm', '8 mm', '16 mm', '32 mm'],
  )
  // An opening by label builds that level alone
  const coarsest = stageBody(volume, { limits, opening: '32 mm' })
  assert.equal(coarsest.opening.block, 8)
  assert.deepEqual(
    coarsest.levels.map((level) => level.block),
    [8],
  )
  // A label the body has only over the cap, or not at all, opens as the default does
  for (const opening of ['4 mm', '2 mm']) {
    const capped = stageBody(volume, { limits: { maxCells: bodyVoxels - 1, defaultCells: 100 }, opening })
    assert.equal(capped.opening.block, 4)
    assert.deepEqual(
      capped.details.map((detail) => detail.label),
      ['8 mm', '16 mm', '32 mm'],
    )
  }
})

// An L of body voxels, fifteen along i and j, under a cap of ten cells: the 4 mm level, a cell per body voxel, is over
// it, and the 8 mm blocks could hold up to fifteen cells but hold seven
const lLimits = { maxCells: 10, defaultCells: 5 }
function lVolume(): Volume {
  const cells: { at: Triple; rgb: Triple }[] = []
  for (let n = 0; n < 8; n++) cells.push({ at: [n, 0, 0], rgb: [n, 0, 0] })
  for (let n = 1; n < 8; n++) cells.push({ at: [0, n, 0], rgb: [0, n, 0] })
  return volumeOf([8, 8, 1], cells)
}

void test('a level not known to be within the cap is listed only once it is built and kept', () => {
  const volume = lVolume()
  const staged = stageBody(volume, { limits: lLimits, opening: '16 mm' })
  assert.deepEqual(
    staged.details.map((detail) => detail.label),
    ['16 mm', '32 mm'],
  )
  while (staged.advance(4));
  assert.deepEqual(
    staged.details.map((detail) => detail.label),
    ['8 mm', '16 mm', '32 mm'],
  )
  assert.equal(levelOf(staged.levels, 2)?.count, 7)
  assert.deepEqual(staged.levels, buildBody(volume, lLimits).levels)
})

void test('a label opens its level wherever it is within the cap, and the finest over the cap is never built', () => {
  const volume = lVolume()
  const share = bodyIndices(volume).length
  const atOnce = buildBody(volume, lLimits).levels
  // The 8 mm level could be over the cap, as a finer file's level of the Detail shown can be, but isn't, so it opens
  // as the 16 mm level does
  for (const [opening, block] of [
    ['8 mm', 2],
    ['16 mm', 4],
  ] as const) {
    const staged = stageBody(volume, { limits: lLimits, opening })
    assert.equal(staged.opening.block, block, `opening ${opening}`)
    // A share of every body voxel builds one level a call: the two still to build, and never the 4 mm level
    let calls = 1
    while (staged.advance(share)) calls++
    assert.equal(calls, 2, `opening ${opening}`)
    assert.deepEqual(staged.levels, atOnce)
  }
})
