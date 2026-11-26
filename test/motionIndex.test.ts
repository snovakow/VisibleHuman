import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { indexLibrary, type FolderFile } from '../src/motion/libraryIndex.ts'
import { readLibrary } from '../src/motion/library.ts'

// The library's index as `npm run motion` makes it (src/motion/libraryIndex.ts): each file listed once with its kind
// and a clip's length, what an entry says kept, two motions of one id refused, the same files giving the same bytes,
// and the committed index the one its files make

const pose = { joints: { leftArm: [0, 0, 90] } }
const keyed = { duration: 2, keys: [{ time: 0, joints: {} }, { time: 1, joints: { neck: [10, 0, 0] } }] }
const baked = { label: 'a nod', source: 'made in a test', duration: 0.5, tracks: { neck: { times: [0, 0.5], values: [0, 0, 0, 1, 0, 0, 0, 1] } } }
const folder: FolderFile[] = [
  { name: 'raise.json', json: pose },
  { name: 'sway.json', json: keyed },
  { name: 'nod-baked.json', json: baked },
]

const entriesOf = (text: string): Record<string, unknown>[] => {
  const json: unknown = JSON.parse(text)
  if (typeof json !== 'object' || json === null || !('motions' in json) || !Array.isArray(json.motions)) throw new Error('No motions')
  return json.motions.filter((entry: unknown): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
}

void test('each file is listed once with its kind and length, by its own id and label where it has them', () => {
  const made = indexLibrary(null, folder)
  const entries = entriesOf(made.text)
  assert.deepEqual(entries, [
    { id: 'nod-baked', label: 'a nod', file: 'motion/nod-baked.json', kind: 'baked', duration: 0.5 },
    { id: 'raise', label: 'raise', file: 'motion/raise.json', kind: 'pose' },
    { id: 'sway', label: 'sway', file: 'motion/sway.json', kind: 'keyed', duration: 2 },
  ])
  assert.deepEqual(made.added, ['nod-baked', 'raise', 'sway'])
  assert.equal(readLibrary(JSON.parse(made.text)).length, 3)
})

void test("an entry keeps its place and every key it holds, the layer key among them, and one whose file is gone is dropped", () => {
  const index = {
    motions: [
      { id: 'sway', label: 'swaying', short: 'sway', file: 'motion/sway.json', layer: true, note: 'kept', duration: 99 },
      { id: 'gone', label: 'gone', file: 'motion/gone.json' },
    ],
  }
  const made = indexLibrary(index, folder)
  const entries = entriesOf(made.text)
  assert.deepEqual(entries[0], { id: 'sway', label: 'swaying', short: 'sway', file: 'motion/sway.json', kind: 'keyed', duration: 2, layer: true, note: 'kept' })
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['sway', 'nod-baked', 'raise'],
  )
  assert.deepEqual(made.dropped, ['gone'])
  assert.equal(readLibrary(JSON.parse(made.text))[0]?.layer, true)
})

void test('two motions of one id are refused, as is a file the page could not read', () => {
  assert.throws(() => indexLibrary(null, [...folder, { name: 'other.json', json: { ...pose, id: 'raise' } }]), /Two motions are named raise/)
  assert.throws(() => indexLibrary({ motions: [{ id: 'raise', label: 'r', file: 'motion/sway.json' }] }, folder), /Two motions are named raise/)
  assert.throws(() => indexLibrary(null, [{ name: 'broken.json', json: { joints: { tail: [0, 0, 0] } } }]), /a joint no skeleton has/)
})

void test('the same files give the same bytes, and the committed index is the one its files make', () => {
  const once = indexLibrary(null, folder).text
  assert.equal(indexLibrary(JSON.parse(once), folder).text, once)

  const library = new URL('../public/motion/', import.meta.url)
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, library), 'utf8'))
  const files = readdirSync(library)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => ({ name, json: read(name) }))
  const committed = readFileSync(new URL('index.json', library), 'utf8')
  const made = indexLibrary(JSON.parse(committed), files)
  assert.equal(made.text, committed, 'npm run motion would change the committed index')
  assert.deepEqual([made.added, made.dropped], [[], []])
})
