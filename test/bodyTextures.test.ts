import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RedFormat, RGBAFormat, RGFormat, type Data3DTexture } from 'three'
import type { Body } from '../src/render/body/body.ts'
import { createBodySampler } from '../src/render/body/sampler.ts'
import { createBodyTextures, type BodyTexture, type BodyTextures } from '../src/render/body/textures.ts'
import { axesFromBytes, type Volume } from '../src/volume/format.ts'
import { bodyBounds } from '../src/volume/levels.ts'

// The body's textures and the sampler that binds them: what's shared between the styles that read the body, what's
// kept across a change of style or of channel, and what's freed once nothing reads it

// A volume of 2 × 3 × 4 voxels, every one of them body, with a density and, where asked, an MRI
function volumeOf(mri: boolean): Volume {
  const count = 2 * 3 * 4
  const ramp = (from: number) => Uint8Array.from({ length: count }, (_, n) => from + n)
  return {
    size: [2, 3, 4],
    spacing: [4, 2, 3],
    origin: [0, 0, 0],
    firstSlice: 1,
    lastSlice: 4,
    axes: axesFromBytes([0, 1, 2]),
    body: 'test',
    red: ramp(10),
    green: ramp(50),
    blue: ramp(90),
    coverage: new Uint8Array(count).fill(200),
    density: ramp(130),
    ...(mri ? { mri: ramp(170) } : {}),
  }
}

function bodyOf(volume: Volume): Body {
  return { volume, bounds: bodyBounds(volume), levels: [], textures: createBodyTextures(volume) }
}

// Counts a texture's disposals, which is how three frees it from the GPU
function watch(texture: Data3DTexture) {
  const seen = { disposed: 0 }
  texture.addEventListener('dispose', () => seen.disposed++)
  return seen
}

void test('a texture holds the volume\'s bytes, one texel a voxel: its colour with the density or the MRI, its coverage, or the coverage with the density or the MRI', () => {
  const volume = volumeOf(true)
  const textures = createBodyTextures(volume)
  const sizeOf = ({ image }: Data3DTexture) => [image.width, image.height, image.depth]
  // A texture's first eight bytes
  const startOf = ({ image }: Data3DTexture) => Array.from(image.data?.slice(0, 8) ?? [])
  const colour = textures.acquire('colour')
  assert.deepEqual(sizeOf(colour), [2, 3, 4])
  assert.equal(colour.format, RGBAFormat)
  assert.deepEqual(startOf(colour), [10, 50, 90, 130, 11, 51, 91, 131])
  assert.deepEqual(startOf(textures.acquire('mri')), [10, 50, 90, 170, 11, 51, 91, 171])
  const coverage = textures.acquire('coverage')
  assert.deepEqual(sizeOf(coverage), [2, 3, 4])
  assert.equal(coverage.format, RedFormat)
  assert.equal(coverage.image.data, volume.coverage)
  // Two bytes a texel: the coverage, then what the colour texture holds fourth
  const fields = textures.acquire('fields')
  assert.deepEqual(sizeOf(fields), [2, 3, 4])
  assert.equal(fields.format, RGFormat)
  assert.deepEqual(startOf(fields), [200, 130, 200, 131, 200, 132, 200, 133])
  assert.deepEqual(startOf(textures.acquire('mriFields')), [200, 170, 200, 171, 200, 172, 200, 173])
  // A volume without an MRI has no such texture to give
  assert.throws(() => createBodyTextures(volumeOf(false)).acquire('mri'), /no MRI/)
  assert.throws(() => createBodyTextures(volumeOf(false)).acquire('mriFields'), /no MRI/)
})

void test('a texture is built once for every asker, and freed when the last lets go', () => {
  const textures = createBodyTextures(volumeOf(false))
  const first = textures.acquire('colour')
  const seen = watch(first)
  assert.equal(textures.acquire('colour'), first)
  textures.release('colour')
  assert.equal(seen.disposed, 0)
  textures.release('colour')
  assert.equal(seen.disposed, 1)
  // A release too many is nothing, and the next ask builds it again
  textures.release('colour')
  const again = textures.acquire('colour')
  assert.notEqual(again, first)
  // Whatever is still held goes with the body
  const held = watch(again)
  textures.dispose()
  assert.equal(held.disposed, 1)
})

