import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GrayImage, RawImage } from '../scripts/lib/decode.ts'
import {
  cryoMasks,
  ctMasks,
  fitSimilarity,
  hits,
  insideCtField,
  keepPieces,
  maskArea,
  maskOutline,
  maskPoints,
  samplePair,
  score,
  silhouettesComparable,
} from '../scripts/lib/images.ts'
import { ctToCryo, type Similarity } from '../src/volume/similarity.ts'

// The registration's image side on images built here: a cryosection of blue gel with a body and a pale bone in it,
// and a CT of the same body and bone, placed by a known similarity, which the search has to find again

// The CT pixel is 0.99 mm, so three cryo pixels: a scale of 3 with no rounding in the masks
const ctPixelMm = 0.99
const cryoPixelMm = 0.33
const ctSize = [128, 128] as const
const centre = [63.5, 63.5] as const

// A CT image: air at 0, soft tissue at 1064 (40 HU), bone at 2024 (1,000 HU), a body disc with a bone disc in it
function ctImage(bodyAt: readonly [number, number], bodyRadius: number, boneAt: readonly [number, number], boneRadius: number): GrayImage {
  const data = new Uint16Array(ctSize[0] * ctSize[1])
  for (let v = 0; v < ctSize[1]; v++) {
    for (let u = 0; u < ctSize[0]; u++) {
      const inBody = (u - bodyAt[0]) ** 2 + (v - bodyAt[1]) ** 2 <= bodyRadius ** 2
      const inBone = (u - boneAt[0]) ** 2 + (v - boneAt[1]) ** 2 <= boneRadius ** 2
      data[v * ctSize[0] + u] = inBone ? 2024 : inBody ? 1064 : 0
    }
  }
  return { width: ctSize[0], height: ctSize[1], data }
}

// A cryosection: gel blue, muscle red in the body, pale bone, each CT pixel's disc drawn through the similarity
function cryoImage(width: number, height: number, map: Similarity, bodyAt: readonly [number, number], bodyRadius: number, boneAt: readonly [number, number], boneRadius: number): RawImage {
  const data = new Uint8Array(width * height * 3)
  const affine = ctToCryo(map, centre)
  const bodyCentre = [affine.a * bodyAt[0] + affine.b * bodyAt[1] + affine.e, affine.c * bodyAt[0] + affine.d * bodyAt[1] + affine.f]
  const boneCentre = [affine.a * boneAt[0] + affine.b * boneAt[1] + affine.e, affine.c * boneAt[0] + affine.d * boneAt[1] + affine.f]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (x + width * y) * 3
      const inBody = (x - bodyCentre[0]) ** 2 + (y - bodyCentre[1]) ** 2 <= (bodyRadius * map.scale) ** 2
      const inBone = (x - boneCentre[0]) ** 2 + (y - boneCentre[1]) ** 2 <= (boneRadius * map.scale) ** 2
      const colour = inBone ? [200, 185, 160] : inBody ? [120, 50, 40] : [24, 43, 69]
      data.set(colour, at)
    }
  }
  return { width, height, channels: 3, data }
}

const truth: Similarity = { scale: ctPixelMm / cryoPixelMm, rotationDeg: 0, tx: 300, ty: 210, flip: 'vertical' }
const bodyAt = [60, 70] as const
const boneAt = [50, 56] as const
const ct = ctImage(bodyAt, 40, boneAt, 8)
const cryo = cryoImage(600, 420, truth, bodyAt, 40, boneAt, 8)

void test('the pieces of a mask smaller than the minimum are dropped and the rest kept', () => {
  // A 3-cell run, a lone cell, and a 2 × 2 block on a 6 × 4 grid
  const cells = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])
  assert.deepEqual([...keepPieces(cells, 6, 4, 2)], [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])
  assert.deepEqual([...keepPieces(cells, 6, 4, 4)], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])
})

void test('the CT masks find the body and the bone inside the reconstruction circle', () => {
  const masks = ctMasks(ct, ctPixelMm)
  assert.equal(masks.body.cellPx, 1)
  // A disc of radius 40 has about 5,027 cells; of radius 8 about 201
  assert.ok(Math.abs(maskArea(masks.body) - 5027) < 60, `${maskArea(masks.body)} body cells`)
  assert.ok(Math.abs(maskArea(masks.bone) - 201) < 20, `${maskArea(masks.bone)} bone cells`)
  assert.ok(insideCtField(63.5, 63.5, ctSize))
  assert.ok(!insideCtField(0, 63.5, ctSize))
  assert.ok(!insideCtField(63.5, 126, ctSize))
})

