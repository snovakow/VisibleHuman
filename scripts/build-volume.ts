// The volume script: reads a body's colour slices from the data root and writes the gzipped volume file the app
// loads, with previews in .cache/preview/. Run by `npm run volume`, on Node's own TypeScript.
//
//   --body ID          which body: male, female or head
//   --spacing MM       which level, by its voxels' spacing in millimetres: the male's and the female's are 4 and 2,
//                      the head's 1.2, 1 and 0.6
//   --out PATH         write the file there rather than public/volume/<body>-<spacing>mm.bin, or, for a range of
//                      slices, .cache/volume/<body>-<spacing>mm-<from>-<to>.bin; a file written into public/volume/
//                      also gets its entry in public/volume/bodies.json, which the page reads
//   --from A, --to B   read only slices A to B (by default every slice of the body); where a body has sub-slices, as
//                      the female's a, b and c, a bound may name one, as 1500b, and a bare number takes them all. A
//                      range is written into .cache/volume/ unless --out names public/volume/, so that a trial build
//                      never replaces the file the page loads
//   --previews         redraw the previews from the existing file, reading no slice
//   --no-ct            leave the density to the colour stand-in, reading no CT slice
//   --match card|body  give each cryo block a colour gain that matches it to the block before, by the grey strip
//                      photographed beside the slices or by the body's own colour; by default no block takes one
//   --contact-sheet    draw .cache/preview/<body>-sheet.png from the body's small JPEGs and build nothing: a few
//                      slices side by side with the colour of their corners, which a body's axes and background
//                      rule are read from before its first build; takes no --spacing
//   --data PATH        the data root, else VHP_DATA, else ~/Data/VisibleHuman
//
// A pre-pass first measures the colour step where each cryo block meets the next, on the slices either side of the
// boundary: on the grey strip photographed beside them, which reads the exposure, and on the body. Neither explains
// the male's steps as exposure: across two of its boundaries the strip reads brighter while the body reads darker. So
// by default the steps are only reported, and every block is recorded with a gain of 1; --match applies one of them as
// a gain per channel, which scales the block's slices' colour before it's averaged into cells. The body decision reads
// the pixels as photographed, so no gain changes which cells are body.
//
// The density channel comes from the body's CT where data/<body>/registration.json places it on the photographs:
// each layer's CT slices are resampled into the layer's cells through the segment's similarity, and a cell no CT
// covers, such as the crown's slices before the CT begins, keeps the density its colour suggests. The head's CT and
// MRI are whole grids, placed by a rigid transform each: its cells are sampled from them through the transforms, the
// CT into the density and the MRI into a block of its own

import { readFile, stat } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { readBodies, withLevel, type BlockGainEntry, type BodiesFile, type BodyEntry, type LevelEntry } from '../src/volume/bodies.ts'
import { blockGains, boundaryRatio, deadBand, maxGain, minGain, type BoundaryWindows } from '../src/volume/blocks.ts'
import { densityFromColor, densityFromCt } from '../src/volume/density.ts'
import { bodyCoverage, cellIndex, countBody, readVolume, writeVolume, type Triple, type Volume } from '../src/volume/format.ts'
import {
  dipWindowMm,
  enclosedCells,
  filesSpanning,
  fillMissingLayers,
  frostedReason,
  frostReachMm,
  frostReferenceMm,
  frostSide,
  isBodyCell,
  isBodyPixel,
  isThinLayer,
  largestPiece,
  missingReason,
  type MissingReason,
} from '../src/volume/segment.ts'
import { compose, invert as invertRigid, type RigidMap } from '../src/volume/rigid.ts'
import { apply, ctToCryo, invert, type Affine } from '../src/volume/similarity.ts'
import { bodyOf, ctFileName, defaultOutput, frameOf, framesOf, frameText, lastFrame, levelOf, type Body, type Frame, type Level } from './lib/bodies.ts'
import { readGrayScale, referencePatch, type CardReading } from './lib/card.ts'
import { drawContactSheet } from './lib/contactSheet.ts'
import { dataRoot, requireDataFile, setFolder } from './lib/data.ts'
import { gunzipFile, readGray, readRgb, type RawImage } from './lib/decode.ts'
import { readDicomSeries, type DicomVolume } from './lib/dicom.ts'
import { writeWhole } from './lib/files.ts'
import { insideCtField, keepPieces, minPieceMm2 } from './lib/images.ts'
import { drawPreviews } from './lib/previews.ts'
import { loadRegistration, registrationPath, segmentOf, type Registration } from './lib/registration.ts'
import { indexMap, sampleIndex } from './lib/scanFit.ts'
import { catToCryoMap, loadScanRegistration, mriToCatMap, type ScanRegistration } from './lib/scanRegistration.ts'

// Files are decoded this many at a time, within a layer
const batchSize = 4

