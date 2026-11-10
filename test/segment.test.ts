import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  enclosedCells,
  filesSpanning,
  fillMissingLayers,
  frostedReason,
  frostShare,
  frostSide,
  iceSpreadShare,
  isBodyCell,
  isBodyPixel,
  isThinLayer,
  isTissueOnIce,
  largestPiece,
  missingReason,
  thinShare,
} from '../src/volume/segment.ts'

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
  assert.equal(missingReason(0, [808_496], [742_292], 8), 'blank')
  assert.equal(missingReason(0, [], [], 8), 'blank')
})

void test('a slice far short of the slices on both sides is short', () => {
  // Body pixels of slices 2009 to 2016 before, and 2021 to 2028 after, nearest first, as measured or about so
  const before = [808_496, 811_062, 812_000, 813_000, 815_000, 816_000, 818_000, 820_000]
  const after = [721_827, 742_292, 740_000, 738_000, 736_000, 734_000, 732_000, 730_000]
  // 2017 to 2020, under their frosty cast; the reference is the smaller side's largest, 742,292
  for (const body of [59_659, 150_138, 316_259, 585_625]) assert.equal(missingReason(body, before, after, 8), 'short')
  // 2021, nearly clear of it
  assert.equal(missingReason(721_827, before, after, 8), null)
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
  assert.equal(missingReason(crown[1], second.before, second.after, 8), null)
  const eighth = windows(7)
  assert.equal(eighth.before.length, 7)
  assert.equal(missingReason(30_000, eighth.before, eighth.after, 8), null)
  // With eight on each side, the same count would be short
  assert.equal(missingReason(30_000, crown.slice(0, 8).reverse(), crown.slice(8, 12).concat([80_000, 80_000, 80_000, 80_000]), 8), 'short')
})

void test('a taper is never short, since one side has no larger slice or no slice at all', () => {
  // The soles: the body shrinks to the last slice read
  assert.equal(missingReason(20_000, [180_000, 200_000], [], 8), null)
  // The crown: the first slice read, before the head widens
  assert.equal(missingReason(5_000, [], [30_000, 60_000], 8), null)
  // A steady shrink: each slice is about as large as the next one
  assert.equal(missingReason(500_000, [520_000, 540_000], [490_000, 480_000], 8), null)
})

// The female's body pixel counts from 1484a to 1502c, in thousands, a, b and c in turn: clear to 1488c, thinning
// under the frost from 1489a, the black frames 1492b to 1497b, then the frost thinning out again to 1500a. Some are
// as measured (2026-11-10), the others between them about so
const femaleFace = [
  ...Array.from({ length: 15 }, () => 830), // 1484a to 1488c
  782, 691, 621, // 1489
  319, 180, 110, // 1490
  70, 50, 40, // 1491
  30, 0, 0, // 1492, its b and c black
  ...Array.from({ length: 12 }, () => 0), // 1493 to 1496
  0, 0, 230, // 1497, its a and b black
  318, 444, 608, // 1498
  689, 724, 750, // 1499
  ...Array.from({ length: 9 }, () => 760), // 1500a to 1502c
].map((thousands) => thousands * 1000)
// The non-blank counts within a window of so many files either side of the file at a position, nearest first
const windowsAt = (counts: readonly number[], position: number, window: number) => {
  const take = (from: number, step: number) => {
    const found: number[] = []
    for (let p = from; p >= 0 && p < counts.length && found.length < window; p += step) if (counts[p] > 0) found.push(counts[p])
    return found
  }
  return { before: take(position - 1, -1), after: take(position + 1, 1) }
}

void test("the short rule's window spans 8 mm of every body, in its own files", () => {
  assert.equal(filesSpanning(8, 1), 8)
  assert.equal(filesSpanning(8, 1 / 3), 24)
  assert.equal(filesSpanning(8, 0.147), 54)
})

