import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillMissingLayers, isBodyCell, isBodyPixel, largestPiece, missingReason } from '../src/volume/segment.ts'

// The body rule, on colours sampled from slice 1500; the missing slices, on counts measured around 2017 to 2020; and the
// gap filling and the piece-keeping, on small grids built here

void test('the body rule passes body colours', () => {
  const tissue = [
    [100, 50, 33], // liver
    [77, 43, 30], // dark muscle
    [59, 37, 29], // clotted blood in the heart
    [191, 160, 115], // pale muscle and fat
    [230, 229, 168], // costal cartilage
  ]
  for (const [r, g, b] of tissue) assert.ok(isBodyPixel(r, g, b), `${r} ${g} ${b}`)
})

void test('the body rule refuses gel blue, black and grey', () => {
  const background = [
    [24, 43, 69], // the gel
    [23, 31, 49], // the gel in shadow
    [32, 47, 55], // the gel's edge
    [17, 18, 15], // the frame
    [25, 25, 23], // the card's dark end
    [59, 65, 57], // the card's mid grey
    [240, 240, 239], // the card's white end
    [115, 134, 116], // a fiducial dot
  ]
  for (const [r, g, b] of background) assert.ok(!isBodyPixel(r, g, b), `${r} ${g} ${b}`)
})

void test('a cell is body when most of its pixels are', () => {
  assert.ok(isBodyCell(289, 576))
  assert.ok(!isBodyCell(288, 576))
  assert.ok(!isBodyCell(0, 0))
})

// A grid of nx × ny × nz cells with the given cells set, by (i, j, k)
function grid(nx: number, ny: number, nz: number, body: (readonly [number, number, number])[]) {
  const cells = new Uint8Array(nx * ny * nz)
  for (const [i, j, k] of body) cells[i + nx * (j + ny * k)] = 1
  return cells
}
const setCells = (cells: Uint8Array) => cells.reduce<number[]>((set, value, index) => (value ? [...set, index] : set), [])

void test('the piece-keeping keeps the larger of two pieces', () => {
  // Three cells in a row on the left, two on the right, a gap between
  const cells = grid(6, 1, 1, [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [4, 0, 0],
    [5, 0, 0],
  ])
  const kept = largestPiece(cells, 6, 1, 1)
  assert.equal(kept.size, 3)
  assert.deepEqual(setCells(kept.cells), [0, 1, 2])
})

void test('the piece-keeping joins pieces that touch only across a slice', () => {
  // Two cells in slice 0 and two in slice 1, touching face to face only between the slices, beat three cells elsewhere
  const cells = grid(4, 4, 2, [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
    [3, 3, 0],
    [3, 2, 0],
    [3, 1, 0],
  ])
  const kept = largestPiece(cells, 4, 4, 2)
  assert.equal(kept.size, 4)
  assert.deepEqual(setCells(kept.cells), [0, 1, 17, 21])
})

