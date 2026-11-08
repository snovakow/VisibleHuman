// The image side of the CT registration: the cryosection and CT slices reduced to masks on grids of about a
// millimetre, the overlap score between them under a candidate similarity, and the coarse-to-fine search that finds
// the best one. Nothing here reads a file; the register script hands in decoded images

import { densityFromCt } from '../../src/volume/density.ts'
import { isBodyPixel } from '../../src/volume/segment.ts'
import { ctToCryo, flips, type Affine, type Flip, type Point, type Similarity } from '../../src/volume/similarity.ts'
import type { GrayImage, RawImage } from './decode.ts'

// A mask of cells, each cellPx × cellPx source pixels, row by row
export interface Mask {
  width: number
  height: number
  cellPx: number
  cells: Uint8Array
}

// The cryosection's 0.33 mm pixels in threes make 0.99 mm cells
export const cryoCellPx = 3
// A cryo cell is body when at least this many of its nine pixels are
const cryoBodyPixels = 5
// A cryo cell is pale when at least this many of its pixels are...
const cryoPalePixels = 3
// ...and every cell within this many cells of it is body, which keeps the frost at the skin out of the pale mask
const paleInset = 2
// A pale pixel, the look of bone in the photographs: luminance at least this and saturation at most this. Measured
// under the registered CT's bone on slices 1135, 1306, 1699, 1943, 2144 and 2505: bone has a median luminance of
// 136–176 and a median saturation of 0.35–0.41, fat and pale muscle a saturation of 0.47–0.56, so the rule keeps most
// of the bone and a share of the fat; a stricter rule tried first, luminance 150 with the channels within 60, kept
// 6–29 % of the bone and mostly frost
export const paleLuminance = 120
export const paleSaturation = 0.45
// On the CT's density scale, body and bone
export const ctBodyDensity = 40
export const ctBoneDensity = 100
// A piece of a body mask smaller than this, in square millimetres, is not the body: the slice's tag and the card's
// patches on the cryosection, the scanner table's streaks under the body on the CT
export const minPieceMm2 = 2000
// The CT's body silhouette is only matched where it shows the body alone, which its area tells: within this of the
// cryosection's body area
export const outlineAreaTolerance = 0.2
// The CT is reconstructed inside a circle that touches the image's sides, and its rim reads as bone where the body
// reaches it, as the male's arms do at the 480 mm field; pixels within this many of the rim, or past it, are not read
const ctRimPx = 4

// Whether a CT pixel lies inside the reconstruction circle, clear of its rim
export function insideCtField(u: number, v: number, size: readonly [number, number]) {
  const cu = (size[0] - 1) / 2
  const cv = (size[1] - 1) / 2
  const radius = Math.min(size[0], size[1]) / 2 - ctRimPx
  return (u - cu) * (u - cu) + (v - cv) * (v - cv) <= radius * radius
}

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

// The mask's pieces of at least minCells cells, joined across sides; the smaller pieces are dropped
export function keepPieces(cells: Uint8Array, width: number, height: number, minCells: number): Uint8Array {
  const kept = new Uint8Array(cells.length)
  const seen = new Uint8Array(cells.length)
  const queue = new Int32Array(cells.length)
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === 0 || seen[start] !== 0) continue
    let head = 0
    let tail = 0
    seen[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const at = queue[head++]
      const x = at % width
      const y = (at - x) / width
      for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1]) {
        if (next < 0 || cells[next] === 0 || seen[next] !== 0) continue
        seen[next] = 1
        queue[tail++] = next
      }
    }
    if (tail < minCells) continue
    for (let n = 0; n < tail; n++) kept[queue[n]] = 1
  }
  return kept
}

export interface CryoMaskOptions {
  isBody?: (r: number, g: number, b: number) => boolean
  pixelMm?: number
  luminance?: number
  saturation?: number
}

// The cryosection's body and pale masks. The body is every piece of body cells large enough to be body, which drops
// the tag and the card; pale cells sit inside it
export function cryoMasks(image: RawImage, options: CryoMaskOptions = {}): { body: Mask; pale: Mask } {
  const { isBody = isBodyPixel, pixelMm = 0.33, luminance: paleFrom = paleLuminance, saturation: saturationTo = paleSaturation } = options
  const { width, height, channels, data } = image
  const cellPx = cryoCellPx
  const W = Math.floor(width / cellPx)
  const H = Math.floor(height / cellPx)
  const bodyCounts = new Uint8Array(W * H)
  const paleCounts = new Uint8Array(W * H)
  for (let y = 0; y < H * cellPx; y++) {
    const row = Math.floor(y / cellPx) * W
    let offset = y * width * channels
    for (let x = 0; x < W * cellPx; x++, offset += channels) {
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      if (!isBody(r, g, b)) continue
      const cell = row + Math.floor(x / cellPx)
      bodyCounts[cell]++
      const max = Math.max(r, g, b)
      if (luminance(r, g, b) >= paleFrom && (max - Math.min(r, g, b)) / max <= saturationTo) paleCounts[cell]++
    }
  }
  const cellMm = cellPx * pixelMm
  const bodyCells = bodyCounts.map((count) => (count >= cryoBodyPixels ? 1 : 0))
  const body = keepPieces(bodyCells, W, H, minPieceMm2 / (cellMm * cellMm))
  const pale = new Uint8Array(W * H)
  for (let Y = paleInset; Y < H - paleInset; Y++) {
    for (let X = paleInset; X < W - paleInset; X++) {
      if (paleCounts[X + W * Y] < cryoPalePixels) continue
      let inside = true
      for (let dy = -paleInset; dy <= paleInset && inside; dy++) {
        for (let dx = -paleInset; dx <= paleInset; dx++) {
          if (body[X + dx + W * (Y + dy)] === 0) {
            inside = false
            break
          }
        }
      }
      if (inside) pale[X + W * Y] = 1
    }
  }
  return { body: { width: W, height: H, cellPx, cells: body }, pale: { width: W, height: H, cellPx, cells: pale } }
}

