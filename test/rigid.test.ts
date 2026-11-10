import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addPoint,
  apply,
  axisTurns,
  compose,
  determinant,
  emptyMoments,
  identityMatrix,
  invert,
  multiply,
  principalFrame,
  rigidMap,
  rigidOf,
  rotationAngle,
  rotationDegrees,
  rotationMatrix,
  rotationsBetween,
  transform,
  transpose,
  type Mat3,
  type Vec3,
} from '../src/volume/rigid.ts'

// The rigid transform between two scans of the head (src/volume/rigid.ts): its map, the map's inverse and
// composition, and the first guess at the rotation from two shapes' principal axes

const close = (actual: Vec3, expected: Vec3, tolerance = 1e-9) => {
  actual.forEach((value, n) => assert.ok(Math.abs(value - expected[n]) <= tolerance, `${actual.join(', ')} isn't ${expected.join(', ')}`))
}
const closeMatrix = (actual: Mat3, expected: Mat3, tolerance = 1e-9) => actual.forEach((row, n) => close(row, expected[n], tolerance))

void test('a turn about one axis moves the other two counter-clockwise seen from its tip', () => {
  close(transform(rotationMatrix([90, 0, 0]), [0, 1, 0]), [0, 0, 1])
  close(transform(rotationMatrix([0, 90, 0]), [0, 0, 1]), [1, 0, 0])
  close(transform(rotationMatrix([0, 0, 90]), [1, 0, 0]), [0, 1, 0])
  // About x first, then y, then z: x's quarter turn takes y to z, which y's then takes to x, which z's takes to y
  close(transform(rotationMatrix([90, 90, 90]), [0, 1, 0]), [0, 1, 0])
  close(transform(rotationMatrix([90, 90, 0]), [0, 1, 0]), [1, 0, 0])
})

void test('the angles read back from a rotation give the same rotation', () => {
  for (const angles of [[20, -35, 50], [0, 0, 0], [-170, 12, 95], [3, 178, -2], [10, 90, 25], [10, -90, 25]] as const) {
    const matrix = rotationMatrix(angles)
    assert.ok(Math.abs(determinant(matrix) - 1) < 1e-12)
    closeMatrix(rotationMatrix(rotationDegrees(matrix)), matrix, 1e-9)
  }
  close(rotationDegrees(rotationMatrix([20, -35, 50])), [20, -35, 50])
  assert.ok(Math.abs(rotationAngle(rotationMatrix([0, 0, 37])) - 37) < 1e-9)
  assert.equal(rotationAngle(identityMatrix), 0)
})

void test('a rigid transform turns about the source centre and lands it on the target centre, moved by the translation', () => {
  const from: Vec3 = [125, 125, 115]
  const to: Vec3 = [77, 112, 108]
  const rigid = { rotationDeg: [4, 178, -3], translationMm: [1.5, -2, 0.5] } as const
  const map = rigidMap(rigid, from, to)
  close(apply(map, from), [78.5, 110, 108.5])
  // A point 10 mm from the centre stays 10 mm from where the centre lands
  const moved = apply(map, [135, 125, 115])
  const landed = apply(map, from)
  assert.ok(Math.abs(Math.hypot(moved[0] - landed[0], moved[1] - landed[1], moved[2] - landed[2]) - 10) < 1e-9)
  const back = rigidOf(map, from, to)
  closeMatrix(rotationMatrix(back.rotationDeg), rotationMatrix(rigid.rotationDeg))
  close(back.translationMm, rigid.translationMm)
})

void test('applying a map and then its inverse comes back, either way round', () => {
  const map = rigidMap({ rotationDeg: [12, -40, 77], translationMm: [5, -8, 13] }, [10, 20, 30], [-4, 6, 9])
  const inverse = invert(map)
  for (const point of [[0, 0, 0], [31.5, -12, 200], [-7, 88, 3.25]] as const) {
    close(apply(inverse, apply(map, point)), point)
    close(apply(map, apply(inverse, point)), point)
  }
  closeMatrix(multiply(map.matrix, inverse.matrix), identityMatrix)
})