void test('the piece-keeping doesn\'t join cells that touch only along an edge or at a corner', () => {
  const cells = grid(2, 2, 2, [
    [0, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
  ])
  assert.equal(largestPiece(cells, 2, 2, 2).size, 1)
  // At a corner only: the two cells differ along all three axes
  const corner = grid(2, 2, 2, [
    [0, 0, 0],
    [1, 1, 1],
  ])
  assert.equal(largestPiece(corner, 2, 2, 2).size, 1)
})

void test('the piece-keeping finds nothing in an empty grid', () => {
  const kept = largestPiece(new Uint8Array(8), 2, 2, 2)
  assert.equal(kept.size, 0)
  assert.deepEqual(setCells(kept.cells), [])
})

void test('a slice with no body pixels is blank', () => {
  assert.equal(missingReason(0, [808_496], [742_292]), 'blank')
  assert.equal(missingReason(0, [], []), 'blank')
})

void test('a slice far short of the slices on both sides is short', () => {
  // Body pixels of slices 2009 to 2016 before, and 2021 to 2028 after, nearest first, as measured or about so
  const before = [808_496, 811_062, 812_000, 813_000, 815_000, 816_000, 818_000, 820_000]
  const after = [721_827, 742_292, 740_000, 738_000, 736_000, 734_000, 732_000, 730_000]
  // 2017 to 2020, under their frosty cast; the reference is the smaller side's largest, 742,292
  for (const body of [59_659, 150_138, 316_259, 585_625]) assert.equal(missingReason(body, before, after), 'short')
  // 2021, nearly clear of it
  assert.equal(missingReason(721_827, before, after), null)
})

void test('a slice with fewer than eight counts on one side is never short', () => {
  // Body pixels of slices 1001 to 1012, as measured: the crown widens fast, and 1002 is a sixth under 1001
  const crown = [58_126, 49_282, 56_498, 57_970, 54_000, 58_102, 68_683, 69_922, 71_959, 76_254, 74_186, 85_436]
  const windows = (slice: number) => ({
    before: crown.slice(0, slice).reverse().slice(0, 8),
    after: crown.slice(slice + 1, slice + 9),
  })
  // 1002 has one slice before it, and 1008 only seven, so neither is judged, whatever the slices after them say
  const second = windows(1)
  assert.equal(second.before.length, 1)
  assert.equal(missingReason(crown[1], second.before, second.after), null)
  const eighth = windows(7)
  assert.equal(eighth.before.length, 7)
  assert.equal(missingReason(30_000, eighth.before, eighth.after), null)
  // With eight on each side, the same count would be short
  assert.equal(missingReason(30_000, crown.slice(0, 8).reverse(), crown.slice(8, 12).concat([80_000, 80_000, 80_000, 80_000])), 'short')
})

void test('a taper is never short, since one side has no larger slice or no slice at all', () => {
  // The soles: the body shrinks to the last slice read
  assert.equal(missingReason(20_000, [180_000, 200_000], []), null)
  // The crown: the first slice read, before the head widens
  assert.equal(missingReason(5_000, [], [30_000, 60_000]), null)
  // A steady shrink: each slice is about as large as the next one
  assert.equal(missingReason(500_000, [520_000, 540_000], [490_000, 480_000]), null)
})

// A grid of layers of two cells, each layer's cells set and coloured by its number, and empty where missing
function layered(missing: readonly boolean[]) {
  const cells = new Uint8Array(missing.length * 2)
  const colors = new Uint8Array(missing.length * 6)
  missing.forEach((gap, layer) => {
    if (gap) return
    cells.fill(1, layer * 2, layer * 2 + 2)
    colors.fill(layer + 1, layer * 6, layer * 6 + 6)
  })
  return { cells, colors }
}

void test('the gap filling fills the upper half of a gap from above and the lower half from below', () => {
  const missing = [false, true, true, true, true, false]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers(cells, colors, 2, missing), [0, 0, 0, 5, 5, 5])
  assert.deepEqual([...cells], Array.from({ length: 12 }, () => 1))
  assert.deepEqual([...colors], [1, 1, 1, 6, 6, 6].flatMap((value) => [value, value, value, value, value, value]))
})

void test('the gap filling fills the middle of an odd gap from above', () => {
  const missing = [false, true, true, true, false]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers(cells, colors, 2, missing), [0, 0, 0, 4, 4])
  assert.deepEqual([...colors.subarray(12, 18)], [1, 1, 1, 1, 1, 1])
})

void test('the gap filling fills a gap at either end from the one side it has', () => {
  const missing = [true, false, false, true, true]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers(cells, colors, 2, missing), [1, 1, 2, 2, 2])
  assert.deepEqual([...colors.subarray(0, 6)], [2, 2, 2, 2, 2, 2])
  assert.deepEqual([...colors.subarray(24, 30)], [3, 3, 3, 3, 3, 3])
})

void test('the gap filling joins the body across a gap into one piece', () => {
  // One cell per layer, a column of four, with the middle two layers missing
  const missing = [false, true, true, false]
  const cells = Uint8Array.from([1, 0, 0, 1])
  const colors = new Uint8Array(12)
  assert.equal(largestPiece(cells, 1, 1, 4).size, 1)
  fillMissingLayers(cells, colors, 1, missing)
  assert.equal(largestPiece(cells, 1, 1, 4).size, 4)
})

void test('the gap filling leaves a grid with no read layer empty', () => {
  const missing = [true, true]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers(cells, colors, 2, missing), [-1, -1])
  assert.deepEqual([...cells], [0, 0, 0, 0])
})
