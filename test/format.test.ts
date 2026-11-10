import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  axesFromBytes,
  cellCount,
  cellIndex,
  countBody,
  headerBytes,
  isBodyVoxel,
  readVolume,
  rgbaBytes,
  sceneCell,
  scenePosition,
  sceneSpacing,
  writeVolume,
  type Volume,
} from '../src/volume/format.ts'

// The volume file, version 2: its round trip through the writer and the reader, the reader's refusals, and the
// scene's axes read from the header

// The male's axes: x = i, y = −k, z = j
const maleAxes = axesFromBytes([0x00, 0x82, 0x01])

// A 3 × 2 × 2 grid with four body voxels, at indices 0, 4, 7 and 11, and a margin of coverage under 128 elsewhere
const size = [3, 2, 2] as const
const bodyIndices = [0, 4, 7, 11]
const coverage = Uint8Array.from({ length: cellCount(size) }, (_, index) => (bodyIndices.includes(index) ? 200 : 30))
coverage[1] = 127
coverage[4] = 128
const volume: Volume = {
  size,
  spacing: [3.96, 3.96, 4],
  origin: [44.55, 28.05, -2.5],
  firstSlice: 1001,
  lastSlice: 1008,
  axes: maleAxes,
  body: 'male',
  red: Uint8Array.from([200, 10, 255, 1, 0, 128, 7, 255, 0, 3, 9, 77]),
  green: Uint8Array.from([100, 20, 255, 2, 0, 64, 7, 0, 0, 2, 9, 78]),
  blue: Uint8Array.from([50, 30, 0, 3, 0, 32, 7, 128, 0, 1, 9, 79]),
  coverage,
  density: Uint8Array.from([65, 0, 0, 0, 150, 0, 0, 52, 0, 0, 0, 1]),
}

void test('a volume round-trips through the writer and the reader', () => {
  const bytes = writeVolume(volume)
  // Five blocks of twelve voxels after the header
  assert.equal(bytes.length, headerBytes + 5 * 12)
  const read = readVolume(bytes)
  assert.deepEqual(read.size, volume.size)
  // The spacing and the origin are stored as 32-bit floats
  assert.deepEqual(read.spacing, volume.spacing.map(Math.fround))
  assert.deepEqual(read.origin, volume.origin.map(Math.fround))
  assert.equal(read.firstSlice, 1001)
  assert.equal(read.lastSlice, 1008)
  assert.deepEqual(read.axes, maleAxes)
  assert.equal(read.body, 'male')
  assert.deepEqual(read.red, volume.red)
  assert.deepEqual(read.green, volume.green)
  assert.deepEqual(read.blue, volume.blue)
  assert.deepEqual(read.coverage, volume.coverage)
  assert.deepEqual(read.density, volume.density)
  assert.equal(read.mri, undefined)
  const body = Array.from({ length: 12 }, (_, index) => index).filter((index) => isBodyVoxel(read.coverage[index]))
  assert.deepEqual(body, bodyIndices)
  assert.equal(countBody(read.coverage), 4)
})

void test('a volume without a density block round-trips, and its texture marks the body with 1', () => {
  const { density: _density, ...rest } = volume
  const bytes = writeVolume(rest)
  assert.equal(bytes.length, headerBytes + 4 * 12)
  const read = readVolume(bytes)
  assert.equal(read.density, undefined)
  const rgba = rgbaBytes(read)
  assert.deepEqual([...rgba.subarray(0, 8)], [200, 100, 50, 1, 10, 20, 30, 0])
})

void test('the texture bytes interleave the colour with the density', () => {
  const rgba = rgbaBytes(volume)
  assert.equal(rgba.length, 48)
  assert.deepEqual([...rgba.subarray(0, 4)], [200, 100, 50, 65])
  assert.deepEqual([...rgba.subarray(44, 48)], [77, 78, 79, 1])
})

void test('asked for the MRI, the texture bytes carry the MRI block where the density was', () => {
  const mri = Uint8Array.from([0, 0, 90, 255, 1, 0, 0, 40, 0, 0, 0, 7])
  const rgba = rgbaBytes({ ...volume, mri }, 'mri')
  assert.equal(rgba.length, 48)
  // The colour as before, and each voxel's fourth byte its MRI: 0 outside the body and where the MRI doesn't reach
  assert.deepEqual([...rgba.subarray(0, 4)], [200, 100, 50, 0])
  assert.deepEqual([...rgba.filter((_, n) => n % 4 === 3)], [...mri])
  assert.deepEqual([...rgbaBytes({ ...volume, mri })], [...rgbaBytes(volume)])
  // A volume without the block has nothing to give
  assert.throws(() => rgbaBytes(volume, 'mri'), /no MRI block/)
})