void test("over 8 mm of the female's slices, 1490a is short against 1499 to 1502, where eight files reach only frosted ones", () => {
  // Her window of 24 files reaches back past 1484 and on past the black frames to 1503; the eight files 2.7 mm long
  // reach 1498a after it, which the frost has thinned as much as 1490a
  const counts = [...Array.from({ length: 12 }, () => 830_000), ...femaleFace, ...Array.from({ length: 6 }, () => 760_000)]
  const at = 12 + 18 // 1490a
  const wide = windowsAt(counts, at, 24)
  assert.equal(missingReason(counts[at], wide.before, wide.after, 24), 'short')
  const narrow = windowsAt(counts, at, 8)
  assert.equal(Math.max(...narrow.after), 318_000)
  assert.equal(missingReason(counts[at], narrow.before, narrow.after, 8), null)
  // 1489c, at 621 thousand, is short only against the wider window too, and 1488c, clear of the frost, is kept by both
  const frosty = windowsAt(counts, at - 1, 24)
  assert.equal(missingReason(counts[at - 1], frosty.before, frosty.after, 24), 'short')
  const clear = windowsAt(counts, at - 4, 24)
  assert.equal(missingReason(counts[at - 4], clear.before, clear.after, 24), null)
})

void test('the frost rule flags a slice 11 % bluer than its reference and not one 9 % or 6 % bluer', () => {
  // The male's 1506 rises 12.3 % and the female's 1499b 10.4 %; the colour card beside the male's 2436 to 2442 up to 9.3 %
  const references = [0.55, 0.56, 0.54, 0.555, 0.545]
  assert.equal(frostedReason(0.55 * 1.11, references), 'frosted')
  assert.equal(frostedReason(0.55 * 1.09, references), null)
  assert.equal(frostedReason(0.55 * 1.06, references), null)
  // The reference is the median, so one frosted slice among the references doesn't move it
  assert.equal(frostedReason(0.55 * 1.11, [...references, 0.8]), 'frosted')
  // Exactly the share above isn't more than it
  assert.equal(frostedReason(0.5 * (1 + frostShare), [0.5]), null)
  assert.equal(frostedReason(0.9, []), null)
})

void test('a slice is judged for frost only within 8 mm of a face, from the side away from the nearest', () => {
  // The female's files, a third of a millimetre apart: 8 mm is 24 of them. A face at 100 lies between files 99 and 100
  const reach = filesSpanning(8, 1 / 3)
  assert.equal(frostSide(100, [100], reach), 1)
  // 23 files after it is 7.8 mm, judged by the slices after it; 24 after it is 8.2 mm, not judged
  assert.equal(frostSide(123, [100], reach), 1)
  assert.equal(frostSide(124, [100], reach), null)
  // Before it, 24 files is 7.8 mm, judged by the slices before it, and 25 isn't
  assert.equal(frostSide(76, [100], reach), -1)
  assert.equal(frostSide(75, [100], reach), null)
  // 12 mm from the nearest of two faces, 36 files, is never judged
  assert.equal(frostSide(136, [100, 172], reach), null)
  // Between two faces, the nearer decides: 4 files after one and 8 before the other is judged from the slices after
  assert.equal(frostSide(104, [100, 113], reach), 1)
  assert.equal(frostSide(104, [], reach), null)
  // The male's, a millimetre apart: 8 files a side
  assert.equal(frostSide(1007, [1000], filesSpanning(8, 1)), 1)
  assert.equal(frostSide(1008, [1000], filesSpanning(8, 1)), null)
})

