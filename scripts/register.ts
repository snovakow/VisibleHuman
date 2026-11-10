// The registration script: fits each segment of a body's CT to its cryosections and writes data/<body>/registration.json,
// which the volume script reads to resample the CT into the density channel. Run by `npm run register`.
//
//   --body ID       which body: male or female
//   --samples N     how many slices of each segment the fit is made on, spread along it (8 by default)
//   --preview       redraw the overlays from the registration as saved, fitting nothing
//   --data PATH     the data root, else VHP_DATA, else ~/Data/VisibleHuman
//
// A segment is a run of CT slices that share one geometry (field of view, centre, scan and how the body entered the
// scanner, from the header texts) within one cryo block.
// Each segment is fitted jointly on its sample slices, by the share of the CT's bone that lands on pale tissue in the
// photographs and, where the CT shows the body alone, the overlap of the two body silhouettes: on every slice of a CT
// scanned in air, as the female's, and where the silhouettes' areas agree for the male's frozen CT.
// Each segment is fitted under each of the four flips; the flip is then chosen per scan, by the scores summed over the
// scan's segments, since a scan writes all its images one way.
// A body photographed several times a number, as the female's a, b and c, is fitted on the middle photograph of each
// sample number, against the CT slice of that number.
// Overlays go to .cache/preview/register/<body>-<slice>.png: the slice at two pixels a millimetre, the CT bone outline
// magenta where the search started and cyan where it ended

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCtHeader, type CtHeader } from '../src/volume/ctHeader.ts'
import { apply, ctToCryo, flips, type Affine, type Flip, type Point, type Similarity } from '../src/volume/similarity.ts'
import { bodyOf, ctFileName, fileName, type Body } from './lib/bodies.ts'
import { dataRoot, requireDataFile, setFolder } from './lib/data.ts'
import { readGray, readRgb, writePng, type RawImage } from './lib/decode.ts'
import {
  cryoCellPx,
  cryoMasks,
  ctMasks,
  fitSimilarity,
  maskOutline,
  samplePair,
  sampleScores,
  silhouettesComparable,
  type SamplePair,
} from './lib/images.ts'
import { previewFolder } from './lib/previews.ts'
import { loadRegistration, saveRegistration, type Registration, type Segment } from './lib/registration.ts'

const overlayFolder = join(previewFolder, 'register')
// Each millimetre cell of an overlay is drawn this many pixels across
const overlayScale = 2
const magenta = [255, 0, 255] as const
const cyan = [0, 255, 255] as const

function options() {
  const { values } = parseArgs({
    options: {
      body: { type: 'string' },
      samples: { type: 'string', default: '8' },
      preview: { type: 'boolean', default: false },
      data: { type: 'string' },
    },
    strict: true,
  })
  if (values.body === undefined) throw new Error('--body says which body to register, as in --body male')
  const body = bodyOf(values.body)
  if (!body.ct) throw new Error(`The ${body.id} has no CT set to register`)
  const samples = Number(values.samples)
  if (!Number.isInteger(samples) || samples < 1) throw new Error(`--samples takes a count, not ${values.samples}`)
  return { body, ct: body.ct, samples, preview: values.preview, root: dataRoot(values.data) }
}