void test('the reader reads a file inside a larger buffer, as Node gives it', () => {
  const bytes = writeVolume(volume)
  const padded = new Uint8Array(bytes.length + 5)
  padded.set(bytes, 5)
  assert.deepEqual(readVolume(padded.subarray(5)).red, volume.red)
})

void test('a voxel index runs along i, then j, then k', () => {
  assert.equal(cellIndex([3, 2, 2], 0, 0, 0), 0)
  assert.equal(cellIndex([3, 2, 2], 1, 0, 0), 1)
  assert.equal(cellIndex([3, 2, 2], 0, 1, 0), 3)
  assert.equal(cellIndex([3, 2, 2], 2, 1, 1), 11)
})

void test('the reader refuses the version 1 magic and any other', () => {
  const bytes = writeVolume(volume)
  bytes[3] = '1'.charCodeAt(0)
  assert.throws(() => readVolume(bytes), /version 1, which was retired/)
  bytes[3] = '3'.charCodeAt(0)
  assert.throws(() => readVolume(bytes), /Not a volume file: it starts with "VHV3"/)
})

void test('the reader refuses version 1 and another header length', () => {
  const bytes = writeVolume(volume)
  bytes[4] = 1
  assert.throws(() => readVolume(bytes), /version 1 isn't supported/)
  bytes[4] = 2
  bytes[6] = 60
  assert.throws(() => readVolume(bytes), /60-byte header/)
})

void test('the reader refuses a short file and a byte length that disagrees with the header', () => {
  const bytes = writeVolume(volume)
  assert.throws(() => readVolume(bytes.subarray(0, 10)), /shorter than the 64-byte header/)
  assert.throws(() => readVolume(bytes.subarray(0, bytes.length - 1)), /needs 124/)
  // The header claims a density block that isn't there
  const { density: _density, ...rest } = volume
  const without = writeVolume(rest)
  without[45] |= 2
  assert.throws(() => readVolume(without), /is 112 bytes, but its header .* needs 124/)
})

void test('the reader refuses missing colour or coverage bits, and bits it doesn\'t know', () => {
  const bytes = writeVolume(volume)
  bytes[45] = 6
  assert.throws(() => readVolume(bytes), /lack the colour or the coverage/)
  bytes[45] = 3
  assert.throws(() => readVolume(bytes), /lack the colour or the coverage/)
  bytes[45] = 7 | 16
  assert.throws(() => readVolume(bytes), /doesn't know/)
})

void test('the reader refuses axes that use one source axis twice, or no axis at all', () => {
  const bytes = writeVolume(volume)
  // y becomes −i, which x already uses
  bytes[43] = 0x80
  assert.throws(() => readVolume(bytes), /don't use each of i, j and k once/)
  bytes[43] = 0x03
  assert.throws(() => readVolume(bytes), /isn't an axis byte/)
  assert.throws(() => writeVolume({ ...volume, axes: { ...maleAxes, y: maleAxes.x } }), /don't use each/)
})

void test('the reader refuses a zero spacing and a coding it doesn\'t know', () => {
  const bytes = writeVolume(volume)
  const view = new DataView(bytes.buffer)
  view.setFloat32(14, 0, true)
  assert.throws(() => readVolume(bytes), /isn't positive/)
  view.setFloat32(14, 3.96, true)
  bytes[46] = 2
  assert.throws(() => readVolume(bytes), /coding 2 isn't known/)
})

void test('the writer refuses a block of the wrong length and a body id that won\'t fit', () => {
  assert.throws(() => writeVolume({ ...volume, coverage: volume.coverage.subarray(1) }), /11 bytes, but 3 × 2 × 2 voxels need 12/)
  assert.throws(() => writeVolume({ ...volume, body: 'a body with a very long name' }), /up to 16 ASCII/)
  assert.throws(() => writeVolume({ ...volume, body: 'mâle' }), /up to 16 ASCII/)
})

void test('the scene has the body left on +x, the head up and the front towards +z, from the header\'s axis bytes', () => {
  // Columns run from the body's right to its left, slices down from the head, and rows from the back to the front
  assert.deepEqual(sceneCell(volume, 1, 0, 0), [1, 0, 0])
  assert.deepEqual(sceneCell(volume, 0, 0, 1), [0, -1, 0])
  assert.deepEqual(sceneCell(volume, 0, 1, 0), [0, 0, 1])
  assert.deepEqual(sceneCell(volume, 0, 0, 0), [0, 0, 0])
  assert.deepEqual(sceneSpacing(volume), [3.96, 4, 3.96])
  assert.deepEqual(scenePosition(volume, 1, 1, 1), [3.96, -4, 3.96])
  // Another body's axes are read the same way: here y follows +j and z runs against k
  const other = readVolume(writeVolume({ ...volume, axes: axesFromBytes([0x00, 0x01, 0x82]) }))
  assert.deepEqual(sceneCell(other, 0, 1, 1), [0, 1, -1])
})
