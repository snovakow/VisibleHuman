import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bodies, bodyOf, fileName, frameOf, framesOf, frameText, lastFrame, thumbnailName } from '../scripts/lib/bodies.ts'
import { filesSpanning, isTissueOnIce } from '../src/volume/segment.ts'

// The volume script's bodies (scripts/lib/bodies.ts): the order a body's files are read in, the names it reads them
// by, and the files its set lacks or holds empty. The page's reader of bodies.json is tested in bodies.test.ts

const female = bodyOf('female')
const male = bodyOf('male')

void test("the female's files run a, b, c within a number, then the next number", () => {
  const names = framesOf(female, 0, 6).map((frame) => frame.name)
  assert.deepEqual(names, [
    'avf1001a.png',
    'avf1001b.png',
    'avf1001c.png',
    'avf1002a.png',
    'avf1002b.png',
    'avf1002c.png',
    'avf1003a.png',
  ])
  const frames = framesOf(female, 0, lastFrame(female))
  assert.equal(frames.length, 1730 * 3)
  assert.deepEqual(
    frames.slice(0, 4).map((frame) => [frame.index, frame.slice]),
    [
      [0, 1001],
      [1, 1001],
      [2, 1001],
      [3, 1002],
    ],
  )
  assert.equal(frames[frames.length - 1].name, 'avf2730c.png')
})

void test("the female's absent names are flagged, which leaves the set's 5,186 files", () => {
  const frames = framesOf(female, 0, lastFrame(female))
  const absent = frames.filter((frame) => frame.absent).map((frame) => frame.name)
  assert.deepEqual(absent, ['avf2328c.png', 'avf2329a.png', 'avf2329b.png', 'avf2730c.png'])
  assert.equal(frames.length - absent.length, 5186)
  assert.deepEqual(female.emptyFiles, ['avf2100a.png', 'avf2100b.png'])
  // The black frames between the blocks: 1492b to 1497b, 1977c to 1978b, 2329c and 2330a
  assert.equal(female.blankFiles.length, 16 + 3 + 2)
  assert.equal(female.blankFiles[0], 'avf1492b.png')
  assert.equal(female.blankFiles[15], 'avf1497b.png')
  assert.deepEqual(female.blankFiles.slice(16), ['avf1977c.png', 'avf1978a.png', 'avf1978b.png', 'avf2329c.png', 'avf2330a.png'])
  // No file is listed under two of the lists
  const listed = [...female.blankFiles, ...female.emptyFiles, ...female.absentFiles]
  assert.equal(new Set(listed).size, listed.length)
})

void test('a range bound names a slice, or one of its sub-slices', () => {
  assert.equal(frameOf(female, '1001', 'first'), 0)
  assert.equal(frameOf(female, '1001', 'last'), 2)
  assert.equal(frameOf(female, '1500b', 'first'), 499 * 3 + 1)
  assert.equal(frameOf(female, '1500b', 'last'), 499 * 3 + 1)
  assert.equal(frameText(female, frameOf(female, '2730', 'last')), '2730c')
  assert.throws(() => frameOf(female, '1500d', 'first'))
  assert.throws(() => frameOf(female, '2731', 'first'))
  assert.throws(() => frameOf(female, '1000', 'first'))
  // The male has no sub-slices, so a bound is a number alone, its frame either way
  assert.equal(frameOf(male, '1500', 'first'), 499)
  assert.equal(frameOf(male, '1500', 'last'), 499)
  assert.throws(() => frameOf(male, '1500a', 'first'))
})

void test("the male's files are one a number, as before", () => {
  const frames = framesOf(male, 0, lastFrame(male))
  assert.equal(frames.length, 1878)
  assert.deepEqual(
    frames.slice(0, 2).map((frame) => frame.name),
    ['a_vm1001.png', 'a_vm1002.png'],
  )
  assert.equal(frames.some((frame) => frame.absent), false)
  assert.equal(frameText(male, 1877), '2878')
})

const head = bodyOf('head')