function options() {
  const { values } = parseArgs({
    options: {
      body: { type: 'string' },
      spacing: { type: 'string' },
      out: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      previews: { type: 'boolean', default: false },
      'no-ct': { type: 'boolean', default: false },
      match: { type: 'string' },
      'contact-sheet': { type: 'boolean', default: false },
      data: { type: 'string' },
    },
    strict: true,
  })
  const sheet = values['contact-sheet']
  if (values.body === undefined || (values.spacing === undefined && !sheet)) {
    throw new Error('--body and --spacing say what to build, as in --body male --spacing 4')
  }
  const body = bodyOf(values.body)
  const root = dataRoot(values.data)
  // A contact sheet is drawn from the body's small JPEGs, at no level
  if (sheet || values.spacing === undefined) return { sheet: true as const, body, root }
  const spacing = Number(values.spacing)
  if (!(spacing > 0)) throw new Error(`--spacing takes millimetres, not ${values.spacing}`)
  const level = levelOf(body, spacing)
  // The range as frame indices, and as the slice numbers it starts and ends in
  const frame = (text: string | undefined, fallback: number, name: string, end: 'first' | 'last') => {
    if (text === undefined) return fallback
    try {
      return frameOf(body, text, end)
    } catch (error) {
      throw new Error(`--${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  const firstFrame = frame(values.from, 0, 'from', 'first')
  const lastFrameRead = frame(values.to, lastFrame(body), 'to', 'last')
  if (firstFrame > lastFrameRead) {
    throw new Error(`--from ${frameText(body, firstFrame)} comes after --to ${frameText(body, lastFrameRead)}`)
  }
  const subs = body.naming.subSlices.length
  const from = body.firstSlice + Math.floor(firstFrame / subs)
  const to = body.firstSlice + Math.floor(lastFrameRead / subs)
  const ranged = values.from !== undefined || values.to !== undefined
  const out = values.out ?? defaultOutput(body, level, ranged ? [firstFrame, lastFrameRead] : null)
  const isMatch = (value: string): value is Match => value === 'card' || value === 'body'
  let match: Match | null = null
  if (values.match !== undefined) {
    if (!isMatch(values.match)) throw new Error(`--match takes card or body, not ${values.match}`)
    match = values.match
  }
  return {
    sheet: false as const,
    body,
    level,
    frames: [firstFrame, lastFrameRead] as const,
    from,
    to,
    out,
    // Where the file goes because a range was asked for without --out, which the log says before the build starts
    rangedOut: ranged && values.out === undefined,
    previews: values.previews,
    noCt: values['no-ct'],
    match,
    root,
  }
}

// The field of cells a slice divides into at a level, and where each pixel falls in it. The last column and row of
// cells are partial where the cell size doesn't divide the image
function fieldOf(body: Body, level: Level) {
  const nx = Math.ceil(body.width / level.pixels)
  const ny = Math.ceil(body.height / level.pixels)
  const layerCells = nx * ny
  const cellColumn = Int32Array.from({ length: body.width }, (_, x) => Math.floor(x / level.pixels))
  const cellRowStart = Int32Array.from({ length: body.height }, (_, y) => Math.floor(y / level.pixels) * nx)
  // The pixels each cell takes from one slice
  const cellPixels = Uint32Array.from({ length: layerCells }, (_, cell) => {
    const across = Math.min(level.pixels, body.width - (cell % nx) * level.pixels)
    const down = Math.min(level.pixels, body.height - Math.floor(cell / nx) * level.pixels)
    return across * down
  })
  return { nx, ny, layerCells, cellColumn, cellRowStart, cellPixels }
}
type Field = ReturnType<typeof fieldOf>

// Frame indices as runs, such as 2017–2020, 2424–2435
function runsText(body: Body, indices: readonly number[]) {
  const runs: string[] = []
  for (let n = 0; n < indices.length; ) {
    let end = n
    while (end + 1 < indices.length && indices[end + 1] === indices[end] + 1) end++
    const first = frameText(body, indices[n])
    runs.push(end === n ? first : `${first}–${frameText(body, indices[end])}`)
    n = end + 1
  }
  return runs.join(', ')
}

// A cell's channels summed over every pixel of a slice, body or not
interface WholeSums {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
}

// One slice's sums: for each cell, its body pixels' channels and their count; and the slice's body pixels in all, with
// their red and blue summed, which tell a slice under frost. Where the body fills what it encloses, every pixel's
// channels too, which is the colour a filled cell takes.
// The slice's pixels aren't kept, only these. The stride through the pixels is the image's channel count
function sliceSums(frame: Frame, position: number, image: RawImage, body: Body, field: Field) {
  const { layerCells, cellColumn, cellRowStart } = field
  const red = new Uint32Array(layerCells)
  const green = new Uint32Array(layerCells)
  const blue = new Uint32Array(layerCells)
  const bodyPixels = new Uint16Array(layerCells)
  const whole: WholeSums | null = body.fillsEnclosed
    ? { red: new Uint32Array(layerCells), green: new Uint32Array(layerCells), blue: new Uint32Array(layerCells) }
    : null
  const isBody = body.segmentRule ?? isBodyPixel
  // The pixels that may be body: all of them, less the strips the body leaves out at the frame's edges
  const inset = body.frameInset ?? {}
  const firstColumn = inset.left ?? 0
  const columnsEnd = body.width - (inset.right ?? 0)
  const firstRow = inset.top ?? 0
  const rowsEnd = body.height - (inset.bottom ?? 0)
  const { data, channels } = image
  let total = 0
  let totalRed = 0
  let totalBlue = 0
  for (let y = 0; y < body.height; y++) {
    const rowStart = cellRowStart[y]
    const inRows = y >= firstRow && y < rowsEnd
    let offset = y * body.width * channels
    for (let x = 0; x < body.width; x++, offset += channels) {
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const cell = rowStart + cellColumn[x]
      if (whole) {
        whole.red[cell] += r
        whole.green[cell] += g
        whole.blue[cell] += b
      }
      if (!inRows || x < firstColumn || x >= columnsEnd || !isBody(r, g, b)) continue
      red[cell] += r
      green[cell] += g
      blue[cell] += b
      bodyPixels[cell]++
      total++
      totalRed += r
      totalBlue += b
    }
  }
  return { frame, position, red, green, blue, body: bodyPixels, whole, total, totalRed, totalBlue, unread: null as Unread | null }
}
type SliceSums = ReturnType<typeof sliceSums>

// Why a slice was read as missing without its pixels: the set lacks its file, or its file can't be decoded
type Unread = 'absent' | 'undecodable'

// The sums of a slice with nothing in it, for one that wasn't read
const emptySums = (frame: Frame, position: number, field: Field, unread: Unread): SliceSums => ({
  frame,
  position,
  unread,
  red: new Uint32Array(field.layerCells),
  green: new Uint32Array(field.layerCells),
  blue: new Uint32Array(field.layerCells),
  body: new Uint16Array(field.layerCells),
  whole: null,
  total: 0,
  totalRed: 0,
  totalBlue: 0,
})

// A slice's pixels, read from its file in the data root, or why it wasn't read: a file the body lists as absent isn't
// looked for, and one that can't be decoded stops the build, unless the body lists it as blank or empty, when it's
// named in the log and read as missing. A file of another size than the body's slices stops the build too, unless the
// body lists it as having rows to spare, when its top rows are read
async function readSlice(frame: Frame, body: Body, root: string, unreadable: ReadonlySet<string>): Promise<RawImage | Unread> {
  if (frame.absent) return 'absent'
  const path = await requireDataFile(root, body.set, frame.name)
  let image: RawImage
  try {
    image = await readRgb(path)
  } catch (error) {
    if (!unreadable.has(frame.name)) throw new Error(`${path} can't be decoded: ${String(error)}`, { cause: error })
    console.log(`${frame.name} can't be decoded, so it's read as missing: ${error instanceof Error ? error.message : String(error)}`)
    return 'undecodable'
  }
  if (image.width === body.width && image.height > body.height && body.tallFiles?.includes(frame.name)) {
    return { ...image, height: body.height, data: image.data.subarray(0, body.width * body.height * image.channels) }
  }
  if (image.width !== body.width || image.height !== body.height) {
    throw new Error(`${path} is ${image.width} × ${image.height}, not ${body.width} × ${body.height}`)
  }
  return image
}

// A slice's sums, read from its file in the data root
async function readFrame(frame: Frame, position: number, body: Body, field: Field, root: string, unreadable: ReadonlySet<string>) {
  const image = await readSlice(frame, body, root, unreadable)
  return typeof image === 'string' ? emptySums(frame, position, field, image) : sliceSums(frame, position, image, body, field)
}

// The files that are read as missing when they can't be decoded, rather than stopping the build
const unreadableOf = (body: Body) => new Set([...body.blankFiles, ...body.emptyFiles])

// The window either side of a boundary between cryo blocks that its step is measured on: the slices kept over this
// many millimetres on each side, past those kept over the few millimetres nearest the boundary, which the frost on a
// block's two faces still tints (slice 2016 of the male before a boundary, and 2021 to 2024 after it, past the four
// its frost leaves short). Counted in millimetres, as the short rule's window is, so the windows span as much of
// every body; kept here means kept by the blank and short rules, the frosted slices either side of a boundary lying
// within the skip
const gainWindowMm = 8
const frostSkipMm = 4
// Gains are recorded to this many decimals, and applied as recorded
const gainDecimals = 4
// A window whose strip readings range over more than this share of their mean is suspect: read on the first patch
// that the scan doesn't clip, the male's strip holds to 0.2 to 0.5 % within a window
const suspectSpread = 0.02

// What a block's colour is matched to the block before it by, if anything: the grey strip photographed beside each
// slice, or the body's own colour either side of the boundary
type Match = 'card' | 'body'

// A cryo block's gain per channel, from its first slice to its last
interface BlockGains {
  blocks: readonly (readonly [number, number])[]
  gains: readonly Triple[]
}

// A window's slices summed into the field's cells, as a layer is: per cell, its body pixels' channels and count, and
// its pixels
function windowSums(field: Field) {
  const { layerCells } = field
  return {
    red: new Float64Array(layerCells),
    green: new Float64Array(layerCells),
    blue: new Float64Array(layerCells),
    body: new Uint32Array(layerCells),
    pixels: new Uint32Array(layerCells),
  }
}
type WindowSums = ReturnType<typeof windowSums>

const unitTriple: Triple = [1, 1, 1]
const luminanceOf = ([r, g, b]: Triple) => 0.299 * r + 0.587 * g + 0.114 * b
const meanTriple = (values: readonly Triple[]): Triple => {
  const mean = (c: number) => values.reduce((sum, value) => sum + value[c], 0) / values.length
  return [mean(0), mean(1), mean(2)]
}

// Measures the colour step at each boundary between the body's cryo blocks two ways, from the windows either side of
// it, and gives each block a gain from one of them if `match` asks, else 1. The grey strip (card.ts) reads the
// exposure: its reference patch's mean over each window's slices, a slice whose strip isn't found named and left out.
// The body reads everything that changed: its colour over the cells that are body in both windows, in pieces large
// enough to be body, so both sides are the same stretch of it, since the tags and the cards pass the body rule too
// and come and go from block to block (the male's legs start beside a card of coloured patches, 2436 to 2443). A slice
// is kept or missing by the build's blank and short rules (segment.ts), judged among the body's slices whatever --from
// and --to say, so a range takes the gains the whole body does; only the boundaries before the range's last block are
// measured. Prints both, per boundary, and the gains each would give
async function measureBlocks(body: Body, level: Level, field: Field, to: number, root: string, match: Match | null): Promise<BlockGains> {
  const blocks = body.cryoBlocks.filter(([first]) => first <= to)
  const unit = blocks.map((): Triple => [1, 1, 1])
  if (blocks.length < 2) return { blocks, gains: unit }
  const started = performance.now()
  const frames = framesOf(body, 0, lastFrame(body))
  const blanks = unreadableOf(body)
  const { layerCells, cellPixels } = field
  const dipWindow = filesSpanning(dipWindowMm, body.sliceSpacing)
  const gainWindow = filesSpanning(gainWindowMm, body.sliceSpacing)
  const frostSkip = filesSpanning(frostSkipMm, body.sliceSpacing)
  // Every pixel each slice read has that the rule passes, which is what judges it kept or missing
  const totals = new Map<number, Promise<number>>()
  let decoded = 0
  const totalAt = (position: number) => {
    let total = totals.get(position)
    if (!total) {
      decoded++
      total = readFrame(frames[position], position, body, field, root, blanks).then((sums) => sums.total)
      totals.set(position, total)
    }
    return total
  }
  // Reads a run of slices ahead of their judging, a batch at a time
  const prefetch = async (first: number, last: number) => {
    const wanted: number[] = []
    for (let p = Math.max(0, first); p <= Math.min(frames.length - 1, last); p++) if (!totals.has(p)) wanted.push(p)
    for (let n = 0; n < wanted.length; n += batchSize) await Promise.all(wanted.slice(n, n + batchSize).map(totalAt))
  }
  const nonBlank = async (start: number, step: 1 | -1) => {
    const found: number[] = []
    for (let p = start; p >= 0 && p < frames.length && found.length < dipWindow; p += step) {
      const total = await totalAt(p)
      if (total > 0) found.push(total)
    }
    return found
  }
  const isKept = async (position: number) =>
    missingReason(await totalAt(position), await nonBlank(position - 1, -1), await nonBlank(position + 1, 1), dipWindow) === null
  const positionOf = (slice: number) => frames.findIndex((frame) => frame.slice === slice)
  const lastPositionOf = (slice: number) => frames.findLastIndex((frame) => frame.slice === slice)

  // The kept slices of a block from one end, by step, after skipping some
  const keptRun = async (from: number, until: number, step: 1 | -1, skip: number) => {
    const run: number[] = []
    let skipped = 0
    for (let p = from; step > 0 ? p <= until : p >= until; p += step) {
      if (!(await isKept(p))) continue
      if (skipped < skip) skipped++
      else run.push(p)
      if (run.length === gainWindow) return run
    }
    throw new Error(`Only ${run.length} slices kept from ${frames[from].name} for a window of ${gainWindow}`)
  }
  // The window's slices, read again for their cells' sums and their strip, neither kept while the slices are judged
  const readWindow = async (positions: readonly number[]) => {
    const sums = windowSums(field)
    const strips: CardReading[] = []
    const missed: number[] = []
    for (let n = 0; n < positions.length; n += batchSize) {
      const batch = positions.slice(n, n + batchSize)
      decoded += batch.length
      const images = await Promise.all(batch.map((p) => readSlice(frames[p], body, root, blanks)))
      images.forEach((image, m) => {
        if (typeof image === 'string') return
        const slice = sliceSums(frames[batch[m]], batch[m], image, body, field)
        for (let cell = 0; cell < layerCells; cell++) {
          sums.red[cell] += slice.red[cell]
          sums.green[cell] += slice.green[cell]
          sums.blue[cell] += slice.blue[cell]
          sums.body[cell] += slice.body[cell]
          sums.pixels[cell] += cellPixels[cell]
        }
        const strip = readGrayScale(image)
        if (strip) strips.push(strip)
        else missed.push(batch[m])
      })
    }
    // A window with no strip in it has nothing to read the exposure by: the female's strip is out of frame from 1503a
    // on, which the window after her first boundary reaches once it spans 8 mm of her slices
    if (strips.length === 0) {
      if (match === 'card') throw new Error(`No grey strip found in ${positions.map((p) => frames[p].name).join(', ')}`)
      return { sums, card: null }
    }
    const reference = strips.map((strip) => strip.patches[referencePatch])
    const luminances = reference.map(luminanceOf)
    const mean = luminances.reduce((a, b) => a + b, 0) / luminances.length
    const card = {
      reference: meanTriple(reference),
      white: meanTriple(strips.map((strip) => strip.patches[0])),
      whiteClipped: strips.reduce((sum, strip) => sum + strip.whiteClipped, 0) / strips.length,
      pixels: Math.round(strips.reduce((sum, strip) => sum + strip.pixels, 0) / strips.length),
      slices: strips.length,
      spread: (Math.max(...luminances) - Math.min(...luminances)) / mean,
      missed,
    }
    return { sums, card }
  }
  // A piece of the cells both windows hold as body smaller than this many cells is not the body
  const cellMm = level.pixels * body.pixelSize
  const minPieceCells = Math.ceil(minPieceMm2 / (cellMm * cellMm))
  const matched = (before: WindowSums, after: WindowSums) => {
    const both = new Uint8Array(layerCells)
    for (let cell = 0; cell < layerCells; cell++) {
      if (isBodyCell(before.body[cell], before.pixels[cell]) && isBodyCell(after.body[cell], after.pixels[cell])) both[cell] = 1
    }
    return keepPieces(both, field.nx, field.ny, minPieceCells)
  }
  const meanOver = (window: WindowSums, cells: Uint8Array): Triple => {
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    for (let cell = 0; cell < layerCells; cell++) {
      if (cells[cell] === 0) continue
      red += window.red[cell]
      green += window.green[cell]
      blue += window.blue[cell]
      count += window.body[cell]
    }
    return [red / count, green / count, blue / count]
  }

  const rgb = (values: Triple, digits: number) => values.map((value) => value.toFixed(digits)).join(' ')
  const percent = (share: number) => `${(100 * share).toFixed(1)} %`
  const span = (positions: readonly number[]) => `${frameText(body, positions[0])}–${frameText(body, positions[positions.length - 1])}`
  const cardWindows: BoundaryWindows[] = []
  const bodyWindows: BoundaryWindows[] = []
  console.log(`Block boundaries, read on the grey strip's patch ${referencePatch} from its white and on the body:`)
  for (let n = 0; n + 1 < blocks.length; n++) {
    const end = lastPositionOf(blocks[n][1])
    const start = positionOf(blocks[n + 1][0])
    const reach = gainWindow + frostSkip + 2 * dipWindow
    await Promise.all([prefetch(end - reach, end), prefetch(start, start + reach)])
    const before = (await keptRun(end, positionOf(blocks[n][0]), -1, frostSkip)).toReversed()
    const after = await keptRun(start, lastPositionOf(blocks[n + 1][1]), 1, frostSkip)
    const sides = { before: await readWindow(before), after: await readWindow(after) }
    const cells = matched(sides.before.sums, sides.after.sums)
    // A boundary whose strip wasn't found on one side is read as no step by the strip, which only --match card would
    // apply, and that stops the build where the strip is missing
    const [beforeCard, afterCard] = [sides.before.card, sides.after.card]
    const cardWindow = beforeCard && afterCard ? { before: beforeCard.reference, after: afterCard.reference } : { before: unitTriple, after: unitTriple }
    const bodyWindow = { before: meanOver(sides.before.sums, cells), after: meanOver(sides.after.sums, cells) }
    cardWindows.push(cardWindow)
    bodyWindows.push(bodyWindow)
    console.log(`  ${blocks[n][1]}/${blocks[n + 1][0]}: windows ${span(before)} and ${span(after)}`)
    for (const [side, { card }] of [['before', sides.before], ['after', sides.after]] as const) {
      if (!card) {
        console.log(`    strip ${side.padEnd(6)} not found in any slice of the window, so the strip reads no step here`)
        continue
      }
      const suspect = card.spread > suspectSpread ? `, past ${percent(suspectSpread)}: suspect` : ''
      const missed = card.missed.length > 0 ? `; no strip found in ${card.missed.map((p) => frames[p].name).join(', ')}` : ''
      console.log(
        `    strip ${side.padEnd(6)} patch ${referencePatch} ${rgb(card.reference, 1)} over ${card.slices} slices of ` +
          `${card.pixels.toLocaleString('en')} px, spread ${percent(card.spread)}${suspect}; white ${rgb(card.white, 1)}, ` +
          `${percent(card.whiteClipped)} of it at the clip${missed}`,
      )
    }
    console.log(
      `    body over ${cells.reduce((a, b) => a + b, 0).toLocaleString('en')} cells: before ${rgb(bodyWindow.before, 1)}, ` +
        `after ${rgb(bodyWindow.after, 1)}`,
    )
    console.log(`    ratio before/after: strip ${rgb(boundaryRatio(cardWindow), 4)}, body ${rgb(boundaryRatio(bodyWindow), 4)}`)
  }
  const round = (gain: Triple): Triple => [
    Number(gain[0].toFixed(gainDecimals)),
    Number(gain[1].toFixed(gainDecimals)),
    Number(gain[2].toFixed(gainDecimals)),
  ]
  const byCard = blockGains(cardWindows)
  const byBody = blockGains(bodyWindows)
  const applied = match === 'card' ? byCard : match === 'body' ? byBody : null
  const gains = applied ? applied.map(({ gain }) => round(gain)) : unit
  const held = (gain: { clamped: boolean }) => (gain.clamped ? ` (held to ${minGain}–${maxGain})` : '')
  console.log(
    `Gains per block, cumulative, by the strip and by the body (a step within ${percent(deadBand)} on every channel ` +
      `takes none); ${match ? `the ${match === 'card' ? 'strip' : 'body'}'s applied, as --match ${match} asks` : 'none applied, as no --match asks'}:`,
  )
  blocks.forEach(([first, last], n) => {
    console.log(
      `  ${`${first}–${last}`.padEnd(10)} strip ${rgb(round(byCard[n].gain), 4)}${held(byCard[n])}, ` +
        `body ${rgb(round(byBody[n].gain), 4)}${held(byBody[n])}`,
    )
  })
  console.log(`Measured in ${Math.round((performance.now() - started) / 1000)} s from ${decoded} slice decodes`)
  return { blocks, gains }
}

// The gain of a slice's block; a slice between blocks takes the block's before it, and one before every block 1
function gainOfSlice(gains: BlockGains, slice: number): Triple {
  let gain: Triple = [1, 1, 1]
  gains.blocks.forEach(([first], n) => {
    if (first <= slice) gain = gains.gains[n]
  })
  return gain
}

// The field of every layer read: for each cell, whether it's body by the rule, the share of its pixels that are body
// scaled to 255, the mean colour of its body pixels, each slice's scaled by its block's gain, and the density the
// colour stand-in gives that mean as photographed, without the gain, so matching the blocks changes no density; and,
// for a body that fills what it encloses, the mean colour of all its pixels, with the gain. Each
// slice is decided once the non-blank slices within the short rule's window after it are read, and, for a body whose
// blocks' faces are frosted, once the slices its frost is judged by are decided too: a missing one adds nothing to its
// layer (segment.ts), and a layer left with too few slices is filled as a missing one. Memory holds the sums of the
// layer being built and of the slices waiting on those decisions, never the slices themselves
async function readLayers(
  body: Body,
  level: Level,
  field: Field,
  frames: readonly Frame[],
  root: string,
  gains: BlockGains,
) {
  const { layerCells, cellPixels } = field
  const layerOf = (index: number) => Math.floor(index / level.slices)
  const firstLayer = layerOf(frames[0].index)
  const layers = layerOf(frames[frames.length - 1].index) - firstLayer + 1
  const bodyCells = new Uint8Array(layerCells * layers)
  const share = new Uint8Array(layerCells * layers)
  const colors = new Uint8Array(layerCells * layers * 3)
  const colorDensity = new Uint8Array(layerCells * layers)
  const wholeColors = body.fillsEnclosed ? new Uint8Array(layerCells * layers * 3) : null
  // Channels whose mean the gain took past 255, held there
  let saturated = 0
  // Each frame's body pixels, once read, by its position in frames, their mean blue over red, and why it wasn't read
  const counts = new Int32Array(frames.length)
  const blueOverRed = new Float64Array(frames.length)
  const unread: (Unread | null)[] = Array.from({ length: frames.length }, () => null)
  // Each frame's verdict by the blank and short rules, once the slices it's judged by are read: why it's missing, or
  // null where it's kept; undefined until then
  const verdicts: (MissingReason | Unread | null | undefined)[] = Array.from({ length: frames.length }, () => undefined)
  const missing: Record<MissingReason | Unread, number[]> = { blank: [], short: [], frosted: [], absent: [], undecodable: [] }
  const missingLayers = Array.from({ length: layers }, () => false)
  // The layers read as missing for keeping too few of their slices, each with its count kept and read
  const thinLayers: { index: number; kept: number; slices: number }[] = []
  const window = filesSpanning(dipWindowMm, body.sliceSpacing)
  // The frost rule's reach and its references, in files, and the faces of the body's blocks within the slices read,
  // each named by the position of the first file after it: the ends of the slices read aren't faces
  const frost = body.frostedFaces
    ? {
        reach: filesSpanning(frostReachMm, body.sliceSpacing),
        near: filesSpanning(frostReferenceMm[0], body.sliceSpacing),
        far: filesSpanning(frostReferenceMm[1], body.sliceSpacing),
        faces: body.cryoBlocks
          .flatMap(([first, last]) => [first, last + 1].map((slice) => (slice - body.firstSlice) * body.naming.subSlices.length - frames[0].index))
          .filter((face) => face > 0 && face < frames.length),
      }
    : null
  const blanks = unreadableOf(body)
  const pending: SliceSums[] = []
  let read = 0
  const started = performance.now()

  // The layer being built, from the slices kept so far: the colour sums with each slice's gain, then without
  const layer = {
    index: 0,
    kept: 0,
    // Its slices decided so far, kept or not
    slices: 0,
    red: new Float64Array(layerCells),
    green: new Float64Array(layerCells),
    blue: new Float64Array(layerCells),
    rawRed: new Uint32Array(layerCells),
    rawGreen: new Uint32Array(layerCells),
    rawBlue: new Uint32Array(layerCells),
    body: new Uint32Array(layerCells),
    pixels: new Uint32Array(layerCells),
    // Every pixel's channels, summed only for a body that fills what it encloses
    wholeRed: new Float64Array(wholeColors ? layerCells : 0),
    wholeGreen: new Float64Array(wholeColors ? layerCells : 0),
    wholeBlue: new Float64Array(wholeColors ? layerCells : 0),
  }
  const keep = (sums: SliceSums) => {
    const [gr, gg, gb] = gainOfSlice(gains, sums.frame.slice)
    for (let cell = 0; cell < layerCells; cell++) {
      layer.red[cell] += sums.red[cell] * gr
      layer.green[cell] += sums.green[cell] * gg
      layer.blue[cell] += sums.blue[cell] * gb
      layer.rawRed[cell] += sums.red[cell]
      layer.rawGreen[cell] += sums.green[cell]
      layer.rawBlue[cell] += sums.blue[cell]
      layer.body[cell] += sums.body[cell]
      layer.pixels[cell] += cellPixels[cell]
    }
    if (sums.whole) {
      for (let cell = 0; cell < layerCells; cell++) {
        layer.wholeRed[cell] += sums.whole.red[cell] * gr
        layer.wholeGreen[cell] += sums.whole.green[cell] * gg
        layer.wholeBlue[cell] += sums.whole.blue[cell] * gb
      }
    }
    layer.kept++
  }
  const channelMean = (sum: number, count: number) => {
    const mean = Math.round(sum / count)
    if (mean <= 255) return mean
    saturated++
    return 255
  }
  const finishLayer = () => {
    const base = layer.index * layerCells
    missingLayers[layer.index] = layer.kept === 0
    if (frost && layer.kept > 0 && isThinLayer(layer.kept, layer.slices)) {
      missingLayers[layer.index] = true
      thinLayers.push({ index: layer.index, kept: layer.kept, slices: layer.slices })
    }
    for (let cell = 0; cell < layerCells; cell++) {
      const count = layer.body[cell]
      const pixels = layer.pixels[cell]
      if (pixels > 0) share[base + cell] = Math.round((255 * count) / pixels)
      if (isBodyCell(count, pixels)) bodyCells[base + cell] = 1
      if (wholeColors && pixels > 0) {
        wholeColors[(base + cell) * 3] = channelMean(layer.wholeRed[cell], pixels)
        wholeColors[(base + cell) * 3 + 1] = channelMean(layer.wholeGreen[cell], pixels)
        wholeColors[(base + cell) * 3 + 2] = channelMean(layer.wholeBlue[cell], pixels)
      }
      if (count === 0) continue
      colors[(base + cell) * 3] = channelMean(layer.red[cell], count)
      colors[(base + cell) * 3 + 1] = channelMean(layer.green[cell], count)
      colors[(base + cell) * 3 + 2] = channelMean(layer.blue[cell], count)
      colorDensity[base + cell] = densityFromColor(
        Math.round(layer.rawRed[cell] / count),
        Math.round(layer.rawGreen[cell] / count),
        Math.round(layer.rawBlue[cell] / count),
      )
    }
    // Progress every ten layers, and at the last, which stands in for a tenth within ten of it
    if (layer.index === layers - 1 || (layer.index % 10 === 9 && layers - 1 - layer.index >= 10)) {
      const left = ((performance.now() - started) / 1000 / read) * (frames.length - read)
      console.log(
        `Read slices to ${frameText(body, frames[read - 1].index)}: ${read} of ${frames.length}, about ${Math.ceil(left / 60)} min left`,
      )
    }
    for (const sums of [layer.red, layer.green, layer.blue, layer.rawRed, layer.rawGreen, layer.rawBlue, layer.body, layer.pixels]) {
      sums.fill(0)
    }
    for (const sums of [layer.wholeRed, layer.wholeGreen, layer.wholeBlue]) sums.fill(0)
    layer.kept = 0
    layer.slices = 0
    layer.index++
  }

  // The body pixel counts of up to the window's non-blank slices read from start onwards, by step, nearest first
  const nonBlank = (start: number, step: 1 | -1) => {
    const found: number[] = []
    for (let position = start; position >= 0 && position < read && found.length < window; position += step) {
      if (counts[position] > 0) found.push(counts[position])
    }
    return found
  }
  // A frame's verdict by the blank and short rules, once the window after it is read; a slice not read is missing for
  // that reason, and listed by it rather than as blank
  const verdictAt = (position: number) => {
    const known = verdicts[position]
    if (known !== undefined || position >= read) return known
    const after = nonBlank(position + 1, 1)
    if (after.length < window && read < frames.length) return undefined
    const verdict = unread[position] ?? missingReason(counts[position], nonBlank(position - 1, -1), after, window)
    verdicts[position] = verdict
    return verdict
  }
  const isGap = (verdict: MissingReason | Unread | null | undefined) => verdict === 'blank' || verdict === 'short'
  // Whether a kept slice is frosted, by the faces within reach of it, a block's or a run of blank or short slices',
  // and the kept slices on the side away from the nearest; undefined until the slices it's judged by are decided
  const frostAt = (position: number): MissingReason | null | undefined => {
    if (!frost) return null
    const { reach, near, far } = frost
    const faces = [...frost.faces]
    for (let q = position - 1; q >= Math.max(0, position - reach); q--) {
      if (!isGap(verdictAt(q))) continue
      faces.push(q + 1)
      break
    }
    for (let q = position + 1; q <= Math.min(frames.length - 1, position + reach); q++) {
      const verdict = verdictAt(q)
      if (verdict === undefined) return undefined
      if (!isGap(verdict)) continue
      faces.push(q)
      break
    }
    const side = frostSide(position, faces, reach)
    if (side === null) return null
    // Judged only where all of its references lie within the slices read, as a slice is judged short
    if (position + side * far < 0 || position + side * far >= frames.length) return null
    const references: number[] = []
    for (let distance = near; distance <= far; distance++) {
      const q = position + side * distance
      const verdict = verdictAt(q)
      if (verdict === undefined) return undefined
      if (verdict === null) references.push(blueOverRed[q])
    }
    return frostedReason(blueOverRed[position], references)
  }
  const decide = () => {
    while (pending.length > 0) {
      const sums = pending[0]
      const verdict = verdictAt(sums.position)
      if (verdict === undefined) return
      const reason = verdict ?? frostAt(sums.position)
      if (reason === undefined) return
      pending.shift()
      while (layerOf(sums.frame.index) - firstLayer > layer.index) finishLayer()
      layer.slices++
      if (reason) missing[reason].push(sums.frame.index)
      else keep(sums)
    }
  }

  // A few files at a time, never across a layer: the files are summed as they arrive and their pixels let go
  for (let first = 0; first < frames.length; ) {
    const layerEnd = (layerOf(frames[first].index) + 1) * level.slices - 1 - frames[0].index
    const last = Math.min(frames.length - 1, first + batchSize - 1, layerEnd)
    const positions = Array.from({ length: last - first + 1 }, (_, n) => first + n)
    const sums = await Promise.all(positions.map((p) => readFrame(frames[p], p, body, field, root, blanks)))
    for (const each of sums) {
      counts[each.position] = each.total
      blueOverRed[each.position] = each.totalRed > 0 ? each.totalBlue / each.totalRed : 0
      unread[each.position] = each.unread
    }
    pending.push(...sums)
    read = last + 1
    decide()
    first = last + 1
  }
  while (layer.index < layers) finishLayer()

  if (saturated > 0) console.log(`Cell channels the block gains took past 255, held there: ${saturated.toLocaleString('en')}`)
  // A layer made only of missing slices, or keeping too few of its slices, is filled from its nearest read layers, so
  // the body stays one piece, and its colour blended between them
  const layerText = (index: number) => {
    const first = Math.max(frames[0].index, (firstLayer + index) * level.slices)
    const last = Math.min(frames[frames.length - 1].index, (firstLayer + index + 1) * level.slices - 1)
    return `${frameText(body, first)}–${frameText(body, last)}`
  }
  if (missing.blank.length > 0) console.log(`Blank slices, read as missing: ${runsText(body, missing.blank)}`)
  if (missing.short.length > 0) console.log(`Short slices, read as missing: ${runsText(body, missing.short)}`)
  if (missing.frosted.length > 0) console.log(`Frosted slices, read as missing: ${runsText(body, missing.frosted)}`)
  if (missing.absent.length > 0) console.log(`Slices the set lacks, read as missing: ${runsText(body, missing.absent)}`)
  if (missing.undecodable.length > 0) {
    console.log(`Slices that can't be decoded, read as missing: ${runsText(body, missing.undecodable)}`)
  }
  const planes = [bodyCells, share, colors, colorDensity]
  if (wholeColors) planes.push(wholeColors)
  const sources = fillMissingLayers(planes, layerCells, missingLayers, { colors, body: bodyCells })
  sources.forEach((source, index) => {
    if (source === index) return
    const thin = thinLayers.find((each) => each.index === index)
    const lacks = thin ? `keeps only ${thin.kept} of its ${thin.slices} slices` : 'has no slice'
    console.log(
      source < 0
        ? `Layer ${layerText(index)} ${lacks} and nothing to fill it from`
        : `Layer ${layerText(index)} ${lacks}, so its cells are filled from layer ${layerText(source)}`,
    )
  })
  return { firstLayer, layers, body: bodyCells, share, colors, colorDensity, wholeColors }
}
type Grid = Awaited<ReturnType<typeof readLayers>>

// Fills the cells the body encloses, for a body that asks for it: every cell outside the body that no path of such
// cells joins to a face of the field becomes body, in the colour of all its pixels and the density that colour
// suggests. Its share of body pixels stays as the rule counted it, so the coverage of a filled cell is the least a body
// cell stores. Run before the largest piece is kept, so a scrap of body inside a filled hole joins the body through
// it. Logs how many cells it filled and the largest hole left: among the cells a single layer's body encloses but the
// fill left, since they reach a face along the slices, as an airway does, the largest piece
function fillEnclosed(grid: Grid, body: Body, level: Level, field: Field) {
  const { nx, ny, layerCells } = field
  const { layers, wholeColors } = grid
  if (!wholeColors) throw new Error(`The ${body.id}'s layers were read without every pixel's colour, which a filled cell takes`)
  const enclosed = enclosedCells(grid.body, nx, ny, layers)
  for (let cell = 0; cell < enclosed.cells.length; cell++) {
    if (enclosed.cells[cell] === 0) continue
    grid.body[cell] = 1
    const r = wholeColors[cell * 3]
    const g = wholeColors[cell * 3 + 1]
    const b = wholeColors[cell * 3 + 2]
    grid.colors[cell * 3] = r
    grid.colors[cell * 3 + 1] = g
    grid.colors[cell * 3 + 2] = b
    grid.colorDensity[cell] = densityFromColor(r, g, b)
  }
  const left = new Uint8Array(grid.body.length)
  let leftCells = 0
  for (let k = 0; k < layers; k++) {
    const inLayer = enclosedCells(grid.body.subarray(k * layerCells, (k + 1) * layerCells), nx, ny, 1)
    left.set(inLayer.cells, k * layerCells)
    leftCells += inLayer.size
  }
  const largest = largestPiece(left, nx, ny, layers)
  const count = (value: number) => value.toLocaleString('en')
  let hole = 'no layer encloses a cell the fill left'
  if (largest.size > 0) {
    const low = [nx, ny, layers]
    const high = [-1, -1, -1]
    largest.cells.forEach((kept, cell) => {
      if (kept === 0) return
      const at = [cell % nx, Math.floor(cell / nx) % ny, Math.floor(cell / layerCells)]
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], at[axis])
        high[axis] = Math.max(high[axis], at[axis])
      }
    })
    const lastIndex = lastFrame(body)
    const sliceAt = (index: number) => frameText(body, Math.min(lastIndex, index))
    hole =
      `the layers enclose ${count(leftCells)} cells it left, which reach a face along the slices; the largest hole among them is ` +
      `${count(largest.size)} cells, columns ${low[0]}–${high[0]}, rows ${low[1]}–${high[1]}, slices ` +
      `${sliceAt((grid.firstLayer + low[2]) * level.slices)}–${sliceAt((grid.firstLayer + high[2] + 1) * level.slices - 1)}`
  }
  console.log(`Filled ${count(enclosed.size)} cells the body encloses; ${hole}`)
}

