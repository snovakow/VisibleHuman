import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, compose, ctToCryo, flips, identity, invert, type Point, type Similarity } from '../src/volume/similarity.ts'

// The CT-to-cryo similarity: its convention on known points, its inverse and its composition

// A CT image of 512 × 512 pixels, centred at (256, 256), and the male's scale at 0.9375 mm CT pixels over 0.33 mm
const centre: Point = [256, 256]
const scale = 0.9375 / 0.33

const close = (found: Point, expected: Point, tolerance = 1e-9) => {
  assert.ok(Math.abs(found[0] - expected[0]) <= tolerance, `${found[0]} is not ${expected[0]}`)
  assert.ok(Math.abs(found[1] - expected[1]) <= tolerance, `${found[1]} is not ${expected[1]}`)
}

void test('without a flip or a rotation the CT centre lands on the translation and the scale spreads from it', () => {
  const map = ctToCryo({ scale, rotationDeg: 0, tx: 1000, ty: 600, flip: 'none' }, centre)
  close(apply(map, centre), [1000, 600])
  close(apply(map, [256, 0]), [1000, 600 - 256 * scale])
  close(apply(map, [512, 256]), [1000 + 256 * scale, 600])
})

void test('a vertical flip sends the top of the CT below the centre, where the cryosection has its front', () => {
  const map = ctToCryo({ scale, rotationDeg: 0, tx: 1000, ty: 600, flip: 'vertical' }, centre)
  close(apply(map, [256, 0]), [1000, 600 + 256 * scale])
  // Left and right are untouched
  close(apply(map, [0, 256]), [1000 - 256 * scale, 600])
})

void test('a horizontal flip mirrors left and right only, and both mirrors both', () => {
  const horizontal = ctToCryo({ scale, rotationDeg: 0, tx: 1000, ty: 600, flip: 'horizontal' }, centre)
  close(apply(horizontal, [0, 256]), [1000 + 256 * scale, 600])
  close(apply(horizontal, [256, 0]), [1000, 600 - 256 * scale])
  const both = ctToCryo({ scale, rotationDeg: 0, tx: 1000, ty: 600, flip: 'both' }, centre)
  close(apply(both, [0, 0]), [1000 + 256 * scale, 600 + 256 * scale])
})

void test('a rotation of 90 degrees turns the CT top to the right side of the page', () => {
  // In image coordinates, with y down, R(90°) takes (0, −1) to (1, 0)
  const map = ctToCryo({ scale: 1, rotationDeg: 90, tx: 0, ty: 0, flip: 'none' }, centre)
  close(apply(map, [256, 0]), [256, 0])
  close(apply(map, [0, 256]), [0, -256])
})

void test('the inverse undoes every flip, with a rotation and an offset, to a nanopixel', () => {
  for (const flip of flips) {
    const similarity: Similarity = { scale, rotationDeg: -1.75, tx: 1021.5, ty: 608, flip }
    const map = ctToCryo(similarity, centre)
    const back = invert(map)
    for (const point of [centre, [0, 0], [511, 0], [100.25, 400.5]] as const) {
      close(apply(back, apply(map, point)), point)
      close(apply(map, apply(back, point)), point)
    }
    close(apply(compose(back, map), [33, 44]), [33, 44])
  }
})

void test('composing two maps applies them one after the other', () => {
  const first = ctToCryo({ scale: 2, rotationDeg: 30, tx: 10, ty: 20, flip: 'vertical' }, centre)
  const second = ctToCryo({ scale: 0.5, rotationDeg: -12, tx: -5, ty: 7, flip: 'horizontal' }, [100, 50])
  const composed = compose(second, first)
  for (const point of [[0, 0], [256, 256], [123.4, 567.8]] as const) {
    close(apply(composed, point), apply(second, apply(first, point)))
  }
  close(apply(compose(identity, first), [3, 4]), apply(first, [3, 4]))
})
