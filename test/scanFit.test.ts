import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleSeries, type DicomSlice } from '../scripts/lib/dicom.ts'
import {
  indexMap,
  mutualInformation,
  sampleIndex,
  sampleScan,
  scanCentre,
  scanPoint,
  searchRigid,
  startMap,
  type Start,
} from '../scripts/lib/scanFit.ts'
import { handed, readScanRegistration, catToCryoMap, mriToCatMap } from '../scripts/lib/scanRegistration.ts'
import { apply, identityMatrix, invert, rigidMap, rotationMatrix, type RigidMap, type Vec3 } from '../src/volume/rigid.ts'

// The fit of a whole scan to another grid (scripts/lib/scanFit.ts) and the file it's saved in
// (scripts/lib/scanRegistration.ts): sampling a scan between its voxels, the stepwise search, the mutual
// information, and the registration's maps

// A scan of 2 × 2 × 2 voxels, 2 mm apart across and 3 mm between slices, whose value at (i, j, k) is i + 10j + 100k
function smallScan() {
  const slice = (name: string, z: number, k: number): DicomSlice => {
    const stored = [0, 1, 10, 11].map((value) => value + 100 * k)
    const pixels = new Uint8Array(8)
    stored.forEach((value, n) => new DataView(pixels.buffer).setUint16(n * 2, value, true))
    return {
      name,
      modality: 'MR',
      description: '',
      columns: 2,
      rows: 2,
      pixel: [2, 2],
      position: [5, 6, z],
      across: [1, 0, 0],
      down: [0, 1, 0],
      patientPosition: 'HFS',
      frameUID: '1.2',
      slope: 1,
      intercept: 0,
      signed: false,
      pixels,
    }
  }
  return assembleSeries([slice('a', 7, 0), slice('b', 10, 1)], 'small')
}

const close = (actual: Vec3, expected: Vec3, tolerance = 1e-9) => {
  actual.forEach((value, n) => assert.ok(Math.abs(value - expected[n]) <= tolerance, `${actual.join(', ')} isn't ${expected.join(', ')}`))
}

void test('a scan is read between its voxels, and not off its grid', () => {
  const scan = smallScan()
  assert.ok(scan.voxels instanceof Uint16Array)
  assert.deepEqual(scanPoint(scan, 1, 1, 1), [7, 8, 10])
  assert.deepEqual(scanCentre(scan), [6, 7, 8.5])
  assert.equal(sampleIndex(scan, 0, 0, 0), 0)
  assert.equal(sampleIndex(scan, 1, 1, 1), 111)
  assert.equal(sampleIndex(scan, 0.5, 0.5, 0.5), 55.5)
  assert.equal(sampleIndex(scan, 0.25, 0, 1), 100.25)
  assert.ok(Number.isNaN(sampleIndex(scan, -0.01, 0, 0)))
  assert.ok(Number.isNaN(sampleIndex(scan, 0, 1.01, 0)))
  // A floor puts a value off the scan where any of the eight voxels it's read between lies below it, as the CT's
  // padding outside its reconstruction circle does, and leaves it where none does
  assert.ok(Number.isNaN(sampleIndex(scan, 0, 0, 0, 1)))
  assert.ok(Number.isNaN(sampleIndex(scan, 0.5, 0.5, 0.5, 1)))
  assert.ok(Number.isNaN(sampleIndex(scan, 1, 1, 1, 1)))
  assert.equal(sampleIndex(scan, 0.5, 0.5, 0.5, 0), 55.5)
  // By a point of the patient frame: the centre is every voxel's mean, and a point off the grid reads as told
  assert.equal(sampleScan(scan, [6, 7, 8.5], -1), 55.5)
  assert.equal(sampleScan(scan, [4.9, 7, 8.5], -1), -1)
})

void test('a map into a scan becomes a map into its voxel indices', () => {
  const scan = smallScan()
  const same: RigidMap = { matrix: identityMatrix, offset: [0, 0, 0] }
  const { rows, offset } = indexMap(scan, same)
  const index = (point: Vec3): Vec3 => [
    rows[0][0] * point[0] + rows[0][1] * point[1] + rows[0][2] * point[2] + offset[0],
    rows[1][0] * point[0] + rows[1][1] * point[1] + rows[1][2] * point[2] + offset[1],
    rows[2][0] * point[0] + rows[2][1] * point[1] + rows[2][2] * point[2] + offset[2],
  ]
  close(index([5, 6, 7]), [0, 0, 0])
  close(index([7, 8, 10]), [1, 1, 1])
  close(index([6, 6, 8.5]), [0.5, 0, 0.5])
  // Through a map that moves a frame onto the scan's: the frame's origin lands on the scan's first voxel
  const moved = indexMap(scan, rigidMap({ rotationDeg: [0, 0, 90], translationMm: [5, 6, 7] }, [0, 0, 0], [0, 0, 0]))
  // The frame's x runs along the scan's y after the quarter turn, so 2 mm along it is one voxel down the rows
  assert.ok(Math.abs(moved.rows[1][0] - 0.5) < 1e-12 && Math.abs(moved.rows[0][1] + 0.5) < 1e-12)
  close(moved.offset, [0, 0, 0])
})