void test('the cryo masks find the body, and the pale bone inside it, in millimetre cells', () => {
  const masks = cryoMasks(cryo, { pixelMm: cryoPixelMm })
  assert.equal(masks.body.cellPx, 3)
  const bodyMm2 = maskArea(masks.body) * 0.99 ** 2
  const paleMm2 = maskArea(masks.pale) * 0.99 ** 2
  assert.ok(Math.abs(bodyMm2 - Math.PI * 39.6 ** 2) < 200, `${bodyMm2} mm² of body`)
  assert.ok(Math.abs(paleMm2 - Math.PI * 7.92 ** 2) < 40, `${paleMm2} mm² of pale bone`)
})

void test('the outline is the mask cells with an unset neighbour', () => {
  const masks = ctMasks(ct, ctPixelMm)
  const outline = maskOutline(masks.bone).length / 2
  // A disc of radius 8 has a boundary of about 2π·8 cells, fewer where the grid's steps share a cell
  assert.ok(outline > 35 && outline < 70, `${outline} outline cells`)
  assert.equal(maskPoints(masks.bone).length / 2, maskArea(masks.bone))
})

void test("a point counts on the cell whose pixels hold it, pixel centres being whole numbers", () => {
  // Cell 1 of 3-pixel cells holds pixels 3 to 5, which span 2.5 to 5.5
  const target = { width: 3, height: 3, cellPx: 3, cells: Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]) }
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const at = (x: number, y: number) => hits(Float64Array.from([x, y]), identity, target)
  assert.equal(at(4, 4), 1)
  assert.equal(at(2.6, 4), 1)
  assert.equal(at(5.4, 5.4), 1)
  assert.equal(at(2.4, 4), 0)
  assert.equal(at(5.6, 4), 0)
  // Past the grid's first pixel's outer edge, nothing is hit
  assert.equal(hits(Float64Array.from([-0.6, 0]), identity, { ...target, cells: new Uint8Array(9).fill(1) }), 0)
  assert.equal(hits(Float64Array.from([-0.4, 0]), identity, { ...target, cells: new Uint8Array(9).fill(1) }), 1)
})

void test('under the true similarity the bone lands on the pale tissue and the silhouettes agree', () => {
  const pair = samplePair(1, cryoMasks(cryo, { pixelMm: cryoPixelMm }), ctMasks(ct, ctPixelMm), ctPixelMm, cryoPixelMm)
  assert.ok(silhouettesComparable([pair]))
  const scores = score([pair], truth, centre, true)
  assert.ok(scores.bone > 0.9, `bone share ${scores.bone}`)
  assert.ok(scores.body > 0.95, `silhouette Dice ${scores.body}`)
  const moved = score([pair], { ...truth, tx: truth.tx + 90 }, centre, true)
  assert.ok(moved.bone < 0.1, `bone share ${moved.bone} after a 30 mm shift`)
  assert.ok(moved.total < scores.total)
  assert.equal(hits(pair.ctBone, ctToCryo({ ...truth, flip: 'none' }, centre), pair.cryo.pale) < pair.ctBone.length / 4, true)
})

void test('the search finds the flip and the translation from the slice centre, to a millimetre', () => {
  const pair = samplePair(1, cryoMasks(cryo, { pixelMm: cryoPixelMm }), ctMasks(ct, ctPixelMm), ctPixelMm, cryoPixelMm)
  const start: Similarity = { ...truth, rotationDeg: 0, tx: 299.5, ty: 209.5, flip: 'none' }
  const shifted: Similarity = { ...start, tx: start.tx + 20 / cryoPixelMm, ty: start.ty - 15 / cryoPixelMm }
  const best = fitSimilarity([pair], shifted, { centre, pixelsPerMm: 1 / cryoPixelMm, useBody: true })
  assert.equal(best.similarity.flip, 'vertical')
  assert.ok(Math.abs(best.similarity.tx - truth.tx) <= 1 / cryoPixelMm, `tx ${best.similarity.tx}`)
  assert.ok(Math.abs(best.similarity.ty - truth.ty) <= 1 / cryoPixelMm, `ty ${best.similarity.ty}`)
  // A disc is the same under a turn about itself, and these lie within 15 CT pixels of the turn's centre, so the turn
  // is held to what moves them: each disc's centre lands within a millimetre of where the truth puts it
  const found = ctToCryo(best.similarity, centre)
  const placed = ctToCryo(truth, centre)
  for (const [u, v] of [bodyAt, boneAt]) {
    const dx = found.a * u + found.b * v + found.e - (placed.a * u + placed.b * v + placed.e)
    const dy = found.c * u + found.d * v + found.f - (placed.c * u + placed.d * v + placed.f)
    assert.ok(Math.hypot(dx, dy) * cryoPixelMm <= 1, `a disc ${(Math.hypot(dx, dy) * cryoPixelMm).toFixed(2)} mm off`)
  }
  assert.ok(Math.abs(best.similarity.rotationDeg) <= 3, `rotation ${best.similarity.rotationDeg}`)
  assert.ok(best.scores.bone > 0.9)
})
