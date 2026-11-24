import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lookOf } from '../src/look.ts'
import { defaultOptions, optionKeys, type ViewOptions } from '../src/options.ts'
import type { Look } from '../src/render/look.ts'

// The look the options ask for: the seam between the panel's table and what the scene draws by

// Every value a look holds, however deep, by its path
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[path, value]]
  return Object.entries(value).flatMap(([key, each]) => leaves(each, path ? `${path}.${key}` : key))
}

// Each option set to a value no other option holds and unlike its default, kept of its own type
function distinct(): ViewOptions {
  const changed: Record<string, unknown> = {}
  optionKeys.forEach((key, n) => {
    const value = defaultOptions[key]
    changed[key] = typeof value === 'number' ? 1000 + n : typeof value === 'boolean' ? !value : `${key}!`
  })
  return { ...defaultOptions, ...changed }
}

void test('the same options give the same look, and new options a new one', () => {
  const options = { ...defaultOptions }
  const look = lookOf(options)
  assert.equal(lookOf(options), look)
  assert.notEqual(lookOf({ ...options }), look)
})

void test('every option reaches the look, so none is set in the panel and lost before the scene', () => {
  const options = distinct()
  const values = leaves(lookOf(options)).map(([, value]) => value)
  for (const key of optionKeys) assert.ok(values.includes(options[key]), `${key} is in the look`)
  // And the look holds nothing but options: each of its values is one of theirs
  const given: unknown[] = optionKeys.map((key) => options[key])
  for (const [path, value] of leaves(lookOf(options))) assert.ok(given.includes(value), `${path} comes from an option`)
})

void test('an option several styles share goes to each of their parts, and one style\'s own to its part alone', () => {
  const look: Look = lookOf({ ...defaultOptions, opacity: 0.4, quality: 'quarter', boneThreshold: 95, mriThreshold: 60, rim: 0.7, detail: 4 })
  assert.deepEqual([look.splats.opacity, look.volume.opacity, look.raytrace.opacity, look.surface.opacity], [0.4, 0.4, 0.4, 0.4])
  assert.deepEqual([look.volume.quality, look.raytrace.quality], ['quarter', 'quarter'])
  assert.deepEqual([look.raytrace.boneThreshold, look.surface.boneThreshold], [95, 95])
  assert.deepEqual([look.raytrace.mriThreshold, look.surface.mriThreshold], [60, 60])
  assert.deepEqual([look.raytrace.rim, look.surface.rim], [0.7, 0.7])
  assert.deepEqual([look.splats.detail, look.surface.detail], [4, 4])
  // The cuts, the depth cue and the bloom belong to no style
  const scene = lookOf({ ...defaultOptions, axial: 0.1, coronal: 0.2, sagittal: 0.3, depthCue: 0.5, bloom: 1.5, bloomRadius: 0.6, bloomThreshold: 0.2 })
  assert.deepEqual(scene.cuts, { axial: 0.1, coronal: 0.2, sagittal: 0.3 })
  assert.equal(scene.depthCue, 0.5)
  assert.deepEqual(scene.bloom, { strength: 1.5, radius: 0.6, threshold: 0.2 })
})
