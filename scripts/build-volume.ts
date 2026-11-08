// The volume script: reads a body's colour slices from the data root and writes the gzipped volume file the app
// loads, with previews in .cache/preview/. Run by `npm run volume`, on Node's own TypeScript.
//
//   --body ID          which body: male (the female and the head arrive with their milestones)
//   --spacing MM       which level, by its voxels' spacing in millimetres: the male's are 4 and 2
//   --out PATH         write the file there rather than public/volume/<body>-<spacing>mm.bin
//   --from A, --to B   read only slices A to B (by default every slice of the body)
//   --previews         redraw the previews from the existing file, reading no slice
//   --data PATH        the data root, else VHP_DATA, else ~/Data/VisibleHuman

import { stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { densityFromColor } from '../src/volume/density.ts'
import { bodyCoverage, cellIndex, countBody, readVolume, writeVolume, type Triple, type Volume } from '../src/volume/format2.ts'
import {
  dipWindow,
  fillMissingLayers,
  isBodyCell,
  isBodyPixel,
  largestPiece,
  missingReason,
  type MissingReason,
} from '../src/volume/segment.ts'
import { bodyOf, fileName, levelOf, type Body, type Level } from './lib/bodies.ts'
import { dataRoot, requireDataFile, setFolder } from './lib/data.ts'
import { gunzipFile, readRgb, type RawImage } from './lib/decode.ts'
import { writeWhole } from './lib/files.ts'
import { drawPreviews } from './lib/previews.ts'

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
      data: { type: 'string' },
    },
    strict: true,
  })
  if (values.body === undefined || values.spacing === undefined) {
    throw new Error('--body and --spacing say what to build, as in --body male --spacing 4')
  }
  const body = bodyOf(values.body)
  const spacing = Number(values.spacing)
  if (!(spacing > 0)) throw new Error(`--spacing takes millimetres, not ${values.spacing}`)
  const level = levelOf(body, spacing)
  const slice = (text: string | undefined, fallback: number, name: string) => {
    if (text === undefined) return fallback
    const value = Number(text)
    if (!Number.isInteger(value) || value < body.firstSlice || value > body.lastSlice) {
      throw new Error(`--${name} takes a slice number from ${body.firstSlice} to ${body.lastSlice}, not ${text}`)
    }
    return value
  }
  const from = slice(values.from, body.firstSlice, 'from')
  const to = slice(values.to, body.lastSlice, 'to')
  if (from > to) throw new Error(`--from ${from} comes after --to ${to}`)
  const out = values.out ?? `public/volume/${body.id}-${spacing}mm.bin`
  return { body, level, from, to, out, previews: values.previews, root: dataRoot(values.data) }
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

// One file of the body: its index in the body's sequence of files from the first slice, which layers are counted
// from, whatever --from says, so a range builds the same layers as the whole; the slice number it belongs to; its name
interface Frame {
  index: number
  slice: number
  name: string
}

function framesOf(body: Body, from: number, to: number): Frame[] {
  const subs = body.naming.subSlices
  const frames: Frame[] = []
  for (let slice = from; slice <= to; slice++) {
    subs.forEach((sub, n) => {
      frames.push({ index: (slice - body.firstSlice) * subs.length + n, slice, name: fileName(body, slice, sub) })
    })
  }
  return frames
}

// A frame's name in the logs: its slice number, and its sub-slice letter where the body has them
function frameText(body: Body, index: number) {
  const subs = body.naming.subSlices
  return `${body.firstSlice + Math.floor(index / subs.length)}${subs[index % subs.length]}`
}

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

// One slice's sums: for each cell, its body pixels' channels and their count; and the slice's body pixels in all.
// The slice's pixels aren't kept, only these. The stride through the pixels is the image's channel count
function sliceSums(frame: Frame, position: number, image: RawImage, body: Body, field: Field) {
  const { layerCells, cellColumn, cellRowStart } = field
  const red = new Uint32Array(layerCells)
  const green = new Uint32Array(layerCells)
  const blue = new Uint32Array(layerCells)
  const bodyPixels = new Uint16Array(layerCells)
  const isBody = body.segmentRule ?? isBodyPixel
  const { data, channels } = image
  let total = 0
  for (let y = 0; y < body.height; y++) {
    const rowStart = cellRowStart[y]
    let offset = y * body.width * channels
    for (let x = 0; x < body.width; x++, offset += channels) {
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      if (!isBody(r, g, b)) continue
      const cell = rowStart + cellColumn[x]
      red[cell] += r
      green[cell] += g
      blue[cell] += b
      bodyPixels[cell]++
      total++
    }
  }
  return { frame, position, red, green, blue, body: bodyPixels, total }
}
type SliceSums = ReturnType<typeof sliceSums>