void test('composing two maps applies the inner one first', () => {
  const inner = rigidMap({ rotationDeg: [0, 0, 90], translationMm: [1, 0, 0] }, [0, 0, 0], [0, 0, 0])
  const outer = rigidMap({ rotationDeg: [90, 0, 0], translationMm: [0, 0, 5] }, [0, 0, 0], [0, 0, 0])
  const both = compose(outer, inner)
  for (const point of [[1, 0, 0], [2, -3, 4]] as const) close(apply(both, point), apply(outer, apply(inner, point)))
  // x goes to y and along by 1, then y's part goes to z and up by 5
  close(apply(both, [1, 0, 0]), [1, 0, 6])
  close(apply(compose(invert(both), both), [9, 8, 7]), [9, 8, 7])
})

// The lattice points inside an ellipsoid with semi-axes 60, 40 and 25, each turned and moved by a map. The lattice is
// 3 apart and even about the centre, so the shape's centre is the lattice's
function ellipsoidMoments(place: (point: Vec3) => Vec3) {
  const moments = emptyMoments()
  for (let x = -60; x <= 60; x += 3) {
    for (let y = -39; y <= 39; y += 3) {
      for (let z = -24; z <= 24; z += 3) {
        if ((x / 60) ** 2 + (y / 40) ** 2 + (z / 25) ** 2 > 1) continue
        const [px, py, pz] = place([x, y, z])
        addPoint(moments, px, py, pz)
      }
    }
  }
  return moments
}

void test("an ellipsoid's principal axes are its own, the longest first, and right-handed", () => {
  const frame = principalFrame(ellipsoidMoments((point) => point))
  close(frame.centroid, [0, 0, 0], 1e-9)
  // Each axis up to its sign
  const unsigned = ([x, y, z]: Vec3): Vec3 => [Math.abs(x), Math.abs(y), Math.abs(z)]
  close(unsigned(frame.axes[0]), [1, 0, 0], 1e-9)
  close(unsigned(frame.axes[1]), [0, 1, 0], 1e-9)
  close(unsigned(frame.axes[2]), [0, 0, 1], 1e-9)
  assert.ok(determinant(frame.axes) > 0)
  assert.ok(frame.variances[0] > frame.variances[1] && frame.variances[1] > frame.variances[2])
})

void test('the principal axes recover a known rotation of an ellipsoid within a degree, among the 24 candidates', () => {
  const known = rotationMatrix([20, -35, 50])
  const shift: Vec3 = [14, -9, 30]
  const still = principalFrame(ellipsoidMoments((point) => point))
  const turned = principalFrame(
    ellipsoidMoments((point) => {
      const [x, y, z] = transform(known, point)
      return [x + shift[0], y + shift[1], z + shift[2]]
    }),
  )
  close(turned.centroid, shift, 1e-9)
  const candidates = rotationsBetween(still.axes, turned.axes)
  assert.equal(candidates.length, 24)
  // How far each candidate is from the known rotation, as the angle of the turn between them
  const errors = candidates.map((candidate) => rotationAngle(multiply(candidate, transpose(known))))
  const best = Math.min(...errors)
  assert.ok(best < 1, `the nearest candidate is ${best.toFixed(3)}° from the known rotation`)
  // An ellipsoid looks the same turned half a turn about any of its axes, so four candidates fit it as well; the
  // rest are a quarter turn or more away
  assert.equal(errors.filter((error) => error < 1).length, 1)
  assert.equal(errors.filter((error) => error > 89).length, 23)
})

void test('the 24 candidates are distinct rotations and include the identity', () => {
  assert.equal(axisTurns.length, 24)
  closeMatrix(axisTurns[0], identityMatrix)
  const keys = new Set(axisTurns.map((turn) => turn.flat().join(',')))
  assert.equal(keys.size, 24)
  for (const turn of axisTurns) assert.equal(determinant(turn), 1)
  // Between a shape's axes and the same axes, the candidates are the turns themselves seen in that frame
  const frame = principalFrame(ellipsoidMoments((point) => transform(rotationMatrix([10, 20, 30]), point)))
  const same = rotationsBetween(frame.axes, frame.axes)
  closeMatrix(same[0], identityMatrix, 1e-12)
  assert.equal(same.filter((candidate) => rotationAngle(candidate) < 1e-6).length, 1)
})