void test('a layer keeping fewer than half its slices is thin: five of twelve, not six', () => {
  assert.equal(thinShare, 0.5)
  assert.equal(isThinLayer(5, 12), true)
  assert.equal(isThinLayer(6, 12), false)
  // A layer cut short by the end of the slices read counts the slices it has
  assert.equal(isThinLayer(5, 6), false)
  assert.equal(isThinLayer(1, 4), true)
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

const sixOf = (value: number) => [value, value, value, value, value, value]

void test('the gap filling fills the upper half of a gap from above and the lower half from below', () => {
  const missing = [false, true, true, true, true, false]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers([cells, colors], 2, missing), [0, 0, 0, 5, 5, 5])
  assert.deepEqual([...cells], Array.from({ length: 12 }, () => 1))
  assert.deepEqual([...colors], [1, 1, 1, 6, 6, 6].flatMap(sixOf))
})

void test('the gap filling blends the colour across a gap, from the colour above to the colour below', () => {
  // The same gap: its cells still come from the nearer layer, its colour a fifth of the way further at each layer,
  // from 1 to 6
  const missing = [false, true, true, true, true, false]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers([cells, colors], 2, missing, { colors, body: cells }), [0, 0, 0, 5, 5, 5])
  assert.deepEqual([...cells], Array.from({ length: 12 }, () => 1))
  assert.deepEqual([...colors], [1, 2, 3, 4, 5, 6].flatMap(sixOf))
})

void test('the gap filling fills the middle of an odd gap from above', () => {
  const missing = [false, true, true, true, false]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers([cells, colors], 2, missing), [0, 0, 0, 4, 4])
  assert.deepEqual([...colors.subarray(12, 18)], [1, 1, 1, 1, 1, 1])
})

void test('a three-layer gap takes a quarter, a half and three quarters of the way, channel by channel', () => {
  // Two cells a layer, each with its own colour per channel, above and below a gap of three layers. Cell 0 is body on
  // both sides and blends; cell 1 is body above only, so it keeps the colour above, whose layer it's body in
  const missing = [false, true, true, true, false]
  const cells = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0, 1, 0])
  const colors = new Uint8Array(30)
  colors.set([0, 100, 200, 40, 50, 60], 0)
  colors.set([200, 100, 0, 90, 90, 90], 24)
  const shares = Uint8Array.from([250, 240, 0, 0, 0, 0, 0, 0, 230, 20])
  const sources = fillMissingLayers([cells, shares, colors], 2, missing, { colors, body: cells })
  assert.deepEqual(sources, [0, 0, 0, 4, 4])
  // The cells and every other plane from the nearer layer: above for the first two, the middle included, below for
  // the third
  assert.deepEqual([...cells], [1, 1, 1, 1, 1, 1, 1, 0, 1, 0])
  assert.deepEqual([...shares], [250, 240, 250, 240, 250, 240, 230, 20, 230, 20])
  assert.deepEqual(
    [...colors.subarray(6, 24)],
    [
      // A quarter of the way: cell 0 blends, cell 1 keeps its colour above
      [50, 100, 150, 40, 50, 60],
      [100, 100, 100, 40, 50, 60],
      [150, 100, 50, 40, 50, 60],
    ].flat(),
  )
})

void test('the gap filling fills a gap at either end from the one side it has', () => {
  const missing = [true, false, false, true, true]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers([cells, colors], 2, missing, { colors, body: cells }), [1, 1, 2, 2, 2])
  assert.deepEqual([...colors.subarray(0, 6)], [2, 2, 2, 2, 2, 2])
  assert.deepEqual([...colors.subarray(18, 30)], [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3])
})

void test('the gap filling blends only a plane it fills, by a body of a byte a cell', () => {
  const missing = [false, true, false]
  const { cells, colors } = layered(missing)
  assert.throws(() => fillMissingLayers([cells], 2, missing, { colors, body: cells }), /not a plane filled/)
  assert.throws(() => fillMissingLayers([cells, colors], 2, missing, { colors, body: colors }), /more than a byte/)
})

void test('the gap filling joins the body across a gap into one piece', () => {
  // One cell per layer, a column of four, with the middle two layers missing
  const missing = [false, true, true, false]
  const cells = Uint8Array.from([1, 0, 0, 1])
  const colors = new Uint8Array(12)
  assert.equal(largestPiece(cells, 1, 1, 4).size, 1)
  fillMissingLayers([cells, colors], 1, missing)
  assert.equal(largestPiece(cells, 1, 1, 4).size, 4)
})