// The CT's density for each cell of the field, where the registration covers it: per layer, the CT slice of each of
// the layer's slices from A to B is read and sampled through its segment's inverse similarity at points spread over
// the cell, as many across as the cell holds CT pixels, each bilinearly; the cell's density is the mean over its points
// and its slices. A cell is covered when at least half its points, over those slices, fell inside the CT's
// reconstruction circle. Returns the density per cell and which cells are covered, in the field's layout, and logs how
// many CT slices it read. A slice the registration covers needs its CT file, as every slice needs its colour file: a
// missing one stops the build, and --no-ct builds without the CT
async function readCtDensity(
  body: Body,
  level: Level,
  field: Field,
  grid: Grid,
  registration: Registration,
  [from, to]: readonly [number, number],
  root: string,
) {
  const { nx, layerCells } = field
  const { layers, firstLayer } = grid
  const density = new Uint8Array(layerCells * layers)
  const covered = new Uint8Array(layerCells * layers)
  const sum = new Float64Array(layerCells)
  const inside = new Uint32Array(layerCells)
  const points = new Uint32Array(layerCells)
  const subs = body.naming.subSlices.length
  let slicesRead = 0
  let slicesWithoutCt = 0
  const started = performance.now()
  const cellMm = level.pixels * body.pixelSize

  for (let layer = 0; layer < layers; layer++) {
    sum.fill(0)
    inside.fill(0)
    points.fill(0)
    const base = layer * layerCells
    // The slice numbers of the layer's frames within the range read, each once
    const firstFrame = (firstLayer + layer) * level.slices
    const slices = new Set<number>()
    for (let frame = firstFrame; frame < firstFrame + level.slices; frame++) {
      const slice = body.firstSlice + Math.floor(frame / subs)
      if (slice >= from && slice <= to) slices.add(slice)
    }
    for (const slice of slices) {
      const segment = segmentOf(registration, slice)
      if (!segment) {
        slicesWithoutCt++
        continue
      }
      const path = await requireDataFile(root, body.ct!.set, ctFileName(body, 'image', slice))
      const image = await readGray(path)
      slicesRead++
      const { width, height, data } = image
      if (width !== segment.ctSize[0] || height !== segment.ctSize[1]) {
        throw new Error(`${path} is ${width} × ${height}, not the ${segment.ctSize.join(' × ')} its segment was fitted on`)
      }
      const size = [width, height] as const
      const centre = [(segment.ctSize[0] - 1) / 2, (segment.ctSize[1] - 1) / 2] as const
      const toCt: Affine = invert(ctToCryo(segment, centre))
      // Sample points per cell side, so the points sit about a CT pixel apart
      const across = Math.max(1, Math.ceil(cellMm / segment.ctPixelMm))
      const bilinear = (u: number, v: number) => {
        const u0 = Math.floor(u)
        const v0 = Math.floor(v)
        const fu = u - u0
        const fv = v - v0
        const u1 = Math.min(u0 + 1, width - 1)
        const v1 = Math.min(v0 + 1, height - 1)
        const row0 = v0 * width
        const row1 = v1 * width
        const top = data[row0 + u0] * (1 - fu) + data[row0 + u1] * fu
        const bottom = data[row1 + u0] * (1 - fu) + data[row1 + u1] * fu
        return densityFromCt(top * (1 - fv) + bottom * fv)
      }
      for (let cell = 0; cell < layerCells; cell++) {
        // Only cells with body pixels get a density; the rest stay outside the body
        if (grid.share[base + cell] === 0) continue
        const column = cell % nx
        const row = (cell - column) / nx
        for (let sy = 0; sy < across; sy++) {
          const y = (row + (sy + 0.5) / across) * level.pixels - 0.5
          for (let sx = 0; sx < across; sx++) {
            const x = (column + (sx + 0.5) / across) * level.pixels - 0.5
            const [u, v] = apply(toCt, [x, y])
            points[cell]++
            if (!insideCtField(u, v, size)) continue
            inside[cell]++
            sum[cell] += bilinear(u, v)
          }
        }
      }
    }
    for (let cell = 0; cell < layerCells; cell++) {
      if (points[cell] === 0 || inside[cell] * 2 < points[cell]) continue
      covered[base + cell] = 1
      density[base + cell] = Math.round(sum[cell] / inside[cell])
    }
  }
  const seconds = Math.round((performance.now() - started) / 1000)
  console.log(`CT slices read: ${slicesRead}, slices without CT: ${slicesWithoutCt}, in ${seconds} s`)
  return { density, covered }
}
type CtDensity = Awaited<ReturnType<typeof readCtDensity>>

