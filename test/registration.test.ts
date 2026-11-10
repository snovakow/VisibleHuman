import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readRegistration, segmentOf } from '../scripts/lib/registration.ts'

// The registration file's reader, on a file built here: two segments, the second placed by hand

const segment = (first: number, last: number) => ({
  slices: [first, last],
  ctPixelMm: 0.859375,
  dfovMm: 440,
  ctSize: [512, 512],
  flip: 'vertical',
  scale: 2.6042,
  rotationDeg: 0,
  tx: 1075,
  ty: 513.5,
  score: 0.175,
  bodyScore: 0.904,
  samples: [first, last],
})
const file = (segments: readonly unknown[]) => ({ body: 'female', source: 'normalCT', fitted: '2026-11-10', cryoPixelMm: 0.33, segments })

void test('a segment marked as placed by hand keeps the mark, and one without it has none', () => {
  const registration = readRegistration(file([segment(1210, 1227), { ...segment(1228, 1249), placed: 'by hand' }]))
  assert.equal(registration.segments.length, 2)
  assert.equal(registration.segments[0].placed, undefined)
  assert.equal(registration.segments[1].placed, 'by hand')
  assert.equal(segmentOf(registration, 1240)?.placed, 'by hand')
  assert.equal(segmentOf(registration, 1250), null)
  assert.deepEqual(registration.segments[1].slices, [1228, 1249])
  assert.equal(registration.segments[1].bodyScore, 0.904)
})

void test('a mark the reader doesn\'t know, or segments out of order, are refused', () => {
  assert.throws(() => readRegistration(file([{ ...segment(1228, 1249), placed: true }])), /placed is true/)
  assert.throws(() => readRegistration(file([{ ...segment(1228, 1249), placed: 'by eye' }])), /only "by hand" is known/)
  assert.throws(() => readRegistration(file([segment(1228, 1249), segment(1240, 1260)])), /overlap or are out of order/)
})
