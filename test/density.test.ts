import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boneDensity, densityFromColor, xrayFloor } from '../src/volume/density.ts'

// The colour stand-in for CT density, on colours sampled from the male's slices: bone pale and unsaturated, muscle red,
// fat yellow. The targets are on the CT's (HU + 1000) / 16 scale, near its own values, with fat a little under its 56

void test('bone-white is above 120, past the bone threshold', () => {
  for (const [r, g, b] of [
    [225, 220, 205],
    [200, 205, 190],
    [240, 240, 235],
  ]) {
    const density = densityFromColor(r, g, b)
    assert.ok(density > 120 && density > boneDensity, `${r} ${g} ${b} gives ${density}`)
  }
})

void test('muscle red is 60 to 70', () => {
  // Sampled from slices 1500 and 2000: the two largest classes of body pixels, and the darker liver and clotted blood
  for (const [r, g, b] of [
    [92, 47, 33],
    [95, 57, 42],
    [82, 40, 30],
    [60, 29, 21],
  ]) {
    const density = densityFromColor(r, g, b)
    assert.ok(density >= 60 && density <= 70, `${r} ${g} ${b} gives ${density}`)
  }
})

void test('fat yellow is 45 to 55', () => {
  // Sampled from slices 2000 and 2600: the pale yellow of the thighs' and calves' fat
  for (const [r, g, b] of [
    [216, 202, 138],
    [224, 204, 129],
    [197, 185, 130],
  ]) {
    const density = densityFromColor(r, g, b)
    assert.ok(density >= 45 && density <= 55, `${r} ${g} ${b} gives ${density}`)
  }
})

void test('black is at least 1, since 0 means outside the body', () => {
  assert.equal(densityFromColor(0, 0, 0), 1)
  assert.ok(densityFromColor(5, 2, 1) >= 1)
})

void test('greys rise with luminance, from black to white', () => {
  let last = 0
  for (let grey = 0; grey <= 255; grey++) {
    const density = densityFromColor(grey, grey, grey)
    assert.ok(density >= last, `grey ${grey} gives ${density}, under ${last}`)
    last = density
  }
  assert.ok(last > 120)
})

void test('the thresholds sit between the tissues they divide', () => {
  // Bone above muscle and fat; the x-ray floor under the soft tissues, so they still haze the image
  assert.ok(boneDensity > 70 && boneDensity < 120)
  assert.ok(xrayFloor < 45)
})