// A CT's density and an MRI's values for each cell of the field, for a body whose scans are whole grids, as
// data/<body>/registration.json places them: each cell with body pixels is sampled at points spread through it, as
// many each way as it holds of the scan's voxels, each between the scan's voxels, and takes the mean of the points
// that fall on the scan. A point of the CT falls on it only where none of the voxels it's read from is the padding
// outside the reconstruction circle, so a cell at the circle's edge takes its density from its points inside it. The
// CT's values go through the body's scale to Hounsfield units and then onto the density scale; a cell is covered by
// a scan when at least half its points fall on it. The MRI's means are kept as they are, for the crop to spread over
// the scale once it knows which cells are body
async function readScans(body: Body, level: Level, field: Field, grid: Grid, registration: ScanRegistration, root: string) {
  const { scans } = body
  if (!scans) throw new Error(`The ${body.id} has no whole scans`)
  const started = performance.now()
  const cat = await readDicomSeries(root, scans.ct.set)
  const mri = await readDicomSeries(root, scans.mri.set)
  for (const [name, scan, saved] of [['CAT', cat, registration.cat], ['MRI', mri, registration.mri]] as const) {
    if (scan.frameUID !== saved.frameUID || scan.size.some((value, n) => value !== saved.size[n])) {
      throw new Error(`The ${name} in the data root isn't the one ${registrationPath(body.id)} was fitted on; npm run register -- --body ${body.id} fits it again`)
    }
  }
  const scale = registration.cat.hounsfieldScale
  const toCat = invertRigid(catToCryoMap(registration))
  const toMri = compose(invertRigid(mriToCatMap(registration)), toCat)
  const { nx, layerCells } = field
  const { layers, firstLayer } = grid
  const density = new Uint8Array(layerCells * layers)
  const covered = new Uint8Array(layerCells * layers)
  // The MRI's mean in each cell, or −1 where it doesn't cover the cell
  const mriMeans = new Float32Array(layerCells * layers).fill(-1)
  const cellMm: Triple = [level.pixels * body.pixelSize, level.pixels * body.pixelSize, level.slices * body.sliceSpacing]
  // Under the mirrored hand the photographs' columns are mirrored about the grid's centre before the transform
  const mirrorAbout = registration.hand === 'mirrored' ? registration.catToCryo.cryoCentreMm[0] : null
  // The CT's padding outside its reconstruction circle: the head's CAT holds −1200 there, −2400 Hounsfield units,
  // where the air beside the head reads −750 at the least, −1500 units, so the line between them is drawn at −2000
  const padding = paddingBelowHu / scale

  const sampleCells = (scan: DicomVolume, toScan: RigidMap, floor: number, take: (cell: number, mean: number) => void) => {
    const { rows, offset } = indexMap(scan, toScan)
    const across = cellMm.map((mm) => Math.max(1, Math.ceil(mm / Math.min(...scan.spacing))))
    const points = across[0] * across[1] * across[2]
    for (let layer = 0; layer < layers; layer++) {
      const z0 = (firstLayer + layer) * cellMm[2] - body.sliceSpacing / 2
      for (let cell = 0; cell < layerCells; cell++) {
        const index = layer * layerCells + cell
        // Only cells with body pixels are sampled; the rest stay outside the body
        if (grid.share[index] === 0 && grid.body[index] === 0) continue
        const column = cell % nx
        const row = (cell - column) / nx
        const x0 = column * cellMm[0] - body.pixelSize / 2
        const y0 = row * cellMm[1] - body.pixelSize / 2
        let sum = 0
        let inside = 0
        for (let sz = 0; sz < across[2]; sz++) {
          const z = z0 + ((sz + 0.5) / across[2]) * cellMm[2]
          for (let sy = 0; sy < across[1]; sy++) {
            const y = y0 + ((sy + 0.5) / across[1]) * cellMm[1]
            for (let sx = 0; sx < across[0]; sx++) {
              const along = x0 + ((sx + 0.5) / across[0]) * cellMm[0]
              const x = mirrorAbout === null ? along : 2 * mirrorAbout - along
              const value = sampleIndex(
                scan,
                rows[0][0] * x + rows[0][1] * y + rows[0][2] * z + offset[0],
                rows[1][0] * x + rows[1][1] * y + rows[1][2] * z + offset[1],
                rows[2][0] * x + rows[2][1] * y + rows[2][2] * z + offset[2],
                floor,
              )
              if (Number.isNaN(value)) continue
              sum += value
              inside++
            }
          }
        }
        if (inside * 2 >= points) take(index, sum / inside)
      }
    }
  }
  sampleCells(cat, toCat, padding, (cell, mean) => {
    covered[cell] = 1
    density[cell] = Math.max(0, Math.min(255, Math.round((mean * scale + 1000) / 16)))
  })
  sampleCells(mri, toMri, -Infinity, (cell, mean) => {
    mriMeans[cell] = mean
  })
  const seconds = Math.round((performance.now() - started) / 1000)
  console.log(
    `Resampled the CAT (${cat.size.join(' × ')}, its values × ${scale} as Hounsfield units) and the MRI (${mri.size.join(' × ')}) ` +
      `through ${registrationPath(body.id)}, fitted ${registration.fitted}, ${registration.hand} hand, in ${seconds} s`,
  )
  return { ct: { density, covered }, mriMeans }
}