// A body's textures with every ask and every release noted, by kind, in the order they came
function noted(textures: BodyTextures) {
  const built: BodyTexture[] = []
  const freed: BodyTexture[] = []
  const noting: BodyTextures = {
    acquire: (kind) => {
      built.push(kind)
      return textures.acquire(kind)
    },
    release: (kind) => {
      freed.push(kind)
      textures.release(kind)
    },
    dispose: () => textures.dispose(),
  }
  return { noting, built, freed }
}

void test('a sampler holds only what it reads, and lets go of it when it binds another body or none', () => {
  const volume = volumeOf(true)
  const textures = createBodyTextures(volume)
  const { noting, built, freed } = noted(textures)
  const body: Body = { volume, bounds: bodyBounds(volume), levels: [], textures: noting }

  // One that doesn't read the coverage never asks for it
  const plain = createBodySampler({ coverage: false })
  plain.bind(body)
  assert.deepEqual(built, ['colour'])
  plain.bind(null)
  assert.deepEqual(freed, ['colour'])

  const sampler = createBodySampler({ coverage: true })
  built.length = freed.length = 0
  sampler.bind(body, 'density')
  assert.deepEqual(built, ['colour', 'coverage'])
  assert.equal(sampler.leastVoxel.value, 2)
  // The voxel's size along the scene's axes, which these axes lay along the grid's
  assert.deepEqual(sampler.voxel.value.toArray(), [4, 2, 3])

  // To the MRI: the coverage both bindings read is taken again before it's let go, so it's never rebuilt
  const coverage = watch(textures.acquire('coverage'))
  textures.release('coverage')
  sampler.bind(body, 'mri')
  assert.deepEqual(built, ['colour', 'coverage', 'mri', 'coverage'])
  assert.deepEqual(freed, ['colour', 'coverage'])
  assert.equal(coverage.disposed, 0)

  // To another body: the first one's textures are all let go, and freed, since nothing else reads them
  const other = bodyOf(volumeOf(false))
  sampler.bind(other)
  assert.deepEqual(freed, ['colour', 'coverage', 'mri', 'coverage'])
  assert.equal(coverage.disposed, 1)
  const others = watch(other.textures.acquire('colour'))
  other.textures.release('colour')
  sampler.dispose()
  assert.equal(others.disposed, 1)
})

void test('a sampler that reads the fields holds them and the colour but not the coverage, and their MRI twins on the MRI', () => {
  // As the trace's does, which reads the coverage only within the fields
  const volume = volumeOf(true)
  const { noting, built, freed } = noted(createBodyTextures(volume))
  const body: Body = { volume, bounds: bodyBounds(volume), levels: [], textures: noting }
  const sampler = createBodySampler({ coverage: false, fields: true })
  sampler.bind(body, 'density')
  assert.deepEqual(built, ['colour', 'fields'])
  sampler.bind(body, 'mri')
  assert.deepEqual(built, ['colour', 'fields', 'mri', 'mriFields'])
  assert.deepEqual(freed, ['colour', 'fields'])
  sampler.dispose()
  assert.deepEqual(freed, ['colour', 'fields', 'mri', 'mriFields'])
})

void test('a second sampler taking a body over from the first keeps the textures both read', () => {
  // As a change of style does: the new style binds before the old one is disposed of
  const body = bodyOf(volumeOf(false))
  const leaving = createBodySampler({ coverage: true })
  leaving.bind(body)
  const colour = watch(body.textures.acquire('colour'))
  body.textures.release('colour')
  const coverage = watch(body.textures.acquire('coverage'))
  body.textures.release('coverage')

  const arriving = createBodySampler({ coverage: false })
  arriving.bind(body)
  leaving.dispose()
  // The colour is handed on; the coverage, which the new one doesn't read, goes
  assert.deepEqual([colour.disposed, coverage.disposed], [0, 1])
  arriving.dispose()
  assert.equal(colour.disposed, 1)
})
