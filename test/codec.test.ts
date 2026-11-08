import assert from 'node:assert/strict'
import { test } from 'node:test'
import { correlate, decorrelate, deltaDecode, deltaEncode } from '../src/volume/codec.ts'

// The volume file's byte codings: the delta coding along rows and the colour decorrelation, each undone by its partner

void test('delta coding stores each row\'s first byte whole and the rest as differences', () => {
  // Two rows of four
  const block = Uint8Array.from([10, 12, 15, 15, 200, 190, 191, 0])
  const coded = deltaEncode(block, 4)
  assert.deepEqual([...coded], [10, 2, 3, 0, 200, 246, 1, 65])
  assert.deepEqual(deltaDecode(coded, 4), block)
})

void test('delta coding round-trips through wraparound past 255 and under 0', () => {
  const block = Uint8Array.from([255, 0, 255, 1, 254, 128, 127, 0, 255])
  const coded = deltaEncode(block, 3)
  // 0 − 255 wraps to 1, and 255 − 0 stays 255
  assert.equal(coded[1], 1)
  assert.equal(coded[2], 255)
  assert.deepEqual(deltaDecode(coded, 3), block)
  // A row length that doesn't divide the block still round-trips: the last row is short
  assert.deepEqual(deltaDecode(deltaEncode(block, 4), 4), block)
})

void test('delta coding refuses a row length under 1', () => {
  assert.throws(() => deltaEncode(new Uint8Array(4), 0), /row length of at least 1/)
  assert.throws(() => deltaDecode(new Uint8Array(4), 1.5), /row length of at least 1/)
})

void test('decorrelation stores a channel\'s difference from green and adds it back', () => {
  const red = Uint8Array.from([100, 0, 255, 128])
  const green = Uint8Array.from([50, 10, 255, 200])
  const delta = decorrelate(red.slice(), green)
  // 0 − 10 wraps to 246, and 128 − 200 to 184
  assert.deepEqual([...delta], [50, 246, 0, 184])
  assert.deepEqual(correlate(delta, green), red)
})

void test('decorrelation refuses channels of different lengths', () => {
  assert.throws(() => decorrelate(new Uint8Array(3), new Uint8Array(4)), /one length/)
  assert.throws(() => correlate(new Uint8Array(4), new Uint8Array(3)), /one length/)
})