// Below this many Hounsfield units a CT's value is the padding outside its reconstruction circle, not tissue or air
const paddingBelowHu = -2000

// The MRI's values in a body's voxels spread over 1 to 255: the value below which this share of them lie becomes 1,
// the value above which the same share lie becomes 255, and the values between run evenly, so the few brightest
// voxels don't flatten the rest
const mriTail = 0.01

// Keeps the largest piece of body and crops the field to its bounds plus a one-voxel margin on every face, which
// gives the colour room to spread one voxel past the skin. Coverage carries the body decision: a body cell in the
// piece stores at least 128, a body cell outside it 0, a non-body cell at most 127. Density is written where the body
// is: the CT's where it covers the cell, else the colour's, never 0, which means outside the body. Where the body has
// an MRI, its block is written where the body is too: 1 to 255 where the MRI covers the voxel, 0 where it doesn't
function cropToBody(
  grid: Grid,
  body: Body,
  level: Level,
  field: Field,
  from: number,
  to: number,
  ct: CtDensity | null,
  mriMeans: Float32Array | null,
) {
  const { nx, ny } = field
  const { layers } = grid
  const { cells: kept, size: bodyCount } = largestPiece(grid.body, nx, ny, layers)
  if (bodyCount === 0) throw new Error(`No body found in slices ${from} to ${to}`)
  const low = [nx, ny, layers]
  const high = [-1, -1, -1]
  for (let k = 0; k < layers; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (kept[i + nx * (j + ny * k)] === 0) continue
        const at = [i, j, k]
        for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis], at[axis])
          high[axis] = Math.max(high[axis], at[axis])
        }
      }
    }
  }

  // The grid's first voxel in the field, one before the body's bounds, which may be outside the field: nothing is there
  const first = low.map((value) => value - 1)
  const size: Triple = [high[0] - low[0] + 3, high[1] - low[1] + 3, high[2] - low[2] + 3]
  const cells = size[0] * size[1] * size[2]
  const red = new Uint8Array(cells)
  const green = new Uint8Array(cells)
  const blue = new Uint8Array(cells)
  const coverage = new Uint8Array(cells)
  const density = new Uint8Array(cells)
  // The MRI's mean in each body voxel it covers, −1 elsewhere, until the crop knows them all
  const mriRaw = mriMeans ? new Float32Array(cells).fill(-1) : null
  const inField = (fi: number, fj: number, fk: number) =>
    fi >= 0 && fi < nx && fj >= 0 && fj < ny && fk >= 0 && fk < layers
  const fieldIndex = (fi: number, fj: number, fk: number) => fi + nx * (fj + ny * fk)
  let fromCt = 0
  let fromColor = 0

  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const fi = first[0] + i
        const fj = first[1] + j
        const fk = first[2] + k
        const index = cellIndex(size, i, j, k)
        const inside = inField(fi, fj, fk)
        const source = inside ? fieldIndex(fi, fj, fk) : -1
        if (inside && kept[source] !== 0) {
          coverage[index] = Math.max(bodyCoverage, grid.share[source])
          red[index] = grid.colors[source * 3]
          green[index] = grid.colors[source * 3 + 1]
          blue[index] = grid.colors[source * 3 + 2]
          if (mriRaw && mriMeans) mriRaw[index] = mriMeans[source]
          if (ct && ct.covered[source] !== 0) {
            density[index] = Math.max(1, ct.density[source])
            fromCt++
          } else {
            // The stand-in reads the cell's mean colour. Reading it per pixel and averaging was measured and left out:
            // under the registered CT's bone the photographs' pixels have a saturation of 0.35–0.41 against the
            // stand-in's unsaturated limit of 0.3, so they read as soft tissue pixel by pixel too, and the cell mean
            // loses nothing
            density[index] = grid.colorDensity[source]
            fromColor++
          }
          continue
        }
        if (inside) coverage[index] = grid.body[source] !== 0 ? 0 : Math.min(bodyCoverage - 1, grid.share[source])
        // Outside the body the colour is its body neighbours' mean, so a sample at the skin blends into tissue, not black
        let count = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dk = -1; dk <= 1; dk++) {
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!inField(fi + di, fj + dj, fk + dk)) continue
              const neighbour = fieldIndex(fi + di, fj + dj, fk + dk)
              if (kept[neighbour] === 0) continue
              r += grid.colors[neighbour * 3]
              g += grid.colors[neighbour * 3 + 1]
              b += grid.colors[neighbour * 3 + 2]
              count++
            }
          }
        }
        if (count === 0) continue
        red[index] = Math.round(r / count)
        green[index] = Math.round(g / count)
        blue[index] = Math.round(b / count)
      }
    }
  }

  // The slices of the layers that hold body, within the range read
  const subs = body.naming.subSlices.length
  const sliceOf = (index: number) => body.firstSlice + Math.floor(index / subs)
  const firstSlice = Math.max(from, sliceOf((grid.firstLayer + low[2]) * level.slices))
  const lastSlice = Math.min(to, sliceOf((grid.firstLayer + high[2] + 1) * level.slices - 1))
  // The centre of the first voxel: cell column c spans pixels c·p to c·p + p − 1, and layer l slices l·s to l·s + s − 1,
  // counted from the body's first slice
  const { pixels: p, slices: s } = level
  const fieldFirst: Triple = [first[0], first[1], grid.firstLayer + first[2]]
  const origin: Triple = [
    (fieldFirst[0] * p + (p - 1) / 2) * body.pixelSize,
    (fieldFirst[1] * p + (p - 1) / 2) * body.pixelSize,
    (fieldFirst[2] * s + (s - 1) / 2) * body.sliceSpacing,
  ]
  // The MRI's block, from its means in the body's voxels
  let mri: Uint8Array | undefined
  let mriRange: { voxels: number; low: number; high: number } | null = null
  if (mriRaw) {
    const values = Array.from(mriRaw.filter((value) => value >= 0)).sort((a, b) => a - b)
    mri = new Uint8Array(cells)
    if (values.length > 0) {
      const dimmest = values[Math.floor(mriTail * (values.length - 1))]
      const brightest = Math.max(dimmest + 1, values[Math.floor((1 - mriTail) * (values.length - 1))])
      mriRange = { voxels: values.length, low: dimmest, high: brightest }
      for (let index = 0; index < cells; index++) {
        if (mriRaw[index] < 0) continue
        mri[index] = 1 + Math.round(254 * Math.max(0, Math.min(1, (mriRaw[index] - dimmest) / (brightest - dimmest))))
      }
    }
  }
  const volume: Volume = {
    size,
    spacing: [p * body.pixelSize, p * body.pixelSize, s * body.sliceSpacing],
    origin,
    firstSlice,
    lastSlice,
    axes: body.axes,
    body: body.id,
    red,
    green,
    blue,
    coverage,
    density,
  }
  if (mri) volume.mri = mri
  return { volume, fieldFirst, fromCt, fromColor, mriRange }
}