void test('the gap filling leaves a grid with no read layer empty', () => {
  const missing = [true, true]
  const { cells, colors } = layered(missing)
  assert.deepEqual(fillMissingLayers([cells, colors], 2, missing), [-1, -1])
  assert.deepEqual([...cells], [0, 0, 0, 0])
})

// Pixels of the head's slices labelled by hand, nine from each of 51 patches, on a 3 × 3 lattice across the patch:
// the slice, what the patch is, where on the slice, and the nine pixels' red, green and blue in turn. The ice is the
// frost over the crown and the grey ice lower down, at the frame's corners and edges; the haze is frost thin enough
// that the scalp shows through it; the holder is the dark bars at the frame's sides; the tissue is by kind; "inside"
// is whole stretches inside the skin, every tissue as it comes; and the cavities are the sinus and the mouth, which
// are full of frozen fluid the colour of tissue
type PatchKind = 'ice' | 'haze' | 'holder' | 'tissue' | 'inside' | 'cavity'
const headPatches: readonly (readonly [number, PatchKind, string, readonly number[]])[] = [
  [20, 'ice', 'frost, top left', [187, 185, 172, 202, 198, 186, 206, 200, 186, 179, 177, 164, 197, 195, 180, 198, 192, 178, 175, 173, 161, 189, 185, 173, 200, 193, 177]],
  [20, 'ice', 'frost, top middle', [221, 212, 197, 212, 203, 188, 206, 196, 184, 210, 201, 186, 209, 197, 181, 208, 196, 184, 214, 202, 186, 215, 202, 186, 209, 196, 180]],
  [20, 'ice', 'frost, bottom right', [177, 168, 159, 179, 172, 164, 180, 176, 167, 174, 167, 159, 173, 166, 160, 167, 161, 153, 164, 159, 153, 161, 154, 148, 155, 148, 145]],
  [60, 'ice', 'frost, top left', [186, 184, 171, 198, 194, 182, 204, 198, 182, 183, 181, 168, 188, 186, 173, 198, 192, 176, 171, 169, 157, 185, 182, 167, 199, 191, 178]],
  [60, 'ice', 'frost, bottom right', [176, 169, 161, 180, 173, 165, 148, 139, 134, 169, 162, 154, 165, 160, 152, 135, 130, 126, 163, 158, 152, 147, 141, 135, 133, 128, 122]],
  [300, 'ice', 'ice above the head', [195, 192, 183, 186, 183, 171, 195, 188, 178, 201, 199, 187, 190, 186, 177, 202, 196, 184, 207, 205, 194, 192, 188, 179, 193, 186, 176]],
  [300, 'ice', 'ice above the head, right', [179, 172, 164, 178, 171, 163, 173, 164, 155, 184, 177, 169, 184, 177, 169, 174, 165, 158, 186, 177, 170, 182, 175, 165, 173, 166, 158]],
  [300, 'ice', 'ice below the head', [145, 148, 141, 151, 152, 144, 157, 157, 149, 139, 140, 134, 143, 142, 138, 156, 156, 148, 140, 141, 136, 147, 148, 142, 156, 157, 151]],
  [300, 'ice', 'ice below the head, right', [147, 143, 140, 149, 148, 143, 134, 130, 127, 148, 145, 140, 148, 145, 140, 127, 124, 119, 151, 148, 143, 130, 126, 123, 123, 119, 118]],
  [600, 'ice', 'top right corner', [141, 131, 128, 149, 139, 137, 142, 132, 130, 156, 145, 141, 153, 142, 138, 142, 132, 130, 143, 132, 129, 143, 132, 128, 144, 133, 129]],
  [600, 'ice', 'bottom left corner', [127, 124, 117, 129, 128, 123, 140, 140, 132, 119, 118, 116, 121, 120, 115, 130, 127, 122, 114, 113, 109, 118, 117, 112, 129, 129, 121]],
  [600, 'ice', 'bottom right corner', [110, 105, 102, 108, 102, 102, 105, 97, 95, 111, 106, 103, 105, 99, 99, 103, 97, 94, 111, 103, 101, 101, 96, 93, 101, 96, 93]],
  [740, 'ice', 'top left, frost streaks', [160, 157, 148, 164, 164, 154, 187, 187, 179, 157, 153, 143, 160, 157, 150, 181, 178, 169, 152, 149, 140, 159, 156, 147, 164, 161, 152]],
  [740, 'ice', 'top right', [158, 147, 141, 146, 137, 132, 143, 134, 129, 161, 150, 144, 161, 150, 144, 153, 142, 138, 174, 165, 160, 165, 154, 150, 158, 147, 141]],
  [900, 'ice', 'top left', [150, 147, 140, 161, 161, 151, 170, 170, 160, 164, 161, 152, 168, 167, 157, 162, 162, 152, 162, 160, 148, 167, 164, 157, 165, 161, 150]],
  [900, 'ice', 'top right', [179, 168, 162, 163, 154, 147, 155, 144, 138, 179, 168, 162, 161, 152, 147, 154, 141, 135, 174, 159, 152, 166, 153, 147, 160, 147, 139]],
  [1200, 'ice', 'top left', [154, 151, 144, 151, 148, 141, 135, 132, 125, 154, 151, 142, 152, 151, 144, 140, 137, 130, 162, 159, 150, 156, 153, 146, 133, 129, 120]],
  [1200, 'ice', 'top right', [147, 137, 128, 156, 146, 137, 160, 150, 141, 151, 141, 135, 160, 150, 141, 164, 151, 143, 146, 136, 127, 162, 152, 143, 159, 146, 138]],
  [1200, 'ice', 'bottom left', [134, 131, 122, 134, 131, 122, 132, 129, 120, 133, 133, 123, 132, 129, 120, 127, 127, 119, 134, 134, 122, 129, 129, 119, 129, 129, 119]],
  [1420, 'ice', 'ice below the chin', [151, 149, 137, 147, 143, 132, 151, 144, 134, 146, 146, 134, 149, 143, 129, 149, 142, 134, 145, 143, 130, 146, 144, 135, 147, 144, 135]],
  [1420, 'ice', 'top left', [161, 161, 151, 161, 160, 151, 158, 156, 144, 163, 163, 155, 159, 159, 151, 151, 148, 139, 161, 161, 152, 158, 158, 148, 149, 146, 137]],
  [20, 'holder', 'left bar', [127, 126, 117, 132, 127, 121, 139, 135, 129, 110, 105, 101, 117, 112, 106, 123, 118, 112, 99, 91, 89, 99, 94, 91, 117, 107, 106]],
  [20, 'holder', 'right bar', [88, 69, 73, 82, 61, 70, 81, 60, 69, 104, 89, 92, 112, 96, 97, 112, 96, 97, 105, 90, 93, 105, 90, 93, 101, 86, 89]],
  [1, 'haze', 'frost over the scalp, slice 1', [201, 194, 181, 208, 200, 187, 219, 207, 193, 198, 192, 178, 204, 196, 183, 204, 194, 179, 198, 192, 180, 201, 193, 182, 204, 195, 181]],
  [20, 'haze', 'frost over the scalp, slice 20', [221, 209, 193, 227, 215, 199, 226, 213, 197, 223, 210, 194, 224, 210, 197, 221, 205, 189, 214, 202, 188, 208, 194, 181, 216, 200, 184]],
  [20, 'tissue', 'scalp at the crown', [213, 188, 166, 208, 183, 161, 208, 183, 161, 198, 171, 152, 200, 174, 157, 198, 173, 151, 196, 170, 153, 192, 165, 148, 197, 171, 156]],
  [60, 'tissue', 'scalp ring', [190, 164, 149, 186, 155, 135, 196, 170, 153, 192, 171, 150, 179, 148, 130, 192, 165, 146, 197, 179, 159, 181, 155, 140, 170, 136, 126]],
  [60, 'tissue', 'skull cut flat at the crown', [194, 167, 148, 193, 165, 144, 190, 161, 143, 190, 165, 143, 193, 165, 143, 188, 161, 141, 185, 160, 144, 188, 161, 142, 188, 163, 141]],
  [600, 'tissue', 'frontal bone', [200, 173, 154, 215, 190, 170, 186, 160, 145, 180, 152, 140, 193, 167, 150, 171, 147, 135, 177, 149, 137, 161, 133, 126, 168, 141, 132]],
  [300, 'tissue', 'white matter, left', [212, 190, 169, 148, 121, 107, 111, 71, 71, 222, 200, 178, 182, 157, 140, 126, 83, 79, 222, 201, 180, 210, 184, 169, 156, 113, 106]],
  [300, 'tissue', 'white matter, right', [216, 189, 170, 217, 188, 169, 220, 193, 174, 211, 177, 161, 216, 187, 168, 216, 189, 170, 220, 193, 174, 213, 184, 166, 212, 185, 166]],
  [600, 'tissue', 'white matter, deep', [193, 168, 148, 164, 143, 122, 119, 81, 80, 178, 147, 127, 197, 178, 163, 120, 87, 78, 185, 160, 142, 193, 171, 154, 191, 173, 153]],
  [600, 'tissue', 'thalamus', [176, 142, 130, 172, 136, 121, 178, 147, 129, 183, 152, 134, 199, 174, 152, 180, 153, 136, 201, 172, 154, 191, 168, 150, 179, 153, 140]],
  [740, 'tissue', 'pons', [172, 150, 137, 156, 129, 120, 169, 145, 132, 162, 135, 124, 167, 143, 131, 155, 128, 119, 159, 132, 123, 163, 136, 127, 147, 120, 111]],
  [740, 'tissue', 'eye, vitreous', [104, 86, 86, 104, 90, 87, 104, 95, 90, 92, 74, 74, 108, 98, 97, 114, 103, 101, 102, 93, 88, 105, 94, 90, 107, 91, 92]],
  [900, 'tissue', 'cerebellum', [162, 135, 124, 168, 150, 140, 147, 119, 107, 113, 77, 77, 142, 113, 109, 158, 124, 122, 141, 105, 105, 173, 139, 134, 126, 97, 91]],
  [1200, 'tissue', 'vertebral body', [142, 110, 113, 138, 109, 112, 146, 116, 114, 140, 110, 108, 149, 125, 125, 148, 123, 118, 151, 126, 121, 139, 114, 117, 141, 113, 112]],
  [1200, 'tissue', 'tooth', [171, 140, 122, 165, 133, 118, 135, 103, 88, 154, 118, 99, 143, 106, 88, 144, 107, 88, 140, 102, 83, 145, 106, 88, 147, 110, 91]],
  [1200, 'tissue', 'tooth, second', [124, 93, 75, 120, 89, 73, 115, 83, 70, 128, 95, 80, 126, 95, 77, 124, 92, 77, 165, 134, 114, 127, 94, 79, 141, 109, 96]],
  [1200, 'tissue', 'tissue under the knife streaks', [95, 86, 79, 109, 95, 94, 58, 47, 45, 102, 95, 85, 115, 98, 96, 60, 49, 47, 95, 88, 78, 125, 119, 111, 89, 74, 67]],
  [1200, 'tissue', 'masseter muscle', [151, 132, 126, 172, 147, 140, 176, 155, 143, 161, 128, 121, 135, 109, 111, 131, 113, 105, 179, 161, 146, 153, 141, 125, 73, 53, 55]],
  [1200, 'tissue', 'tongue', [133, 117, 113, 110, 89, 91, 121, 82, 85, 101, 81, 82, 113, 95, 93, 139, 110, 104, 123, 99, 95, 129, 111, 106, 167, 145, 132]],
  [1420, 'tissue', 'fat under the chin', [203, 173, 152, 211, 175, 151, 200, 168, 147, 205, 173, 150, 212, 185, 164, 207, 172, 152, 211, 173, 152, 202, 160, 146, 185, 126, 125]],
  [1420, 'tissue', 'submandibular gland', [137, 107, 99, 158, 128, 118, 140, 109, 100, 146, 119, 108, 146, 116, 106, 144, 120, 110, 160, 136, 122, 137, 102, 100, 144, 117, 108]],
  [300, 'inside', 'inside the head, slice 300', [204, 181, 165, 133, 99, 91, 90, 47, 54, 185, 157, 145, 102, 68, 67, 191, 141, 134, 108, 65, 75, 89, 61, 66, 102, 54, 65]],
  [600, 'inside', 'inside the head, slice 600', [128, 93, 88, 131, 94, 88, 132, 93, 88, 165, 133, 121, 131, 102, 96, 106, 67, 67, 132, 113, 106, 76, 56, 57, 141, 117, 105]],
  [740, 'inside', 'inside the head, slice 740', [147, 110, 102, 111, 92, 88, 173, 149, 137, 173, 151, 135, 169, 142, 131, 103, 67, 69, 117, 67, 78, 139, 108, 102, 63, 61, 75]],
  [900, 'inside', 'back of the head, slice 900', [146, 125, 112, 156, 134, 121, 156, 133, 119, 157, 109, 109, 74, 56, 54, 163, 123, 123, 173, 151, 139, 122, 86, 88, 160, 134, 125]],
  [1200, 'inside', 'back of the neck, slice 1200', [126, 107, 109, 138, 116, 118, 175, 135, 135, 165, 148, 133, 128, 114, 98, 159, 143, 128, 122, 105, 93, 60, 46, 46, 103, 88, 81]],
  [900, 'cavity', 'maxillary sinus filling', [138, 97, 95, 143, 105, 102, 143, 110, 102, 141, 100, 98, 143, 110, 105, 149, 122, 115, 141, 104, 98, 144, 114, 106, 153, 124, 118]],
  [1200, 'cavity', 'mouth filling', [147, 123, 105, 153, 133, 116, 156, 133, 117, 150, 126, 108, 144, 121, 107, 153, 130, 114, 149, 121, 100, 150, 129, 113, 144, 122, 108]],
]