// One CT slice's geometry, read from its header, for every slice of the body that has one
async function readHeaders(body: Body, root: string) {
  const folder = setFolder(root, body.ct!.set)
  const headers = new Map<number, CtHeader>()
  for (let slice = body.firstSlice; slice <= body.lastSlice; slice++) {
    const name = ctFileName(body, 'header', slice)
    let text: string
    try {
      text = await readFile(join(folder, name), 'latin1')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    headers.set(slice, parseCtHeader(text, name))
  }
  return headers
}

// The geometry a slice was scanned with, as a key: slices with the same key share a similarity
const geometryKey = (header: CtHeader) =>
  [header.dfovMm, header.pixelMm, header.size.join('x'), header.centerRAS[0], header.centerRAS[1], header.exam, header.entry].join('|')

// The runs of consecutive slices that share a geometry, each cut at the cryo blocks' boundaries
function segmentRanges(body: Body, headers: ReadonlyMap<number, CtHeader>): { first: number; last: number; header: CtHeader }[] {
  const runs: { first: number; last: number; header: CtHeader }[] = []
  for (const [slice, header] of [...headers.entries()].sort(([a], [b]) => a - b)) {
    const run = runs[runs.length - 1]
    if (run && run.last === slice - 1 && geometryKey(run.header) === geometryKey(header)) run.last = slice
    else runs.push({ first: slice, last: slice, header })
  }
  const segments: typeof runs = []
  for (const run of runs) {
    for (const [blockFirst, blockLast] of body.cryoBlocks) {
      const first = Math.max(run.first, blockFirst)
      const last = Math.min(run.last, blockLast)
      if (first <= last) segments.push({ first, last, header: run.header })
    }
  }
  return segments
}

// The slices a segment is fitted on: count of them spread evenly, each the middle of its share of the segment, so the
// frosty first slices of a block and the short last ones are passed over; every slice where the segment is shorter
function sampleSlices(first: number, last: number, count: number, skip: ReadonlySet<number>) {
  const length = last - first + 1
  if (length <= count) return Array.from({ length }, (_, n) => first + n).filter((slice) => !skip.has(slice))
  const slices: number[] = []
  for (let n = 0; n < count; n++) {
    let slice = first + Math.floor(((n + 0.5) * length) / count)
    while (skip.has(slice) && slice < last) slice++
    if (!skip.has(slice)) slices.push(slice)
  }
  return slices
}

// The cryosection at a millimetre a pixel, in colour, as the overlays' background
function downsampled(image: RawImage) {
  const { width, height, channels, data } = image
  const W = Math.floor(width / cryoCellPx)
  const H = Math.floor(height / cryoCellPx)
  const out = new Uint8Array(W * H * 3)
  const pixels = cryoCellPx * cryoCellPx
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < cryoCellPx; dy++) {
        let offset = ((Y * cryoCellPx + dy) * width + X * cryoCellPx) * channels
        for (let dx = 0; dx < cryoCellPx; dx++, offset += channels) {
          r += data[offset]
          g += data[offset + 1]
          b += data[offset + 2]
        }
      }
      const at = (X + W * Y) * 3
      out[at] = Math.round(r / pixels)
      out[at + 1] = Math.round(g / pixels)
      out[at + 2] = Math.round(b / pixels)
    }
  }
  return { width: W, height: H, channels: 3, data: out }
}

// Draws the CT bone outline over the slice, through two maps, and writes the overlay
async function drawOverlay(path: string, cryo: RawImage, outline: Float64Array, before: Affine, after: Affine) {
  const base = downsampled(cryo)
  const width = base.width * overlayScale
  const height = base.height * overlayScale
  const data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(x / overlayScale) + base.width * Math.floor(y / overlayScale)) * 3
      data.set(base.data.subarray(from, from + 3), (x + width * y) * 3)
    }
  }
  const plot = (map: Affine, colour: readonly [number, number, number]) => {
    for (let n = 0; n < outline.length; n += 2) {
      const [x, y] = apply(map, [outline[n], outline[n + 1]])
      const px = Math.round((x / cryoCellPx) * overlayScale)
      const py = Math.round((y / cryoCellPx) * overlayScale)
      for (let dy = 0; dy < overlayScale; dy++) {
        for (let dx = 0; dx < overlayScale; dx++) {
          const ox = px + dx
          const oy = py + dy
          if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue
          data.set(colour, (ox + width * oy) * 3)
        }
      }
    }
  }
  plot(before, magenta)
  plot(after, cyan)
  await writePng(path, { width, height, channels: 3, data })
}

// One sample slice's images and masks
interface Sample {
  pair: SamplePair
  cryo: RawImage
  outline: Float64Array
}

// The photograph a number's CT slice is matched with: the middle one of its sub-slices
const sampleSub = (body: Body) => body.naming.subSlices[Math.floor((body.naming.subSlices.length - 1) / 2)]