const mm = (value: number) => Number(value.toFixed(3)).toString()

// The folder the page loads its files from, and the list of bodies and levels there
const pageFolder = resolve('public')
const volumeFolder = resolve(pageFolder, 'volume')
const bodiesPath = resolve(volumeFolder, 'bodies.json')

const levelId = (level: Level) => `${level.spacing}mm`
const levelFile = (body: Body, level: Level) => `volume/${body.id}-${level.spacing}mm.bin`

// Millimetres to a ten-thousandth, which drops the 32-bit floats' and the products' noise, as 3.9600000381 for 3.96
const rounded = ([a, b, c]: Triple): Triple => [Number(a.toFixed(4)), Number(b.toFixed(4)), Number(c.toFixed(4))]

// A level's entry before it has been built: its name, its file and its nominal spacing
function levelEntry(body: Body, level: Level): LevelEntry {
  const entry: LevelEntry = {
    id: levelId(level),
    label: `${level.spacing} mm`,
    file: levelFile(body, level),
    spacing: rounded([level.pixels * body.pixelSize, level.pixels * body.pixelSize, level.slices * body.sliceSpacing]),
  }
  if (level.default) entry.default = true
  else entry.optional = true
  return entry
}

// Records a file just written into public/volume/ in bodies.json, measured, beside the body's other levels as they
// were last built; a file written anywhere else is left out, as it isn't one the page loads
async function recordLevel(
  out: string,
  body: Body,
  level: Level,
  volume: Volume,
  bytes: number,
  fromCt: boolean,
  gains: BlockGains,
) {
  const path = resolve(out)
  if (relative(volumeFolder, path) !== basename(path)) return null
  let listed: BodiesFile | null = null
  try {
    listed = readBodies(JSON.parse(await readFile(bodiesPath, 'utf8')))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const entry: BodyEntry = {
    id: body.id,
    label: body.label,
    credit: body.credit,
    levels: body.levels.map((each) => levelEntry(body, each)),
  }
  const built: LevelEntry = {
    ...levelEntry(body, level),
    file: relative(pageFolder, path).split('\\').join('/'),
    spacing: rounded(volume.spacing),
    size: volume.size,
    bytes,
    textureBytes: volume.size[0] * volume.size[1] * volume.size[2] * 4,
    density: fromCt ? 'ct' : 'colour',
  }
  built.blockGains = gains.blocks.map(([first, last], n): BlockGainEntry => ({ slices: [first, last], gain: gains.gains[n] }))
  await writeWhole(bodiesPath, new TextEncoder().encode(`${JSON.stringify(withLevel(listed, entry, built), null, 2)}\n`))
  return bodiesPath
}

async function main() {
  const chosen = options()
  if (chosen.sheet) {
    for (const line of (await drawContactSheet(chosen.body, chosen.root)).lines) console.log(line)
    return
  }
  const { body, level, frames: range, from, to, out, rangedOut, previews, noCt, match, root } = chosen
  const started = performance.now()
  if (rangedOut) console.log(`A range of slices is written to ${out}, not into public/volume/, unless --out says where`)
  if (previews) {
    for (const path of await drawPreviews(readVolume(await gunzipFile(out)))) console.log(`Preview: ${path}`)
    return
  }

  const field = fieldOf(body, level)
  const frames = framesOf(body, range[0], range[1])
  const gains = await measureBlocks(body, level, field, to, root, match)
  console.log(`Reading the ${body.id}'s slices ${frameText(body, range[0])} to ${frameText(body, range[1])} from ${setFolder(root, body.set)} at ${level.spacing} mm`)
  const grid = await readLayers(body, level, field, frames, root, gains)
  if (body.fillsEnclosed) fillEnclosed(grid, body, level, field)
  let ct: CtDensity | null = null
  let mriMeans: Float32Array | null = null
  if (noCt) console.log('Density from the colour alone, as --no-ct asks')
  else if (body.scans) {
    const registration = await loadScanRegistration(body.id)
    if (registration) {
      const scans = await readScans(body, level, field, grid, registration, root)
      ct = scans.ct
      mriMeans = scans.mriMeans
    } else {
      console.log(`Density from the colour alone, and no MRI: no ${registrationPath(body.id)}; npm run register -- --body ${body.id} fits one`)
    }
  } else if (!body.ct) console.log(`Density from the colour alone: the ${body.id} has no CT set`)
  else {
    const registration = await loadRegistration(body.id)
    if (registration) {
      console.log(`Resampling the CT through ${registrationPath(body.id)}, fitted ${registration.fitted}`)
      ct = await readCtDensity(body, level, field, grid, registration, [from, to], root)
    } else {
      console.log(`Density from the colour alone: no ${registrationPath(body.id)}; npm run register -- --body ${body.id} fits one`)
    }
  }
  const { volume, fieldFirst, fromCt, fromColor, mriRange } = cropToBody(grid, body, level, field, from, to, ct, mriMeans)
  const raw = writeVolume(volume)
  await writeWhole(out, gzipSync(raw, { level: 9 }))
  for (const path of await drawPreviews(volume)) console.log(`Preview: ${path}`)

  const { size } = await stat(out)
  // A range the CT doesn't reach, such as the crown's first slices alone, is recorded as the colour's
  const listed = await recordLevel(out, body, level, volume, size, fromCt > 0, gains)
  if (listed) console.log(`Recorded the ${level.spacing} mm level in ${relative(process.cwd(), listed)}`)
  const seconds = (performance.now() - started) / 1000
  const cells = volume.size[0] * volume.size[1] * volume.size[2]
  const unread = frames.filter((frame) => frame.absent).length
  console.log(
    `Slices read: ${frames.length - unread} (${frameText(body, range[0])} to ${frameText(body, range[1])}` +
      `${unread > 0 ? `, less ${unread} the set lacks` : ''})`,
  )
  console.log(
    `Grid: ${volume.size.join(' × ')} voxels at ${volume.spacing.map(mm).join(' × ')} mm, the body and a one-voxel margin, ` +
      `from cell ${fieldFirst.join(', ')} of the ${field.nx} × ${field.ny} × ${grid.layers} field; ` +
      `origin ${volume.origin.map(mm).join(', ')} mm; slices ${volume.firstSlice} to ${volume.lastSlice}`,
  )
  console.log(`Body voxels: ${countBody(volume.coverage).toLocaleString('en')} of ${cells.toLocaleString('en')}`)
  console.log(
    `Density from the CT: ${fromCt.toLocaleString('en')} voxels (${((100 * fromCt) / (fromCt + fromColor)).toFixed(1)} %), ` +
      `from the colour: ${fromColor.toLocaleString('en')}`,
  )
  if (mriRange) {
    console.log(
      `MRI: ${mriRange.voxels.toLocaleString('en')} body voxels covered (${((100 * mriRange.voxels) / (fromCt + fromColor)).toFixed(1)} %), ` +
        `its values ${mriRange.low.toFixed(0)} to ${mriRange.high.toFixed(0)} spread over 1 to 255`,
    )
  }
  console.log(`Wrote ${out}: ${(size / 1e6).toFixed(2)} MB, gzipped from ${(raw.length / 1e6).toFixed(1)} MB`)
  console.log(`Took ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