// How many of a kind's pixels a rule keeps as body, and how many there are
function keptOf(kind: PatchKind, rule: (r: number, g: number, b: number) => boolean) {
  let kept = 0
  let total = 0
  for (const [, patchKind, , pixels] of headPatches) {
    if (patchKind !== kind) continue
    for (let n = 0; n < pixels.length; n += 3) {
      total++
      if (rule(pixels[n], pixels[n + 1], pixels[n + 2])) kept++
    }
  }
  return [kept, total]
}

void test("the head's rule drops the ice and the frost and keeps the tissue, on pixels labelled by hand", () => {
  assert.equal(iceSpreadShare, 0.16)
  assert.deepEqual(keptOf('ice', isTissueOnIce), [0, 189])
  assert.deepEqual(keptOf('haze', isTissueOnIce), [0, 18])
  assert.deepEqual(keptOf('tissue', isTissueOnIce), [162, 171])
  assert.deepEqual(keptOf('inside', isTissueOnIce), [43, 45])
  assert.deepEqual(keptOf('cavity', isTissueOnIce), [18, 18])
  // The holder's right bar is dark and a little red, and some of it passes; it touches the head only where the
  // head leaves the frame
  assert.deepEqual(keptOf('holder', isTissueOnIce), [3, 18])
  // What it drops is tissue with little colour of its own: the eye's vitreous, tissue under the knife's streaks,
  // and one pixel of the tongue's grey surface
  const dropped = headPatches
    .filter(([, kind, , pixels]) => kind === 'tissue' && pixels.some((_, n) => n % 3 === 0 && !isTissueOnIce(pixels[n], pixels[n + 1], pixels[n + 2])))
    .map(([, , name]) => name)
  assert.deepEqual(dropped, ['eye, vitreous', 'tissue under the knife streaks', 'tongue'])
})

