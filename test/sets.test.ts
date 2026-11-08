import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingRuns } from '../scripts/lib/data.ts'
import type { ListedFile } from '../scripts/lib/listing.ts'
import { ruleNames, selectSets, sets, wantedFiles, type DataSet } from '../scripts/lib/sets.ts'

// The set table against the counts the data root was verified at on 2026-11-08, and the choosing of files from
// listings, on small sets built here

void test('every name rule forms the count its set expects', () => {
  for (const set of sets) {
    if (!set.sources.every((source) => source.names)) continue
    const formed = set.sources.reduce((sum, source) => sum + (source.names ? ruleNames(source.names).length : 0), 0)
    assert.equal(formed, set.expected, set.id)
  }
})

void test('the name rules form the NLM names', () => {
  const female = sets.find((set) => set.id === 'female-colour')?.sources[0].names
  assert.ok(female)
  const names = ruleNames(female)
  assert.deepEqual(names.slice(0, 4), ['avf1001a.png', 'avf1001b.png', 'avf1001c.png', 'avf1002a.png'])
  assert.ok(!names.includes('avf2329a.png'))
  assert.ok(names.includes('avf2329c.png'))
  assert.equal(names.at(-1), 'avf2730b.png')
  const cryo = sets.find((set) => set.id === 'head-cryo')?.sources[0].names
  assert.ok(cryo)
  assert.equal(ruleNames(cryo)[0], '0001.tiff.gz')
})

void test('the set table holds the 21 folders of the data root, 18 of them core', () => {
  assert.equal(sets.length, 21)
  assert.equal(new Set(sets.map((set) => set.id)).size, 21)
  assert.equal(selectSets(undefined).length, 18)
  assert.ok(selectSets(undefined).every((set) => set.kind === 'core'))
  assert.equal(selectSets('all').length, 21)
})

void test('a folder stands for its series, and sets come in the table order', () => {
  assert.deepEqual(
    selectSets('head-mri').map((set) => set.id),
    ['head-mri/PD', 'head-mri/T1', 'head-mri/T2', 'head-mri/T2_512'],
  )
  assert.deepEqual(
    selectSets('head-mri/T2_512, male-colour').map((set) => set.id),
    ['male-colour', 'head-mri/T2_512'],
  )
  assert.throws(() => selectSets('male'), /No set is called male/)
})

void test('a name listed in two folders is taken once, from the first', () => {
  const set: DataSet = {
    id: 'test',
    sources: [{ folders: ['a', 'b'], names: { prefix: 's', first: 1, last: 4, digits: 1, extension: '.png' } }],
    expected: 4,
    kind: 'core',
  }
  const listings = new Map<string, ListedFile[]>([
    [
      'a',
      [
        { name: 's1.png', bytes: 10 },
        { name: 's2.png', bytes: 20 },
      ],
    ],
    [
      'b',
      [
        { name: 's2.png', bytes: 20 },
        { name: 's4.png', bytes: 40 },
        { name: 'readme.txt', bytes: 5 },
      ],
    ],
  ])
  const { names, files, unlisted, unexpected } = wantedFiles(set, listings)
  assert.deepEqual(names, ['s1.png', 's2.png', 's3.png', 's4.png'])
  assert.deepEqual(files, [
    { name: 's1.png', folder: 'a', bytes: 10 },
    { name: 's2.png', folder: 'a', bytes: 20 },
    { name: 's4.png', folder: 'b', bytes: 40 },
  ])
  assert.deepEqual(unlisted, ['s3.png'])
  assert.deepEqual(unexpected, ['readme.txt'])
})

void test('a set without a rule wants every listed file, in number order', () => {
  const set: DataSet = { id: 'test', sources: [{ folders: ['a'] }], expected: 3, kind: 'archive' }
  const listings = new Map<string, ListedFile[]>([
    [
      'a',
      [
        { name: '10.png', bytes: 1 },
        { name: '9.png', bytes: 1 },
        { name: '1713b.png', bytes: 0 },
      ],
    ],
  ])
  assert.deepEqual(wantedFiles(set, listings).names, ['9.png', '10.png', '1713b.png'])
})

void test('the missing names are given as runs in the set order', () => {
  const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
  assert.deepEqual(missingRuns(names, new Set(['a2', 'a3', 'a4', 'a6'])), ['a2–a4', 'a6'])
  assert.deepEqual(missingRuns(names, new Set()), [])
})
