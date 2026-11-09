import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultLevel, readBodies, withLevel, type BlockGainEntry, type BodyEntry, type LevelEntry } from '../src/volume/bodies.ts'

// bodies.json: the page's reading of it, and the script's update of one level's entry

const fourMm: LevelEntry = {
  id: '4mm',
  label: '4 mm',
  file: 'volume/male-4mm.bin',
  spacing: [3.96, 3.96, 4],
  default: true,
}
const twoMm: LevelEntry = { id: '2mm', label: '2 mm', file: 'volume/male-2mm.bin', spacing: [1.98, 1.98, 2], optional: true }
const male: BodyEntry = {
  id: 'male',
  label: 'Male',
  credit: 'Visible Human Male, courtesy of the U.S. National Library of Medicine',
  levels: [fourMm, twoMm],
}

void test('the list reads back as written, with a built level measured and an unbuilt one not', () => {
  const built: LevelEntry = { ...fourMm, size: [144, 83, 472], bytes: 5580377, textureBytes: 22565376, density: 'colour' }
  const file = { bodies: [{ ...male, levels: [built, twoMm] }] }
  const read = readBodies(JSON.parse(JSON.stringify(file)))
  assert.deepEqual(read, file)
  assert.equal(defaultLevel(read.bodies[0]).id, '4mm')
  assert.equal(read.bodies[0].levels[1].bytes, undefined)
})

void test('the reader refuses a list the page couldn\'t open a body from', () => {
  assert.throws(() => readBodies({ bodies: [] }), /no bodies/)
  assert.throws(() => readBodies(null), /no bodies/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [twoMm] }] }), /0 default levels/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [fourMm, fourMm] }] }), /2 default levels/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [fourMm, { ...twoMm, id: '4mm' }] }] }), /twice/)
  assert.throws(() => readBodies({ bodies: [male, male] }), /names a body twice/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [{ ...fourMm, spacing: [4, 4] }] }] }), /spacing/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [{ ...fourMm, file: '' }] }] }), /no file/)
  assert.throws(() => readBodies({ bodies: [{ ...male, levels: [{ ...fourMm, density: 'mri' }] }] }), /density/)
})

void test('a built level replaces its entry and keeps the others as last built', () => {
  // A list made from nothing has the body with all its levels, the built one measured
  const built: LevelEntry = { ...fourMm, size: [144, 83, 472], bytes: 5580377, textureBytes: 22565376, density: 'colour' }
  const first = withLevel(null, male, built)
  assert.deepEqual(first, { bodies: [{ ...male, levels: [built, twoMm] }] })
  // Building the 2 mm level later keeps the 4 mm level's measurements, and another body already listed
  const female: BodyEntry = { ...male, id: 'female', label: 'Female', levels: [{ ...fourMm, file: 'volume/female-4mm.bin' }] }
  const fine: LevelEntry = { ...twoMm, size: [286, 164, 942], bytes: 39000000, textureBytes: 176_734_272, density: 'colour' }
  const second = withLevel({ bodies: [female, ...first.bodies] }, male, fine)
  assert.deepEqual(second, { bodies: [female, { ...male, levels: [built, fine] }] })
})

void test('a level built with block gains reads them back, and a malformed gain is refused', () => {
  const blockGains: BlockGainEntry[] = [
    { slices: [1001, 1505], gain: [1, 1, 1] },
    { slices: [1506, 2016], gain: [1.0412, 1.0503, 1.0611] },
  ]
  const built: LevelEntry = { ...fourMm, size: [144, 83, 472], bytes: 5653887, density: 'ct', blockGains }
  const file = { bodies: [{ ...male, levels: [built, twoMm] }] }
  assert.deepEqual(readBodies(JSON.parse(JSON.stringify(file))), file)
  const withGains = (gains: unknown) => ({ bodies: [{ ...male, levels: [{ ...fourMm, blockGains: gains }] }] })
  assert.throws(() => readBodies(withGains({ slices: [1001, 1505] })), /isn't a list/)
  assert.throws(() => readBodies(withGains([{ slices: [1505, 1001], gain: [1, 1, 1] }])), /slices/)
  assert.throws(() => readBodies(withGains([{ slices: [1001, 1505], gain: [1, 0, 1] }])), /gain/)
})