void test("a spread in levels, the first rule tried and the way of the male's, fits the head worse on the same pixels", () => {
  // The channels at least 24 levels apart, and not dark
  const byLevels = (r: number, g: number, b: number) => Math.max(r, g, b) >= 40 && Math.max(r, g, b) - Math.min(r, g, b) >= 24
  assert.deepEqual(keptOf('ice', byLevels), [8, 189])
  assert.deepEqual(keptOf('haze', byLevels), [11, 18])
  assert.deepEqual(keptOf('tissue', byLevels), [147, 171])
  assert.deepEqual(keptOf('inside', byLevels), [37, 45])
  // The male's rule, a spread of 20 levels with blue and dark refused, keeps more of the ice still
  assert.deepEqual(keptOf('ice', isBodyPixel), [20, 189])
  assert.deepEqual(keptOf('haze', isBodyPixel), [16, 18])
})

void test("the head's rule reads the spread against the brightness, and has no blue to refuse", () => {
  // Bone at the crown, white matter and scalp: pale, a spread of over a fifth of the brightest channel
  assert.equal(isTissueOnIce(189, 162, 144), true)
  assert.equal(isTissueOnIce(216, 187, 169), true)
  assert.equal(isTissueOnIce(200, 175, 155), true)
  // Bright frost spreads as many levels as dim tissue, 25 here, but a smaller share of its brightness
  assert.equal(isTissueOnIce(213, 201, 188), false)
  assert.equal(isTissueOnIce(130, 108, 105), true)
  // Exactly at the share: 16 of 100
  assert.equal(isTissueOnIce(100, 90, 84), true)
  assert.equal(isTissueOnIce(100, 90, 85), false)
  // A vein's frozen blood is blue, which the male's rule takes for gel
  assert.equal(isTissueOnIce(60, 70, 110), true)
  assert.equal(isBodyPixel(60, 70, 110), false)
  // Dark is the frame's shadow, whatever its tint
  assert.equal(isTissueOnIce(39, 20, 10), false)
})

