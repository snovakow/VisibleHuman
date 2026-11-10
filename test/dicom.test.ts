import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleSeries, parseDicomSlice, type DicomSlice } from '../scripts/lib/dicom.ts'

// Reading a scan from DICOM files (scripts/lib/dicom.ts): one file's slice through dicom-parser, from a file built
// here byte by byte, and a series' slices assembled into one grid

// One element of a DICOM file in explicit little-endian form: its tag, its two-letter type, and its value, padded to
// an even length as the standard asks
function element(group: number, item: number, type: string, value: Uint8Array | string | number) {
  let bytes: Uint8Array
  if (typeof value === 'number') bytes = Uint8Array.of(value & 0xff, value >> 8)
  else if (typeof value === 'string') bytes = new TextEncoder().encode(value.length % 2 === 0 ? value : `${value}${type === 'UI' ? '\0' : ' '}`)
  else bytes = value
  const header = new Uint8Array(type === 'OW' ? 12 : 8)
  const view = new DataView(header.buffer)
  view.setUint16(0, group, true)
  view.setUint16(2, item, true)
  header[4] = type.charCodeAt(0)
  header[5] = type.charCodeAt(1)
  if (type === 'OW') view.setUint32(8, bytes.length, true)
  else view.setUint16(6, bytes.length, true)
  return [header, bytes]
}

const joined = (parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  return bytes
}

// A CT slice of three columns and two rows, as a whole file: the preamble, the file's own group, then the slice
function sliceFile(position: string, pixels: readonly number[]) {
  const syntax = element(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1')
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, syntax[0].length + syntax[1].length, true)
  const stored = new Uint8Array(pixels.length * 2)
  pixels.forEach((value, n) => new DataView(stored.buffer).setUint16(n * 2, value, true))
  return joined([
    new Uint8Array(128),
    new TextEncoder().encode('DICM'),
    ...element(0x0002, 0x0000, 'UL', length),
    ...syntax,
    ...element(0x0008, 0x0060, 'CS', 'CT'),
    ...element(0x0018, 0x5100, 'CS', 'HFS'),
    ...element(0x0020, 0x0032, 'DS', position),
    ...element(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0'),
    ...element(0x0020, 0x0052, 'UI', '1.2.3.4'),
    ...element(0x0028, 0x0002, 'US', 1),
    ...element(0x0028, 0x0010, 'US', 2),
    ...element(0x0028, 0x0011, 'US', 3),
    ...element(0x0028, 0x0030, 'DS', '0.5\\0.25'),
    ...element(0x0028, 0x0100, 'US', 16),
    ...element(0x0028, 0x0103, 'US', 0),
    ...element(0x0028, 0x1052, 'DS', '-1200'),
    ...element(0x0028, 0x1053, 'DS', '1'),
    ...element(0x7fe0, 0x0010, 'OW', stored),
  ])
}

void test('a slice is read from a DICOM file with its geometry, its rescale and its pixels', () => {
  const slice = parseDicomSlice('J.001', sliceFile('-10\\-20\\5.5', [1200, 1201, 1202, 700, 2200, 0]))
  assert.equal(slice.modality, 'CT')
  assert.equal(slice.patientPosition, 'HFS')
  assert.deepEqual([slice.columns, slice.rows], [3, 2])
  // The file gives the rows' spacing first; the slice gives the spacing along the columns, then down the rows
  assert.deepEqual(slice.pixel, [0.25, 0.5])
  assert.deepEqual(slice.position, [-10, -20, 5.5])
  assert.deepEqual([slice.across, slice.down], [[1, 0, 0], [0, 1, 0]])
  assert.equal(slice.frameUID, '1.2.3.4')
  assert.deepEqual([slice.slope, slice.intercept, slice.signed], [1, -1200, false])
  assert.equal(slice.pixels.length, 12)
  assert.throws(() => parseDicomSlice('not a file', new Uint8Array(200)))
})

// A slice of two columns and one row at a height, every pixel holding the same stored value
const flat = (name: string, z: number, stored: number): DicomSlice => ({
  name,
  modality: 'CT',
  description: '',
  columns: 2,
  rows: 1,
  pixel: [0.5, 0.5],
  position: [-1, -2, z],
  across: [1, 0, 0],
  down: [0, 1, 0],
  patientPosition: 'HFS',
  frameUID: '1.2.3',
  slope: 1,
  intercept: -1200,
  signed: false,
  pixels: Uint8Array.of(stored & 0xff, stored >> 8, stored & 0xff, stored >> 8),
})

void test('a series is ordered along its normal whatever order its files come in, and rescaled', () => {
  const volume = assembleSeries([flat('c', 1, 1300), flat('a', 0, 1200), flat('b', 0.5, 1250)], 'series')
  assert.deepEqual(volume.size, [2, 1, 3])
  assert.deepEqual(volume.spacing, [0.5, 0.5, 0.5])
  assert.deepEqual(volume.origin, [-1, -2, 0])
  assert.deepEqual(volume.orientation, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
  assert.deepEqual(Array.from(volume.voxels), [0, 0, 50, 50, 100, 100])
  assert.ok(volume.voxels instanceof Int16Array)
  assert.deepEqual(volume.absent, [])
  assert.deepEqual(volume.rescale, { slope: 1, intercept: -1200 })
  assert.equal(volume.frameUID, '1.2.3')
})

void test('a gap of several steps is filled from the slices either side of it, and listed', () => {
  // Half a millimetre apart, but nothing at 1.5 or 2: the fourth slice is three steps on
  const slices = [flat('a', 0, 1200), flat('b', 0.5, 1210), flat('c', 1, 1220), flat('d', 2.5, 1250), flat('e', 3, 1260)]
  const volume = assembleSeries(slices, 'series')
  assert.equal(volume.size[2], 7)
  assert.deepEqual(volume.absent, [3, 4])
  assert.equal(volume.spacing[2], 0.5)
  assert.deepEqual(Array.from(volume.voxels).filter((_, n) => n % 2 === 0), [0, 10, 20, 30, 40, 50, 60])
})

void test("a slice off the lattice, or not the grid's, stops the read", () => {
  assert.throws(() => assembleSeries([flat('a', 0, 1), flat('b', 0.5, 1), flat('c', 1, 1), flat('d', 1.7, 1)], 'series'), /not a multiple/)
  assert.throws(() => assembleSeries([flat('a', 0, 1), { ...flat('b', 0.5, 1), frameUID: '9.9' }], 'series'), /isn't a slice of the grid/)
  assert.throws(() => assembleSeries([flat('a', 0, 1), { ...flat('b', 0.5, 1), position: [3, -2, 0.5] }], 'series'), /shifted across/)
  assert.throws(() => assembleSeries([flat('a', 0, 1), flat('b', 0, 1)], 'series'), /share a position/)
  assert.throws(() => assembleSeries([], 'series'), /no DICOM files/)
})

void test('a series whose normal points down the patient runs its layers that way', () => {
  // Rows running toward the front turn the normal over: the slices then order from the top down
  const down = (name: string, z: number, stored: number): DicomSlice => ({ ...flat(name, z, stored), down: [0, -1, 0] })
  const volume = assembleSeries([down('a', 0, 1200), down('b', 1, 1300)], 'series')
  assert.deepEqual(volume.orientation[2], [0, 0, -1])
  assert.deepEqual(volume.origin, [-1, -2, 1])
  assert.deepEqual(Array.from(volume.voxels), [100, 100, 0, 0])
})