// The sums of a slice with nothing in it
const emptySums = (frame: Frame, position: number, field: Field): SliceSums => ({
  frame,
  position,
  red: new Uint32Array(field.layerCells),
  green: new Uint32Array(field.layerCells),
  blue: new Uint32Array(field.layerCells),
  body: new Uint16Array(field.layerCells),
  total: 0,
})

// A slice's sums, read from its file in the data root. A file that can't be decoded stops the build, unless the body
// lists it as blank, when it's read as one
async function readFrame(frame: Frame, position: number, body: Body, field: Field, root: string, blanks: ReadonlySet<string>) {
  const path = await requireDataFile(root, body.set, frame.name)
  let image: RawImage
  try {
    image = await readRgb(path)
  } catch (error) {
    if (!blanks.has(frame.name)) throw new Error(`${path} can't be decoded: ${String(error)}`, { cause: error })
    return emptySums(frame, position, field)
  }
  if (image.width !== body.width || image.height !== body.height) {
    throw new Error(`${path} is ${image.width} × ${image.height}, not ${body.width} × ${body.height}`)
  }
  return sliceSums(frame, position, image, body, field)
}

// The field of every layer read: for each cell, whether it's body by the rule, the share of its pixels that are body
// scaled to 255, and the mean colour of its body pixels. Each slice is decided once the dipWindow non-blank slices
// after it are read: a missing one adds nothing to its layer (segment.ts). Memory holds the sums of the layer being
// built and of the slices waiting on that decision, never the slices themselves
async function readLayers(body: Body, level: Level, field: Field, frames: readonly Frame[], root: string) {
  const { layerCells, cellPixels } = field
  const layerOf = (index: number) => Math.floor(index / level.slices)
  const firstLayer = layerOf(frames[0].index)
  const layers = layerOf(frames[frames.length - 1].index) - firstLayer + 1
  const bodyCells = new Uint8Array(layerCells * layers)
  const share = new Uint8Array(layerCells * layers)
  const colors = new Uint8Array(layerCells * layers * 3)
  // Each frame's body pixels, once read, by its position in frames
  const counts = new Int32Array(frames.length)
  const missing: Record<MissingReason, number[]> = { blank: [], short: [] }
  const missingLayers = Array.from({ length: layers }, () => false)
  const blanks = new Set(body.blankFiles)
  const pending: SliceSums[] = []
  let read = 0
  const started = performance.now()

  // The layer being built, from the slices kept so far
  const layer = {
    index: 0,
    kept: 0,
    red: new Uint32Array(layerCells),
    green: new Uint32Array(layerCells),
    blue: new Uint32Array(layerCells),
    body: new Uint32Array(layerCells),
    pixels: new Uint32Array(layerCells),
  }
  const keep = (sums: SliceSums) => {
    for (let cell = 0; cell < layerCells; cell++) {
      layer.red[cell] += sums.red[cell]
      layer.green[cell] += sums.green[cell]
      layer.blue[cell] += sums.blue[cell]
      layer.body[cell] += sums.body[cell]
      layer.pixels[cell] += cellPixels[cell]
    }
    layer.kept++
  }
  const finishLayer = () => {
    const base = layer.index * layerCells
    missingLayers[layer.index] = layer.kept === 0
    for (let cell = 0; cell < layerCells; cell++) {
      const count = layer.body[cell]
      const pixels = layer.pixels[cell]
      if (pixels > 0) share[base + cell] = Math.round((255 * count) / pixels)
      if (isBodyCell(count, pixels)) bodyCells[base + cell] = 1
      if (count === 0) continue
      colors[(base + cell) * 3] = Math.round(layer.red[cell] / count)
      colors[(base + cell) * 3 + 1] = Math.round(layer.green[cell] / count)
      colors[(base + cell) * 3 + 2] = Math.round(layer.blue[cell] / count)
    }
    // Progress every ten layers, and at the last, which stands in for a tenth within ten of it
    if (layer.index === layers - 1 || (layer.index % 10 === 9 && layers - 1 - layer.index >= 10)) {
      const left = ((performance.now() - started) / 1000 / read) * (frames.length - read)
      console.log(
        `Read slices to ${frameText(body, frames[read - 1].index)}: ${read} of ${frames.length}, about ${Math.ceil(left / 60)} min left`,
      )
    }
    for (const sums of [layer.red, layer.green, layer.blue, layer.body, layer.pixels]) sums.fill(0)
    layer.kept = 0
    layer.index++
  }

  // The body pixel counts of up to dipWindow non-blank slices read from start onwards, by step, nearest first
  const nonBlank = (start: number, step: 1 | -1) => {
    const found: number[] = []
    for (let position = start; position >= 0 && position < read && found.length < dipWindow; position += step) {
      if (counts[position] > 0) found.push(counts[position])
    }
    return found
  }
  const decide = () => {
    while (pending.length > 0) {
      const sums = pending[0]
      const after = nonBlank(sums.position + 1, 1)
      if (after.length < dipWindow && read < frames.length) return
      pending.shift()
      while (layerOf(sums.frame.index) - firstLayer > layer.index) finishLayer()
      const reason = missingReason(sums.total, nonBlank(sums.position - 1, -1), after)
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
    for (const each of sums) counts[each.position] = each.total
    pending.push(...sums)
    read = last + 1
    decide()
    first = last + 1
  }
  while (layer.index < layers) finishLayer()

  // A layer made only of missing slices is filled from its nearest read layers, so the body stays one piece
  const layerText = (index: number) => {
    const first = Math.max(frames[0].index, (firstLayer + index) * level.slices)
    const last = Math.min(frames[frames.length - 1].index, (firstLayer + index + 1) * level.slices - 1)
    return `${frameText(body, first)}–${frameText(body, last)}`
  }
  if (missing.blank.length > 0) console.log(`Blank slices, read as missing: ${runsText(body, missing.blank)}`)
  if (missing.short.length > 0) console.log(`Short slices, read as missing: ${runsText(body, missing.short)}`)
  const sources = fillMissingLayers([bodyCells, share, colors], layerCells, missingLayers)
  sources.forEach((source, index) => {
    if (source === index) return
    console.log(
      source < 0
        ? `Layer ${layerText(index)} has no slice and nothing to fill it from`
        : `Layer ${layerText(index)} has no slice, so it's filled from layer ${layerText(source)}`,
    )
  })
  return { firstLayer, layers, body: bodyCells, share, colors }
}
type Grid = Awaited<ReturnType<typeof readLayers>>

// Keeps the largest piece of body and crops the field to its bounds plus a one-voxel margin on every face, which
// gives the colour room to spread one voxel past the skin. Coverage carries the body decision: a body cell in the
// piece stores at least 128, a body cell outside it 0, a non-body cell at most 127
function cropToBody(grid: Grid, body: Body, level: Level, field: Field, from: number, to: number) {
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
  const inField = (fi: number, fj: number, fk: number) =>
    fi >= 0 && fi < nx && fj >= 0 && fj < ny && fk >= 0 && fk < layers
  const fieldIndex = (fi: number, fj: number, fk: number) => fi + nx * (fj + ny * fk)

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
          // The colour stand-in, until the CT is registered; never 0, which means outside the body
          density[index] = densityFromColor(red[index], green[index], blue[index])
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
  return { volume, fieldFirst }
}

const mm = (value: number) => Number(value.toFixed(3)).toString()

async function main() {
  const { body, level, from, to, out, previews, root } = options()
  const started = performance.now()
  if (previews) {
    for (const path of await drawPreviews(readVolume(await gunzipFile(out)))) console.log(`Preview: ${path}`)
    return
  }

  const field = fieldOf(body, level)
  const frames = framesOf(body, from, to)
  console.log(`Reading the ${body.id}'s slices ${from} to ${to} from ${setFolder(root, body.set)} at ${level.spacing} mm`)
  const grid = await readLayers(body, level, field, frames, root)
  const { volume, fieldFirst } = cropToBody(grid, body, level, field, from, to)
  const raw = writeVolume(volume)
  await writeWhole(out, gzipSync(raw, { level: 9 }))
  for (const path of await drawPreviews(volume)) console.log(`Preview: ${path}`)

  const { size } = await stat(out)
  const seconds = (performance.now() - started) / 1000
  const cells = volume.size[0] * volume.size[1] * volume.size[2]
  console.log(`Slices read: ${frames.length} (${from} to ${to})`)
  console.log(
    `Grid: ${volume.size.join(' × ')} voxels at ${volume.spacing.map(mm).join(' × ')} mm, the body and a one-voxel margin, ` +
      `from cell ${fieldFirst.join(', ')} of the ${field.nx} × ${field.ny} × ${grid.layers} field; ` +
      `origin ${volume.origin.map(mm).join(', ')} mm; slices ${volume.firstSlice} to ${volume.lastSlice}`,
  )
  console.log(`Body voxels: ${countBody(volume.coverage).toLocaleString('en')} of ${cells.toLocaleString('en')}`)
  console.log(`Wrote ${out}: ${(size / 1e6).toFixed(2)} MB, gzipped from ${(raw.length / 1e6).toFixed(1)} MB`)
  console.log(`Took ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