void test('the search climbs from a start to the turn and the shift that score best, within its reach', () => {
  // The score is how near a map puts four points to where a known map puts them
  const from: Vec3 = [10, 20, 30]
  const to: Vec3 = [-5, 40, 12]
  const start: Start = { rotation: rotationMatrix([0, 180, 0]), from, to }
  const known = startMap(start, [7.5, -2.5, 5, 4, -6, 2])
  const points: Vec3[] = [[0, 0, 0], [60, 0, 0], [0, 60, 0], [0, 0, 60]]
  const score = (map: RigidMap) =>
    -points.reduce((sum, point) => {
      const a = apply(map, point)
      const b = apply(known, point)
      return sum + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    }, 0)
  const stages = [{ degrees: 5, millimetres: 4 }, { degrees: 2.5, millimetres: 2 }, { degrees: 1, millimetres: 1 }, { degrees: 0.5, millimetres: 0.5 }]
  const found = searchRigid(score, start, stages, { degrees: 15, millimetres: 20 })
  assert.ok(found.score > -0.5, `ended ${-found.score} mm off over four points`)
  assert.equal(found.atEdge, false)
  for (const point of points) close(apply(found.map, point), apply(known, point), 0.3)
  // No stages leave the start as it stands, scored once
  const still = searchRigid(score, start, [], { degrees: 15, millimetres: 20 })
  assert.deepEqual([still.moved, still.evaluations], [[0, 0, 0, 0, 0, 0], 1])
  // A reach too short for the answer ends at its edge
  const short = searchRigid(score, start, stages, { degrees: 5, millimetres: 20 })
  assert.equal(short.atEdge, true)
  assert.ok(short.moved.slice(0, 3).every((angle) => Math.abs(angle) <= 5))
})

void test('the mutual information is the shared reading: all of it where two readings agree, none where they are independent', () => {
  // Four bins, a hundred points: the second reading the same as the first
  const agree = new Float64Array(16)
  for (const bin of [0, 1, 2, 3]) agree[bin * 4 + bin] = 25
  assert.ok(Math.abs(mutualInformation(agree, 4) - Math.log(4)) < 1e-12)
  // Every pair of bins equally full: knowing one says nothing of the other
  assert.ok(Math.abs(mutualInformation(new Float64Array(16).fill(5), 4)) < 1e-12)
  // A reading that only tells the first two bins from the last two shares one bit of two
  const coarse = new Float64Array(16)
  for (const bin of [0, 1, 2, 3]) coarse[bin * 4 + (bin < 2 ? 0 : 1)] = 25
  assert.ok(Math.abs(mutualInformation(coarse, 4) - Math.log(2)) < 1e-12)
  assert.equal(mutualInformation(new Float64Array(16), 4), 0)
})

const registration = {
  body: 'head',
  fitted: '2026-11-10',
  hand: 'same',
  cat: { set: 'head-cat-dicom', size: [512, 512, 466], spacing: [0.4891, 0.4891, 0.5], frameUID: '1.2', centreMm: [0, 70, -114], hounsfieldScale: 2 },
  mri: { set: 'head-mri-dicom/T2_512', size: [512, 512, 229], spacing: [0.4688, 0.4688, 1], frameUID: '1.3', centreMm: [-1, -20, -17], sameFrameAsCat: false },
  catToCryo: { rotationDeg: [0, 180, 0], translationMm: [1, 2, 3], cryoCentreMm: [77, 112, 108] },
  mriToCat: { rotationDeg: [0, 0, 0], translationMm: [0, 0, 0] },
  score: 0.88,
  bodyScore: 0.94,
  mriScore: 0.12,
  hands: { same: 1.82, mirrored: 1.75, margin: 0.1 },
  method: 'principal axes, then a stepwise search',
  manual: false,
}

void test('a scan registration is read with its hand, its scale and its two transforms', () => {
  const read = readScanRegistration(registration)
  assert.equal(read.hand, 'same')
  assert.equal(read.cat.hounsfieldScale, 2)
  assert.equal(read.mri.sameFrameAsCat, false)
  assert.deepEqual(read.catToCryo.cryoCentreMm, [77, 112, 108])
  // The CAT's centre lands on the photographs' centre, moved by the translation, and half a turn about y reverses x and z
  const toCryo = catToCryoMap(read)
  close(apply(toCryo, [0, 70, -114]), [78, 114, 111])
  close(apply(toCryo, [10, 70, -104]), [68, 114, 101])
  close(apply(invert(toCryo), [78, 114, 111]), [0, 70, -114])
  // The MRI's centre lands on the CAT's
  close(apply(mriToCatMap(read), [-1, -20, -17]), [0, 70, -114])
  assert.throws(() => readScanRegistration({ ...registration, hand: 'left' }), /isn't same or mirrored/)
  assert.throws(() => readScanRegistration({ ...registration, cat: { ...registration.cat, hounsfieldScale: 0 } }), /hounsfieldScale/)
  assert.throws(() => readScanRegistration({ ...registration, catToCryo: { rotationDeg: [0, 0], translationMm: [0, 0, 0], cryoCentreMm: [0, 0, 0] } }))
  assert.throws(() => readScanRegistration({ ...registration, mriToCat: undefined }), /no mriToCat/)
})

void test("the mirrored hand takes a point across the grid's centre, column for column, and the same hand leaves it", () => {
  assert.deepEqual(handed('same', [77, 112, 108], [10, 20, 30]), [10, 20, 30])
  assert.deepEqual(handed('mirrored', [77, 112, 108], [10, 20, 30]), [144, 20, 30])
  assert.deepEqual(handed('mirrored', [77, 112, 108], [77, 5, 6]), [77, 5, 6])
})