async function readSample(body: Body, slice: number, pixelMm: number, root: string): Promise<Sample> {
  const [cryo, ct] = await Promise.all([
    readRgb(await requireDataFile(root, body.set, fileName(body, slice, sampleSub(body)))),
    readGray(await requireDataFile(root, body.ct!.set, ctFileName(body, 'image', slice))),
  ])
  if (cryo.width !== body.width || cryo.height !== body.height) {
    throw new Error(`Slice ${slice} is ${cryo.width} × ${cryo.height}, not ${body.width} × ${body.height}`)
  }
  const masks = ctMasks(ct, pixelMm)
  const pair = samplePair(slice, cryoMasks(cryo, { isBody: body.segmentRule, pixelMm: body.pixelSize }), masks, pixelMm, body.pixelSize)
  return { pair, cryo, outline: maskOutline(masks.bone) }
}

// Where every search starts: the CT's scale from its pixel size, no flip or turn, its centre on the slice image's centre
const startOf = (body: Body, pixelMm: number): Similarity => ({
  scale: pixelMm / body.pixelSize,
  rotationDeg: 0,
  tx: (body.width - 1) / 2,
  ty: (body.height - 1) / 2,
  flip: 'none',
})

const ctCentre = (header: { size: readonly [number, number] }): Point => [(header.size[0] - 1) / 2, (header.size[1] - 1) / 2]

const fixed = (value: number, places: number, width: number) => value.toFixed(places).padStart(width)

function printTable(segments: readonly Segment[]) {
  console.log('segment  slices      dfov  flip        scale  rotation       tx       ty   bone  body')
  segments.forEach((segment, n) => {
    const body = segment.bodyScore === undefined ? '    –' : fixed(segment.bodyScore, 2, 5)
    console.log(
      `${String(n + 1).padStart(7)}  ${segment.slices.join('–').padEnd(10)}  ${String(segment.dfovMm).padStart(4)}  ` +
        `${segment.flip.padEnd(10)}  ${fixed(segment.scale, 3, 5)}  ${fixed(segment.rotationDeg, 2, 8)}  ` +
        `${fixed(segment.tx, 1, 7)}  ${fixed(segment.ty, 1, 7)}  ${fixed(segment.score, 2, 5)}  ${body}`,
    )
  })
}

