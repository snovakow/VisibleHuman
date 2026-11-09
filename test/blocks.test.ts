import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockGains, boundaryRatio, deadBand, maxGain, minGain } from '../src/volume/blocks.ts'

// The gains that even out the colour steps between cryo blocks, from a reference colour either side of each boundary

const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < 1e-9, `${actual.join(', ')} is not ${expected.join(', ')}`))

void test('the gains carry each boundary\'s colour across it, cumulative from the first block', () => {
  // The second block starts a tenth darker in red than the first ended, and a sixth darker in blue; the third starts
  // a twentieth brighter in red and blue than the second ended
  const gains = blockGains([
    { before: [110, 80, 60], after: [100, 80, 50] },
    { before: [105, 84, 60], after: [110.25, 84, 63] },
  ])
  assert.equal(gains.length, 3)
  close(gains[0].gain, [1, 1, 1])
  close(gains[1].gain, [1.1, 1, 1.2])
  // The block's own step times the block before's gain: 1.1 × 105 / 110.25 and 1.2 × 60 / 63
  close(gains[2].gain, [(1.1 * 105) / 110.25, 1, (1.2 * 60) / 63])
  assert.ok(gains.every((gain) => !gain.clamped))
})

void test('a gain past the limits is held there and flagged', () => {
  const gains = blockGains([
    { before: [200, 100, 100], after: [100, 100, 100] },
    { before: [100, 100, 100], after: [100, 100, 200] },
  ])
  close(gains[1].gain, [maxGain, 1, 1])
  assert.ok(gains[1].clamped)
  // The next block builds on the gain held at the limit, and its blue, half the last block's, is held at the floor
  close(gains[2].gain, [maxGain, 1, minGain])
  assert.ok(gains[2].clamped)
})

void test('identical windows give a gain of 1, as does no boundary at all', () => {
  const gains = blockGains([{ before: [120, 90, 70], after: [120, 90, 70] }])
  close(gains[1].gain, [1, 1, 1])
  assert.ok(!gains[1].clamped)
  assert.deepEqual(blockGains([]), [{ gain: [1, 1, 1], clamped: false }])
})

void test('a boundary within the dead band on every channel takes no gain, and one channel outside it takes the whole ratio', () => {
  // Every channel within 2 % of 1: the block keeps the gain of the block before, exactly, unflagged
  const within = blockGains([
    { before: [101.9, 98.1, 100], after: [100, 100, 100] },
    { before: [100, 100, 100], after: [101.5, 98.5, 100] },
  ])
  assert.deepEqual(within[1], { gain: [1, 1, 1], clamped: false })
  assert.deepEqual(within[2], { gain: [1, 1, 1], clamped: false })
  // Red and green within it, blue 5 % out: every channel takes its own ratio, red and green included
  const outside = blockGains([{ before: [101, 99, 105], after: [100, 100, 100] }])
  close(outside[1].gain, [1.01, 0.99, 1.05])
  assert.ok(!outside[1].clamped)
  close(boundaryRatio({ before: [101, 99, 105], after: [100, 100, 100] }), [1.01, 0.99, 1.05])
  assert.equal(deadBand, 0.02)
})
