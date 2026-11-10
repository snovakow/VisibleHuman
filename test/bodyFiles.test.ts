import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bodyOf, frameOf, framesOf, frameText, lastFrame } from '../scripts/lib/bodies.ts'

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