async function main() {
  const { body, ct, samples: sampleCount, preview, root } = options()
  const started = performance.now()
  // A number with a blank, empty or absent photograph sits beside a block's end or a gap, and is never a sample
  const skip = new Set([...body.blankFiles, ...body.emptyFiles, ...body.absentFiles].map((file) => Number(file.replace(/\D/g, ''))))
  const overlayPath = (slice: number) => join(overlayFolder, `${body.id}-${slice}.png`)

  if (preview) {
    const registration = await loadRegistration(body.id)
    if (!registration) throw new Error(`No registration to preview; npm run register -- --body ${body.id} fits one`)
    for (const segment of registration.segments) {
      const centre = ctCentre({ size: segment.ctSize })
      for (const slice of segment.samples) {
        const sample = await readSample(body, slice, segment.ctPixelMm, root)
        const start = startOf(body, segment.ctPixelMm)
        await drawOverlay(overlayPath(slice), sample.cryo, sample.outline, ctToCryo(start, centre), ctToCryo(segment, centre))
        console.log(`Overlay: ${overlayPath(slice)}`)
      }
    }
    printTable(registration.segments)
    return
  }

  console.log(`Reading the ${body.id}'s CT headers from ${setFolder(root, ct.set)}`)
  const headers = await readHeaders(body, root)
  if (headers.size === 0) throw new Error(`No CT headers found in ${setFolder(root, ct.set)}`)
  const ranges = segmentRanges(body, headers)
  console.log(`${headers.size} CT slices in ${ranges.length} segments`)

  // Each segment fitted under each flip alone, its samples' images let go once fitted
  const fits = []
  for (const range of ranges) {
    const { header } = range
    const slices = sampleSlices(range.first, range.last, sampleCount, skip)
    const pairs = (await Promise.all(slices.map((slice) => readSample(body, slice, header.pixelMm, root)))).map((sample) => sample.pair)
    const centre = ctCentre(header)
    const useBody = ct.inAir === true || silhouettesComparable(pairs)
    const start = startOf(body, header.pixelMm)
    const fitStarted = performance.now()
    const search = { centre, pixelsPerMm: 1 / body.pixelSize, useBody }
    const byFlip = new Map(flips.map((flip) => [flip, fitSimilarity(pairs, start, { ...search, flips: [flip] })]))
    const seconds = Math.round((performance.now() - fitStarted) / 1000)
    fits.push({ range, slices, pairs, centre, useBody, start, byFlip, seconds })
  }

  // A flip is how the scanner wrote the images, which holds for a whole scan: each scan takes the flip whose fits score
  // best summed over its segments, so a segment the body's near symmetry leaves in doubt, as the female's shoulders at
  // 440 mm, follows the rest of its scan rather than its own narrow best
  const scanOf = (header: CtHeader) => `exam ${header.exam}, ${header.entry}`
  const scanFlips = new Map<string, Flip>()
  for (const scan of new Set(fits.map((fit) => scanOf(fit.range.header)))) {
    const inScan = fits.filter((fit) => scanOf(fit.range.header) === scan)
    const totals = flips.map((flip) => ({ flip, total: inScan.reduce((sum, fit) => sum + fit.byFlip.get(flip)!.scores.total, 0) }))
    const best = totals.reduce((a, b) => (b.total > a.total ? b : a))
    scanFlips.set(scan, best.flip)
    console.log(
      `Scan ${scan}, ${inScan.length} segments: summed scores ${totals.map(({ flip, total }) => `${flip} ${total.toFixed(3)}`).join(', ')}; ` +
        `${best.flip} taken`,
    )
  }

  const segments: Segment[] = []
  for (const { range, slices, pairs, centre, useBody, start, byFlip, seconds } of fits) {
    const { header } = range
    const flip = scanFlips.get(scanOf(header))!
    const best = byFlip.get(flip)!
    const own = [...byFlip.values()].reduce((a, b) => (b.scores.total > a.scores.total ? b : a))
    const segment: Segment = {
      slices: [range.first, range.last],
      ctPixelMm: header.pixelMm,
      dfovMm: header.dfovMm,
      ctSize: header.size,
      ...best.similarity,
      score: best.scores.bone,
      samples: slices,
    }
    if (useBody) segment.bodyScore = best.scores.body
    segments.push(segment)
    const perSlice = pairs.map((pair) => {
      const scores = sampleScores(pair, best.similarity, centre, useBody)
      return `${pair.slice} ${scores.bone.toFixed(2)}${useBody ? `/${scores.body.toFixed(2)}` : ''}`
    })
    const overruled =
      own.similarity.flip === flip
        ? ''
        : ` (alone it scored best under a ${own.similarity.flip} flip, ${own.scores.total.toFixed(3)} against ${best.scores.total.toFixed(3)})`
    console.log(
      `Segment ${segments.length}, slices ${range.first}–${range.last} at ${header.dfovMm} mm, ${header.entry}, exam ${header.exam}: ` +
        `${flip} flip${overruled}, bone share ${best.scores.bone.toFixed(3)}` +
        `${useBody ? `, silhouette Dice ${best.scores.body.toFixed(3)}` : ', silhouettes not comparable, so bone alone'}, ` +
        `fitted in ${seconds} s; per slice: ${perSlice.join(', ')}`,
    )
    const before = ctToCryo(start, centre)
    const after = ctToCryo(best.similarity, centre)
    for (const slice of slices) {
      const sample = await readSample(body, slice, header.pixelMm, root)
      await drawOverlay(overlayPath(slice), sample.cryo, sample.outline, before, after)
      console.log(`Overlay: ${overlayPath(slice)}`)
    }
  }

  const registration: Registration = {
    body: body.id,
    source: ct.source,
    fitted: new Date().toISOString().slice(0, 10),
    cryoPixelMm: body.pixelSize,
    segments,
  }
  const path = await saveRegistration(registration)
  printTable(segments)
  console.log(`Wrote ${path} in ${Math.round((performance.now() - started) / 1000)} s`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
