import assert from 'node:assert/strict'
import { test } from 'node:test'
import { headerFields, parseCtHeader } from '../src/volume/ctHeader.ts'

// The CT header parser, on the geometry lines of two of the male's headers as the files hold them (the rest of each
// file's hundreds of lines left out), and with NULs such as the files carry

// From cvm1125f.txt, the head at a 270 mm field: the lines that matter, with three NULs added to one of them, as the
// file holds three as the values of other fields
const head = [
  'Reading file: /3d7/frozenCT/c_vm1125.fro',
  '',
  '\t>>>>> Image File Header - Control Data Specification <<<<<',
  'width.................................: 512',
  'height................................: 512',
  'Text.............................: CT Recon HSUC/32/4/120 @ loc -139.000 mm, Sun Aug 29 01:54:20 1993\u0000\u0000\u0000',
  'Exam Number.........................: 32',
  'Patient Entry........................: 1    Head First',
  '\t>>>>> Cat Scan Image Header Specification <<<<<',
  'Image Number.............................: 120',
  'Slice Thickness (mm).....................: 1',
  'Image matrix size - X....................: 512',
  'Image matrix size - Y....................: 512',
  'Display Field of view - X (mm)...........: 270',
  'Display Field of view - Y (if different).: 0',
  'Image dimension - X......................: 270',
  'Image pixel size - X.....................: 0.527344',
  'Image pixel size - Y.....................: 0.527344',
  'RAS letter of Image Location.............: c',
  'Image location...........................: -139',
  'Center R coord of plane image............: 0',
  'Center A coord of plane image............: 30',
  'Center S coord of Plane image............: -139',
  'Table start location.....................: -108',
  'Table End location.......................: -151',
].join('\n')

// From cvm1945f.txt, the hips at a 480 mm field, scanned feet first
const hips = [
  'Reading file: /3d7/frozenCT/c_vm1945.fro',
  'Exam Number.........................: 34',
  'Patient Entry........................: 2    Feet First',
  'Slice Thickness (mm).....................: 1',
  'Image matrix size - X....................: 512',
  'Image matrix size - Y....................: 512',
  'Display Field of view - X (mm)...........: 480',
  'Display Field of view - Y (if different).: 0',
  'Image pixel size - X.....................: 0.9375',
  'Image pixel size - Y.....................: 0.9375',
  'Image location...........................: -265',
  'Center R coord of plane image............: 0',
  'Center A coord of plane image............: 0',
  'Center S coord of Plane image............: -265',
  'Table start location.....................: -262',
  'Table End location.......................: -314',
].join('\r\n')

void test('the head header parses to a 270 mm field of 0.527344 mm pixels, centred 30 mm forward', () => {
  const header = parseCtHeader(head, 'cvm1125f.txt')
  assert.equal(header.dfovMm, 270)
  assert.equal(header.pixelMm, 0.527344)
  assert.deepEqual(header.size, [512, 512])
  assert.deepEqual(header.centerRAS, [0, 30, -139])
  assert.equal(header.tablePosition, -108)
  assert.equal(header.sliceThickness, 1)
  assert.equal(header.exam, '32')
  assert.equal(header.entry, 'Head First')
})

void test('the hips header parses to a 480 mm field of 0.9375 mm pixels at the scanner centre', () => {
  const header = parseCtHeader(hips, 'cvm1945f.txt')
  assert.equal(header.dfovMm, 480)
  assert.equal(header.pixelMm, 0.9375)
  assert.deepEqual(header.size, [512, 512])
  assert.deepEqual(header.centerRAS, [0, 0, -265])
  assert.equal(header.tablePosition, -262)
  assert.equal(header.sliceThickness, 1)
  assert.equal(header.exam, '34')
  assert.equal(header.entry, 'Feet First')
})

void test('labels match whatever their case and spacing, and the control bytes are dropped', () => {
  const fields = headerFields(head)
  assert.equal(fields.get('text'), 'CT Recon HSUC/32/4/120 @ loc -139.000 mm, Sun Aug 29 01:54:20 1993')
  assert.equal(fields.get('patient entry'), '1    Head First')
  const loose = head.replace('Display Field of view - X (mm)', 'DISPLAY  FIELD OF VIEW -  X (MM)').replace('Table start location', 'table   START location')
  const header = parseCtHeader(loose)
  assert.equal(header.dfovMm, 270)
  assert.equal(header.tablePosition, -108)
})

void test('the pixel size falls back to the field over the matrix, and a header without a field is refused by name', () => {
  // 270 / 512 is 0.52734375, which the head's header rounds to 0.527344, so only the fallback gives it
  const noPixel = parseCtHeader(head.replace(/Image pixel size - [XY]\.*: 0\.527344\n/g, ''))
  assert.equal(noPixel.pixelMm, 270 / 512)
  assert.throws(() => parseCtHeader(hips.replace('Display Field of view - X (mm)', 'Field'), 'cvm1945f.txt'), /cvm1945f\.txt has no "display field of view - x \(mm\)"/)
  assert.throws(() => parseCtHeader(head.replace(': 270', ': many'), 'cvm1125f.txt'), /cvm1125f\.txt.*not a number/)
})