void test('the enclosed cells are those no path outside the body joins to a face', () => {
  // A 5 × 5 × 5 grid holding a 3 × 3 × 3 shell of body around one cell
  const cells = new Uint8Array(125)
  const at = (i: number, j: number, k: number) => i + 5 * (j + 5 * k)
  for (let k = 1; k <= 3; k++) for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) cells[at(i, j, k)] = 1
  cells[at(2, 2, 2)] = 0
  const enclosed = enclosedCells(cells, 5, 5, 5)
  assert.equal(enclosed.size, 1)
  assert.equal(enclosed.cells[at(2, 2, 2)], 1)
  // The cells outside the shell reach the faces, and body cells are never marked
  assert.equal(enclosed.cells[at(0, 0, 0)], 0)
  assert.equal(enclosed.cells[at(1, 1, 1)], 0)
  // A tunnel from the hole to a face opens it: nothing is enclosed
  cells[at(2, 2, 3)] = 0
  assert.equal(enclosedCells(cells, 5, 5, 5).size, 0)
  // Yet each of the two layers the tunnel passes through encloses its cell within itself
  assert.equal(enclosedCells(cells.subarray(50, 75), 5, 5, 1).size, 1)
  assert.equal(enclosedCells(cells.subarray(75, 100), 5, 5, 1).size, 1)
  assert.equal(enclosedCells(cells.subarray(25, 50), 5, 5, 1).size, 0)
})

void test('a hole that touches a face only at a corner or along an edge is still enclosed', () => {
  // A 3 × 3 × 1 layer: the middle cell empty, its four sides body, its four corners empty
  const cells = Uint8Array.from([0, 1, 0, 1, 0, 1, 0, 1, 0])
  const enclosed = enclosedCells(cells, 3, 3, 1)
  assert.equal(enclosed.size, 1)
  assert.equal(enclosed.cells[4], 1)
  assert.throws(() => enclosedCells(cells, 3, 3, 2))
})