// The CT slice's body and bone masks on cells of about a millimetre: whole pixels at 0.9375 mm, pairs at 0.527.
// A cell is body by its mean density and bone by its densest pixel, so thin cortical bone survives the pairing; the
// body keeps only its pieces large enough to be body, which drops the scanner table's streaks
export function ctMasks(image: GrayImage, pixelMm: number, boneFrom = ctBoneDensity): { body: Mask; bone: Mask } {
  const cellPx = Math.max(1, Math.round(1 / pixelMm))
  const W = Math.floor(image.width / cellPx)
  const H = Math.floor(image.height / cellPx)
  const bodyCells = new Uint8Array(W * H)
  const bone = new Uint8Array(W * H)
  const size = [image.width, image.height] as const
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let sum = 0
      let max = 0
      for (let dy = 0; dy < cellPx; dy++) {
        for (let dx = 0; dx < cellPx; dx++) {
          const u = X * cellPx + dx
          const v = Y * cellPx + dy
          if (!insideCtField(u, v, size)) continue
          const density = densityFromCt(image.data[v * image.width + u])
          sum += density
          if (density > max) max = density
        }
      }
      const cell = X + W * Y
      if (sum / (cellPx * cellPx) >= ctBodyDensity) bodyCells[cell] = 1
      if (max >= boneFrom) bone[cell] = 1
    }
  }
  const cellMm = cellPx * pixelMm
  const body = keepPieces(bodyCells, W, H, minPieceMm2 / (cellMm * cellMm))
  return { body: { width: W, height: H, cellPx, cells: body }, bone: { width: W, height: H, cellPx, cells: bone } }
}

export const maskArea = (mask: Mask) => mask.cells.reduce((count, cell) => count + cell, 0)

// The set cells' centres in source pixels, as pairs, every step-th cell along each axis
export function maskPoints(mask: Mask, step = 1): Float64Array {
  const { width, height, cellPx, cells } = mask
  const half = (cellPx - 1) / 2
  const found: number[] = []
  for (let Y = 0; Y < height; Y += step) {
    for (let X = 0; X < width; X += step) {
      if (cells[X + width * Y] === 0) continue
      found.push(X * cellPx + half, Y * cellPx + half)
    }
  }
  return Float64Array.from(found)
}

// The set cells with an unset neighbour across a side, as points, for drawing a mask's outline
export function maskOutline(mask: Mask): Float64Array {
  const { width, height, cells } = mask
  const edge = new Uint8Array(cells.length)
  for (let Y = 0; Y < height; Y++) {
    for (let X = 0; X < width; X++) {
      const at = X + width * Y
      if (cells[at] === 0) continue
      if (X === 0 || Y === 0 || X === width - 1 || Y === height - 1) {
        edge[at] = 1
        continue
      }
      if (cells[at - 1] === 0 || cells[at + 1] === 0 || cells[at - width] === 0 || cells[at + width] === 0) edge[at] = 1
    }
  }
  return maskPoints({ ...mask, cells: edge })
}

// How many of the points, mapped by the affine into the target's source pixels, land on a set cell
export function hits(points: Float64Array, map: Affine, target: Mask): number {
  const { a, b, c, d, e, f } = map
  const { width, height, cellPx, cells } = target
  const perCell = 1 / cellPx
  let count = 0
  for (let n = 0; n < points.length; n += 2) {
    const u = points[n]
    const v = points[n + 1]
    const x = a * u + b * v + e
    const y = c * u + d * v + f
    if (x < 0 || y < 0) continue
    const X = Math.floor(x * perCell)
    const Y = Math.floor(y * perCell)
    if (X >= width || Y >= height) continue
    count += cells[X + width * Y]
  }
  return count
}

// One slice's masks, ready to score: the cryosection's as lookup targets, the CT's as the points mapped onto them,
// with each mask's area in square millimetres, since the two grids' cells differ in size
export interface SamplePair {
  slice: number
  cryo: { body: Mask; pale: Mask }
  ct: { body: Mask; bone: Mask }
  ctBone: Float64Array
  ctBody: Float64Array
  // Square millimetres per CT point and per cryo cell
  ctCellArea: number
  cryoCellArea: number
  cryoBodyArea: number
}

