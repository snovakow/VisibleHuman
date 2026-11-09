import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCellTable, paintCellTable } from '../src/viewer/cellTable.ts'
import { cutBox, cutLimits, cutPlanes, type CutPlane } from '../src/viewer/cuts.ts'
import type { Triple } from '../src/volume/format.ts'
import type { Level } from '../src/volume/levels.ts'

// The cuts as a box and as planes, which must cut where the splats' cell table cuts

// The male's bounds at 4 mm, half extents along x, y and z, as the 0.1.7 page framed them
const male: Triple = [285.12, 944, 164.34]

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

// Whether a plane keeps a point
const keeps = (plane: CutPlane, p: Triple) =>
  plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] + plane.constant >= 0

// A level of cells at the given centres, for the cell table to paint
function levelOf(centers: Triple[]): Level {
  return {
    block: 2,
    spacing: 8,
    label: '8 mm',
    count: centers.length,
    centers: new Float32Array(centers.flat()),
    colors: new Uint8Array(centers.length * 3),
    coverage: new Uint8Array(centers.length).fill(255),
  }
}

void test('Axial 0.27 cuts where the cell table cuts: cells above the top go, cells below stay', () => {
  const cuts = { axial: 0.27, coronal: 0, sagittal: 0 }
  const { top } = cutLimits(male, cuts)
  // 27 % of the way down from the head
  close(top, 944 - 0.27 * 2 * 944)
  const box = cutBox(male, cuts)
  close(box.max[1], top)
  // Cells a hair either side of the plane, and well away from it
  const centers: Triple[] = [
    [0, top + 0.01, 0],
    [0, top - 0.01, 0],
    [0, 900, 0],
    [0, -900, 0],
  ]
  const level = levelOf(centers)
  const table = createCellTable(level)
  paintCellTable(table, level, male, { opacity: 1, ...cuts })
  const alphas = centers.map((_, n) => table.bytes[n * 4 + 3])
  assert.deepEqual(alphas, [0, 255, 0, 255])
  // The box keeps exactly the cells the table keeps
  const inBox = centers.map((p) => p[1] <= box.max[1])
  assert.deepEqual(
    inBox,
    alphas.map((alpha) => alpha > 0),
  )
})

void test('the three planes keep the right half-spaces: below the top, behind the front, left of the right', () => {
  const cuts = { axial: 0.25, coronal: 0.5, sagittal: 0.1 }
  const { top, front, right } = cutLimits(male, cuts)
  close(top, 472)
  close(front, 0)
  close(right, -285.12 + 0.1 * 2 * 285.12)
  const [axial, coronal, sagittal] = cutPlanes(male, cuts)
  assert.ok(keeps(axial, [0, top - 1, 0]) && !keeps(axial, [0, top + 1, 0]))
  assert.ok(keeps(coronal, [0, 0, front - 1]) && !keeps(coronal, [0, 0, front + 1]))
  assert.ok(keeps(sagittal, [right + 1, 0, 0]) && !keeps(sagittal, [right - 1, 0, 0]))
  // Each plane agrees with the box's face
  const box = cutBox(male, cuts)
  assert.deepEqual(box.max, [285.12, top, front])
  assert.deepEqual(box.min, [right, -944, -164.34])
  // The table's rule, on the same points
  const centers: Triple[] = [
    [0, top - 1, 0],
    [0, top + 1, 0],
    [0, 0, front - 1],
    [0, 0, front + 1],
    [right + 1, 0, 0],
    [right - 1, 0, 0],
  ]
  const level = levelOf(centers)
  const table = createCellTable(level)
  paintCellTable(table, level, male, { opacity: 1, ...cuts })
  assert.deepEqual(
    centers.map((_, n) => table.bytes[n * 4 + 3] > 0),
    [true, false, true, false, true, false],
  )
})

void test('an inactive cut\'s plane lies beyond the bounds and keeps every point in them, while the box is the bounds', () => {
  const none = { axial: 0, coronal: 0, sagittal: 0 }
  const [axial, coronal, sagittal] = cutPlanes(male, none)
  // Each plane's level, read back from its constant, is past the face it would start on
  assert.ok(-axial.constant / axial.normal[1] > male[1])
  assert.ok(-coronal.constant / coronal.normal[2] > male[2])
  assert.ok(-sagittal.constant / sagittal.normal[0] < -male[0])
  for (const corner of [
    [285.12, 944, 164.34],
    [-285.12, -944, -164.34],
    [-285.12, 944, 164.34],
  ] satisfies Triple[]) {
    assert.ok(keeps(axial, corner) && keeps(coronal, corner) && keeps(sagittal, corner))
  }
  const box = cutBox(male, none)
  assert.deepEqual(box.min, [-285.12, -944, -164.34])
  assert.deepEqual(box.max, [285.12, 944, 164.34])
  // A cut of 1 takes everything: the box collapses to the far face
  const all = cutBox(male, { axial: 1, coronal: 1, sagittal: 1 })
  assert.deepEqual(all.max, [285.12, -944, -164.34])
  assert.deepEqual(all.min, [285.12, -944, -164.34])
})
