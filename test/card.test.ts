import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipLevel, patchPitch, readGrayScale, referencePatch } from '../scripts/lib/card.ts'
import type { RawImage } from '../scripts/lib/decode.ts'
import type { Triple } from '../src/volume/format.ts'

// The grey strip read on frames built here: blue gel above a black holder, with a strip of grey patches in the holder
// whose white is clipped at the scan's white point, the patches falling by an eighth a step and tinted green as the
// real strip is

const width = 400
const height = 300
// The white patch's last column
const edgeAt = 330

function frame(stripTop: number): { image: RawImage; paint: (x0: number, y0: number, x1: number, y1: number, colour: Triple) => void } {
  const data = new Uint8Array(width * height * 3)
  const paint = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: Triple) => {
    for (let y = y0; y <= Math.min(y1, height - 1); y++) {
      for (let x = x0; x <= x1; x++) data.set([r, g, b], (y * width + x) * 3)
    }
  }
  paint(0, 0, width - 1, height - 1, [20, 40, 90])
  paint(0, stripTop - 10, width - 1, stripTop + 60, [25, 25, 25])
  for (let patch = 0; patch < 10; patch++) {
    paint(edgeAt - (patch + 1) * patchPitch + 1, stripTop, edgeAt - patch * patchPitch, stripTop + 50, patchColour(patch))
  }
  return { image: { width, height, channels: 3, data }, paint }
}

function patchColour(patch: number): Triple {
  if (patch === 0) return [240, 240, 240]
  const value = 240 * 0.875 ** patch
  return [Math.round(value * 0.92), Math.round(value), Math.round(value * 0.9)]
}

void test('the strip is found by its shape and read from the white, and the white is reported clipped', () => {
  const reading = readGrayScale(frame(240).image)
  assert.ok(reading)
  assert.equal(reading.edge, edgeAt)
  assert.deepEqual(reading.rows, [240, 290])
  assert.deepEqual(reading.patches[referencePatch], patchColour(referencePatch))
  assert.deepEqual(reading.patches[0], [240, 240, 240])
  assert.ok(clipLevel <= 240)
  assert.equal(reading.whiteClipped, 1)
  // 18 columns inside each 32-pixel patch, 37 rows inside its 51
  assert.equal(reading.pixels, 18 * 37)
})

void test('a brighter white with no strip beside it is passed over', () => {
  const { image, paint } = frame(240)
  // A control card's white patch in the holder past the strip, brighter than the strip's white and taller, with black
  // to its right: its edge passes the edge test on more rows, so only the strip's falling patches tell the two apart
  paint(350, 235, 385, 290, [250, 250, 250])
  const reading = readGrayScale(image)
  assert.ok(reading)
  assert.equal(reading.edge, edgeAt)
  assert.deepEqual(reading.patches[referencePatch], patchColour(referencePatch))
})

void test('a strip above the searched foot of the frame, or none, is not found', () => {
  assert.equal(readGrayScale(frame(100).image), null)
  const { image, paint } = frame(240)
  paint(0, 200, width - 1, height - 1, [25, 25, 25])
  assert.equal(readGrayScale(image), null)
})