// How far the body term's points are thinned: every third cell each way, since the silhouette is a broad, smooth
// target and the bone the sharp one
const bodyPointStep = 3

export function samplePair(
  slice: number,
  cryo: { body: Mask; pale: Mask },
  ct: { body: Mask; bone: Mask },
  ctPixelMm: number,
  cryoPixelMm: number,
): SamplePair {
  const ctCellMm = ct.body.cellPx * ctPixelMm
  const cryoCellMm = cryo.body.cellPx * cryoPixelMm
  return {
    slice,
    cryo,
    ct,
    ctBone: maskPoints(ct.bone),
    ctBody: maskPoints(ct.body, bodyPointStep),
    ctCellArea: ctCellMm * ctCellMm,
    cryoCellArea: cryoCellMm * cryoCellMm,
    cryoBodyArea: maskArea(cryo.body) * cryoCellMm * cryoCellMm,
  }
}

export interface Scores {
  // The share of the CT's bone cells that land on pale cryo cells, over every sample. Not a Dice: the pale cells are
  // many times the bone's area, since fat is pale too, so a Dice between the two would top out near 0.2 at the best
  // alignment, while the share rises from about a quarter at a random one to most of the bone at the right one
  bone: number
  // The Dice overlap of the two body silhouettes, by area
  body: number
  // What the search maximised: the bone share, with the silhouette overlap averaged in where it's used
  total: number
}

// Whether the segment's CT shows the body alone, so the silhouettes can be matched: the CT body area within the
// tolerance of the cryosection's, summed over the samples, in square millimetres
export function silhouettesComparable(samples: readonly SamplePair[]): boolean {
  let ct = 0
  let cryo = 0
  for (const sample of samples) {
    ct += maskArea(sample.ct.body) * sample.ctCellArea
    cryo += sample.cryoBodyArea
  }
  return Math.abs(ct - cryo) <= outlineAreaTolerance * cryo
}

// The scores of one similarity over the samples, jointly, every area in square millimetres
export function score(samples: readonly SamplePair[], similarity: Similarity, centre: Point, useBody: boolean): Scores {
  const map = ctToCryo(similarity, centre)
  let boneHits = 0
  let boneSize = 0
  let bodyHits = 0
  let bodySize = 0
  for (const sample of samples) {
    boneHits += hits(sample.ctBone, map, sample.cryo.pale) * sample.ctCellArea
    boneSize += (sample.ctBone.length / 2) * sample.ctCellArea
    if (!useBody) continue
    // The body points are thinned, so each stands for a square of cells
    const thinned = bodyPointStep * bodyPointStep
    bodyHits += hits(sample.ctBody, map, sample.cryo.body) * sample.ctCellArea * thinned
    bodySize += (sample.ctBody.length / 2) * sample.ctCellArea * thinned + sample.cryoBodyArea
  }
  const bone = boneSize === 0 ? 0 : boneHits / boneSize
  const body = bodySize === 0 ? 0 : (2 * bodyHits) / bodySize
  return { bone, body, total: useBody ? (bone + body) / 2 : bone }
}

export interface SearchOptions {
  // The CT image's centre, in CT pixels
  centre: Point
  // Cryo pixels per millimetre, which the search's steps are given in
  pixelsPerMm: number
  useBody: boolean
}

// The search: every flip over translations ±80 mm at 4 mm steps around the start, then ±4 mm at 1 mm, then rotation
// ±3° at 0.25°, then ±2 mm at 1 mm once more, since a rotation about the CT centre shifts the body a little
export function fitSimilarity(samples: readonly SamplePair[], start: Similarity, options: SearchOptions) {
  const { centre, pixelsPerMm, useBody } = options
  let best = { similarity: start, scores: score(samples, start, centre, useBody) }
  const consider = (similarity: Similarity) => {
    const scores = score(samples, similarity, centre, useBody)
    if (scores.total > best.scores.total) best = { similarity, scores }
  }
  const translations = (around: Similarity, rangeMm: number, stepMm: number, flip: Flip) => {
    const steps = Math.round(rangeMm / stepMm)
    for (let dy = -steps; dy <= steps; dy++) {
      for (let dx = -steps; dx <= steps; dx++) {
        consider({ ...around, flip, tx: around.tx + dx * stepMm * pixelsPerMm, ty: around.ty + dy * stepMm * pixelsPerMm })
      }
    }
  }
  for (const flip of flips) translations(start, 80, 4, flip)
  translations(best.similarity, 4, 1, best.similarity.flip)
  const centred = best.similarity
  for (let step = -12; step <= 12; step++) consider({ ...centred, rotationDeg: centred.rotationDeg + step * 0.25 })
  translations(best.similarity, 2, 1, best.similarity.flip)
  return best
}

// The score of one sample alone under a similarity, for the log
export const sampleScores = (sample: SamplePair, similarity: Similarity, centre: Point, useBody: boolean) =>
  score([sample], similarity, centre, useBody)