void test("the head's files are four-digit numbers from 0001 to 1477, gzipped TIFFs, with a JPEG a quarter the size of each", () => {
  assert.equal(fileName(head, 1), '0001.tiff.gz')
  assert.equal(fileName(head, 740), '0740.tiff.gz')
  const frames = framesOf(head, 0, lastFrame(head))
  assert.equal(frames.length, 1477)
  assert.deepEqual([frames[0].name, frames[0].slice, frames[1476].name, frames[1476].slice], ['0001.tiff.gz', 1, '1477.tiff.gz', 1477])
  assert.equal(frames.some((frame) => frame.absent), false)
  assert.deepEqual([head.set, head.width, head.height, head.pixelSize, head.sliceSpacing], ['head-cryo', 1056, 1528, 0.147, 0.147])
  // A bound is a slice number, with no sub-slice to name
  assert.equal(frameOf(head, '293', 'first'), 292)
  assert.equal(frameOf(head, '293', 'last'), 292)
  assert.equal(frameText(head, 292), '293')
  assert.throws(() => frameOf(head, '293a', 'first'))
  assert.throws(() => frameOf(head, '1478', 'last'))
  assert.equal(thumbnailName(head, 740), '0740.04.jpg')
  assert.deepEqual(head.thumbnails, { set: 'head-cryo-jpeg', extension: '.04.jpg', sheet: [1, 300, 600, 740, 900, 1200, 1477] })
  assert.throws(() => thumbnailName(male, 1500))
})

void test("the head's levels are whole pixels and slices to a voxel, and the page opens on the coarsest", () => {
  assert.deepEqual(
    head.levels.map((level) => [level.spacing, level.pixels, level.slices, level.default === true]),
    [
      [1.2, 8, 8, true],
      [1, 7, 7, false],
      [0.6, 4, 4, false],
    ],
  )
  // Cubes: as many slices as pixels, at a pixel a slice
  for (const level of head.levels) assert.equal(level.pixels * head.pixelSize, level.slices * head.sliceSpacing)
  assert.deepEqual(head.cryoBlocks, [[1, 1477]])
})

void test("the head's axes run against its slices' three, the male's turned half a turn about them", () => {
  // The subject's right at the image's right, the face at its top, the crown at the first slice
  assert.deepEqual(head.axes, { x: { source: 0, sign: -1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: -1 } })
  assert.deepEqual(male.axes, { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } })
})

void test("the head's quirks are its own: its pixel rule, its fill, its tall file, its shadowed edge and its scans", () => {
  assert.equal(head.segmentRule, isTissueOnIce)
  assert.equal(head.fillsEnclosed, true)
  assert.deepEqual(head.tallFiles, ['0293.tiff.gz'])
  assert.deepEqual(head.frameInset, { right: 32 })
  assert.deepEqual(head.scans, { ct: { set: 'head-cat-dicom', hounsfieldScale: 2 }, mri: { set: 'head-mri-dicom/T2_512' } })
  assert.equal(head.ct, undefined)
  assert.deepEqual([head.blankFiles, head.emptyFiles, head.absentFiles], [[], [], []])
  // The male and the female are built as they were: the gel rule, nothing filled, every pixel read, a CT slice a number
  for (const body of [male, female]) {
    assert.deepEqual([body.segmentRule, body.fillsEnclosed, body.tallFiles, body.frameInset, body.scans, body.thumbnails], [undefined, undefined, undefined, undefined, undefined, undefined])
    assert.notEqual(body.ct, undefined)
  }
  assert.deepEqual(bodies.map((body) => body.id), ['male', 'female', 'head'])
})

void test("the male's and the female's blocks have frosted faces, read as missing, and the head's ice doesn't", () => {
  assert.equal(male.frostedFaces, true)
  assert.equal(female.frostedFaces, true)
  // The head's pixel rule tells its frost from tissue, and its file is built as it was before the rule, its short rule
  // looking eight of its slices either way, where the others look 8 mm
  assert.equal(head.frostedFaces, undefined)
  assert.equal(filesSpanning(head.shortWindowMm ?? 8, head.sliceSpacing), 8)
  assert.equal(male.shortWindowMm, undefined)
  assert.equal(female.shortWindowMm, undefined)
})
