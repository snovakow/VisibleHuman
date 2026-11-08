import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cellIndex,
  headerBytes,
  isBodyCell,
  maskBytes,
  readVolume,
  sceneCell,
  scenePosition,
  writeVolume,
  type Volume,
} from '../src/volume/format.ts'

// The volume file: its round trip through the writer and the reader, the reader's refusals, and the scene's axes

// A 3 × 2 × 2 grid with four body cells, at indices 0, 4, 7 and 11
const bodyIndices = [0, 4, 7, 11]
const mask = new Uint8Array(maskBytes(12))
for (const index of bodyIndices) mask[index >> 3] |= 1 << (index & 7)
const volume: Volume = {
  size: [3, 2, 2],
  spacing: [3.96, 3.96, 4],
  offset: [10, 20, 30],
  firstSlice: 1001,
  lastSlice: 1008,
  mask,
  colors: Uint8Array.from([200, 100, 50, 10, 20, 30, 255, 255, 0, 1, 2, 3]),
}

void test('a volume round-trips through the writer and the reader', () => {
  const bytes = writeVolume(volume)
  assert.equal(bytes.length, headerBytes + 2 + 12)
  const read = readVolume(bytes)
  assert.deepEqual(read.size, volume.size)
  assert.deepEqual(read.offset, volume.offset)
  // The spacing is stored as 32-bit floats
  assert.deepEqual(read.spacing, volume.spacing.map(Math.fround))
  assert.equal(read.firstSlice, 1001)
  assert.equal(read.lastSlice, 1008)
  assert.deepEqual(read.mask, volume.mask)
  assert.deepEqual(read.colors, volume.colors)
  const body = Array.from({ length: 12 }, (_, index) => index).filter((index) => isBodyCell(read.mask, index))
  assert.deepEqual(body, bodyIndices)
})

void test('the reader reads a file inside a larger buffer, as Node gives it', () => {
  const bytes = writeVolume(volume)
  const padded = new Uint8Array(bytes.length + 5)
  padded.set(bytes, 5)
  assert.deepEqual(readVolume(padded.subarray(5)).colors, volume.colors)
})

void test('a cell index runs along i, then j, then k', () => {
  assert.equal(cellIndex([3, 2, 2], 0, 0, 0), 0)
  assert.equal(cellIndex([3, 2, 2], 1, 0, 0), 1)
  assert.equal(cellIndex([3, 2, 2], 0, 1, 0), 3)
  assert.equal(cellIndex([3, 2, 2], 2, 1, 1), 11)
})

void test('the reader refuses a wrong magic', () => {
  const bytes = writeVolume(volume)
  bytes[3] = '2'.charCodeAt(0)
  assert.throws(() => readVolume(bytes), /Not a volume file: it starts with "VHV2"/)
})

void test('the reader refuses another version', () => {
  const bytes = writeVolume(volume)
  bytes[4] = 2
  assert.throws(() => readVolume(bytes), /version 2 isn't supported/)
})

void test('the reader refuses a short file', () => {
  const bytes = writeVolume(volume)
  assert.throws(() => readVolume(bytes.subarray(0, bytes.length - 1)), /needs 52/)
  assert.throws(() => readVolume(bytes.subarray(0, 10)), /shorter than the 38-byte header/)
})

void test('the reader refuses a body count that disagrees with the mask', () => {
  const bytes = writeVolume(volume)
  // Clear cell 4's bit: the file's length still matches the header's four body cells, but the mask has three
  bytes[headerBytes] &= ~(1 << 4)
  assert.throws(() => readVolume(bytes), /header counts 4 body cells, but the mask has 3/)
})

void test('the writer refuses colours that disagree with the mask', () => {
  assert.throws(() => writeVolume({ ...volume, colors: volume.colors.subarray(3) }), /9 colour bytes for 4 body cells/)
})

void test('the scene has the body left on +x, the head up and the front towards +z', () => {
  // Columns run from the body's right to its left, slices down from the head, and rows from the back to the front
  assert.deepEqual(sceneCell(1, 0, 0), [1, 0, 0])
  assert.deepEqual(sceneCell(0, 0, 1), [0, -1, 0])
  assert.deepEqual(sceneCell(0, 1, 0), [0, 0, 1])
  assert.deepEqual(scenePosition(volume, 1, 1, 1), [3.96, -4, 3.96])
})
