import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useStore } from '../src/store.ts'
import { axesFromBytes, cellCount, cellIndex, writeVolume, type Triple, type Volume } from '../src/volume/format.ts'

// The store's state as the panel drives it from one body and level to another: what's picked against what's drawn,
// and what a body chosen again opens at. The page's fetches are answered from a small list of two bodies, one with an
// MRI and one without, and their files, made here

// The store logs each load, which says nothing a test reads
console.info = () => undefined

// A grid with a cube of body inside it, coloured and dense, and with an MRI where asked
function cubeVolume(body: string, spacing: number, mri: boolean): Volume {
  const n = 24
  const margin = 4
  const size: Triple = [n, n, n]
  const voxels = cellCount(size)
  const blocks = () => new Uint8Array(voxels)
  const [red, green, blue, coverage, density, scan] = [blocks(), blocks(), blocks(), blocks(), blocks(), blocks()]
  for (let k = margin; k < n - margin; k++) {
    for (let j = margin; j < n - margin; j++) {
      for (let i = margin; i < n - margin; i++) {
        const at = cellIndex(size, i, j, k)
        red[at] = 200
        green[at] = 120
        blue[at] = 100
        coverage[at] = 255
        density[at] = 100
        scan[at] = 120
      }
    }
  }
  return {
    size,
    spacing: [spacing, spacing, spacing],
    origin: [0, 0, 0],
    firstSlice: 1,
    lastSlice: n,
    // The male's: x = i, y = −k, z = j
    axes: axesFromBytes([0x00, 0x82, 0x01]),
    body,
    red,
    green,
    blue,
    coverage,
    density,
    ...(mri ? { mri: scan } : {}),
  }
}

// The plain body at 4 mm, its default, and at 2 mm; the scanned body, with an MRI, at 2 mm alone
const files: Record<string, Uint8Array> = {
  'volume/plain-4mm.bin': writeVolume(cubeVolume('plain', 4, false)),
  'volume/plain-2mm.bin': writeVolume(cubeVolume('plain', 2, false)),
  'volume/scanned-2mm.bin': writeVolume(cubeVolume('scanned', 2, true)),
}
const level = (id: string, body: string, mm: number, isDefault: boolean) => ({
  id,
  label: `${mm} mm`,
  file: `volume/${body}-${id}.bin`,
  spacing: [mm, mm, mm],
  ...(isDefault ? { default: true } : { optional: true }),
})
const bodies = {
  bodies: [
    { id: 'plain', label: 'Plain', credit: 'Made for the test', levels: [level('4mm', 'plain', 4, true), level('2mm', 'plain', 2, false)] },
    { id: 'scanned', label: 'Scanned', credit: 'Made for the test', levels: [level('2mm', 'scanned', 2, true)] },
  ],
}
globalThis.fetch = (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === 'volume/bodies.json') return Promise.resolve(Response.json(bodies))
  const bytes = files[url]
  return Promise.resolve(bytes ? new Response(new Uint8Array(bytes)) : new Response('', { status: 404 }))
}

const state = () => useStore.getState()
const load = async (body: string, levelId: string | null) => {
  await state().load(body, levelId)
  assert.equal(state().status, 'ready', `${body} ${levelId ?? '(no level)'}: ${state().error ?? ''}`)
}
// The Detail shown, by its label
const detailLabel = () => state().details?.find((each) => each.block === state().options.detail)?.label
// Picks a Detail, and waits for its level to be built where it's still to build
async function pickDetail(label: string) {
  const block = state().details?.find((each) => each.label === label)?.block
  assert.ok(block !== undefined, `the ${state().body} has a ${label} Detail`)
  state().setOptions({ detail: block })
  for (let n = 0; n < 400 && state().options.detail !== block; n++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(detailLabel(), label)
}

void test('the MRI choices are drawn at their defaults on a body without an MRI, and come back with a body that has one', async () => {
  await load('scanned', null)
  assert.equal(state().capabilities.mri, true)
  state().setOptions({ density: 'mri', trace: 'brain', inner: 'brain' })
  const asPicked = { density: 'mri', trace: 'brain', inner: 'brain' }
  const mriOf = (options: { density: string; trace: string; inner: string }) => ({ density: options.density, trace: options.trace, inner: options.inner })
  assert.deepEqual(mriOf(state().options), asPicked)

  await load('plain', null)
  assert.equal(state().capabilities.mri, false)
  assert.deepEqual(mriOf(state().options), { density: 'ct', trace: 'both', inner: 'bone' })
  assert.deepEqual(mriOf(state().picked), asPicked)

  await load('scanned', null)
  assert.deepEqual(mriOf(state().options), asPicked)
})

void test('a body chosen again opens at the level it was left at, and at the Detail last picked for it', async () => {
  await load('plain', null)
  assert.equal(state().level, '4mm')
  await pickDetail('16 mm')
  // Another level of the body opens at the Detail picked, where it has the spacing
  await load('plain', '2mm')
  assert.equal(detailLabel(), '16 mm')
  // Another body opens at its own, never having had one picked
  await load('scanned', null)
  assert.equal(detailLabel(), '2 mm')
  await load('plain', null)
  assert.deepEqual([state().level, detailLabel()], ['2mm', '16 mm'])
})

void test('a Detail picked that a level hasn\'t got comes back on a level that has it', async () => {
  await load('plain', '4mm')
  await pickDetail('32 mm')
  // At 2 mm the coarsest Detail is 16 mm, so the level opens at its own default
  await load('plain', '2mm')
  assert.equal(detailLabel(), '2 mm')
  await load('plain', '4mm')
  assert.equal(detailLabel(), '32 mm')
})

void test('a backend\'s missing effects are drawn off, their picks kept, and come back with a backend that has them', () => {
  state().setCapabilities({ weighted: false, oit: false }, false)
  state().setOptions({ blend: 'weighted', oit: true })
  assert.deepEqual([state().options.blend, state().options.oit], ['normal', false])
  assert.deepEqual([state().picked.blend, state().picked.oit], ['weighted', true])
  state().setCapabilities({ weighted: true, oit: true }, true)
  assert.deepEqual([state().options.blend, state().options.oit], ['weighted', true])
})

void test('a pick that changes nothing keeps both options objects, so nothing is drawn again for it', () => {
  const { options, picked } = state()
  state().setOptions({ opacity: options.opacity, style: options.style })
  assert.equal(state().options, options)
  assert.equal(state().picked, picked)
})
