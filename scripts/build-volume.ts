// The data script: reads the Visible Human Male's colour slices from the NLM's server and writes the volume
// file the app loads, with previews in .cache/preview/. Run by `npm run volume`, on Node's own TypeScript.
//
//   --from A, --to B   read only slices A to B (by default 1001 to 2878, every one)
//   --out PATH         write the file there rather than public/volume/male-4mm.bin
//   --cache            keep the downloads in .cache/slices/, and read them from there next time
//   --previews         redraw the previews from the existing file, downloading nothing

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { PNG } from 'pngjs'
import {
  cellIndex,
  isBodyCell as isMaskedBody,
  maskBytes,
  readVolume,
  sceneCell,
  writeVolume,
  type Triple,
  type Volume,
} from '../src/volume/format.ts'
import {
  dipWindow,
  fillMissingLayers,
  isBodyCell,
  isBodyPixel,
  largestPiece,
  missingReason,
  type MissingReason,
} from '../src/volume/segment.ts'

const baseUrl = 'https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Male-Images/PNG_format'
// Each region's folder and the slices it holds. Regions overlap, and a slice in two is the same file, so each slice is
// taken from the first region that lists it
const regions = [
  { name: 'head', first: 1001, last: 1377 },
  { name: 'thorax', first: 1280, last: 1688 },
  { name: 'abdomen', first: 1455, last: 1997 },
  { name: 'pelvis', first: 1732, last: 2028 },
  { name: 'thighs', first: 1732, last: 2411 },
  { name: 'legs', first: 2265, last: 2878 },
] as const
const firstSlice = 1001
const lastSlice = 2878

// Each slice is a 2048 × 1216 8-bit RGB PNG of 0.33 mm pixels, the slices 1 mm apart
const sliceWidth = 2048
const sliceHeight = 1216
const rgbColorType = 2
const pixelSize = 0.33
const sliceSpacing = 1
// A 4 mm cell: 12 × 12 pixels across (3.96 mm), 4 slices along (4 mm)
const pixelsPerCell = 12
const slicesPerLayer = 4

// Downloads run four at a time, which is one layer's slices; a failed one is tried again after a growing pause
const attempts = 4
const retryPause = 2000

const defaultOut = 'public/volume/male-4mm.bin'
const cacheFolder = '.cache/slices'
const previewFolder = '.cache/preview'
// Each cell is drawn as a square of this many pixels in the previews
const previewScale = 2

// The full grid's size across a slice; the last column and row of cells are partial
const nx = Math.ceil(sliceWidth / pixelsPerCell)
const ny = Math.ceil(sliceHeight / pixelsPerCell)
const layerCells = nx * ny

function options() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string', default: defaultOut },
      cache: { type: 'boolean', default: false },
      previews: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const slice = (text: string | undefined, fallback: number, name: string) => {
    if (text === undefined) return fallback
    const value = Number(text)
    if (!Number.isInteger(value) || value < firstSlice || value > lastSlice) {
      throw new Error(`--${name} takes a slice number from ${firstSlice} to ${lastSlice}, not ${text}`)
    }
    return value
  }
  const from = slice(values.from, firstSlice, 'from')
  const to = slice(values.to, lastSlice, 'to')
  if (from > to) throw new Error(`--from ${from} comes after --to ${to}`)
  return { from, to, out: values.out, cache: values.cache, previews: values.previews }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const layerOf = (slice: number) => Math.floor((slice - firstSlice) / slicesPerLayer)

function sliceUrl(slice: number) {
  const region = regions.find((r) => slice >= r.first && slice <= r.last)
  if (!region) throw new Error(`No region holds slice ${slice}`)
  return `${baseUrl}/${region.name}/a_vm${slice}.png`
}

// Writes through a temporary name, renamed into place once whole, so a failed run never leaves half a file
async function writeWhole(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}

// A slice's pixels, checked to be the size and kind every slice is
function decode(slice: number, bytes: Buffer) {
  const png = PNG.sync.read(bytes)
  if (png.width !== sliceWidth || png.height !== sliceHeight || png.colorType !== rgbColorType || png.depth !== 8) {
    throw new Error(
      `Slice ${slice} is ${png.width} × ${png.height}, colour type ${png.colorType}, depth ${png.depth}, ` +
        `not ${sliceWidth} × ${sliceHeight} 8-bit RGB`,
    )
  }
  // pngjs gives four bytes per pixel, alpha included, even for an RGB file
  return png.data
}

// A slice's pixels, from the cache when asked and it's there, and otherwise downloaded, with retries
async function readSlice(slice: number, cache: boolean) {
  const cachePath = join(cacheFolder, `a_vm${slice}.png`)
  if (cache) {
    const cached = await readFile(cachePath).catch(() => null)
    if (cached) {
      try {
        return decode(slice, cached)
      } catch (error) {
        console.warn(`Cached slice ${slice} is unreadable (${String(error)}), so downloading it again`)
      }
    }
  }
  const url = sliceUrl(slice)
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const pixels = decode(slice, bytes)
      if (cache) await writeWhole(cachePath, bytes)
      return pixels
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`Slice ${slice} failed ${attempts} times, at ${url}: ${String(error)}`, { cause: error })
      }
      console.warn(`Slice ${slice} failed (${String(error)}), so trying again`)
      await pause(retryPause * attempt)
    }
  }
}

// Each pixel's column of cells, and each row's offset into a layer's cells
const cellColumn = Int32Array.from({ length: sliceWidth }, (_, x) => Math.floor(x / pixelsPerCell))
const cellRowStart = Int32Array.from({ length: sliceHeight }, (_, y) => Math.floor(y / pixelsPerCell) * nx)

// The pixels each cell takes from one slice: 12 × 12, fewer in the partial last column and row
const cellPixels = Uint32Array.from({ length: layerCells }, (_, cell) => {
  const across = Math.min(pixelsPerCell, sliceWidth - (cell % nx) * pixelsPerCell)
  const down = Math.min(pixelsPerCell, sliceHeight - Math.floor(cell / nx) * pixelsPerCell)
  return across * down
})

// One slice's sums: for each cell, its body pixels' channels and their count; and the slice's body pixels in all.
// The slice's pixels aren't kept, only these
function sliceSums(slice: number, pixels: Buffer) {
  const red = new Uint32Array(layerCells)
  const green = new Uint32Array(layerCells)
  const blue = new Uint32Array(layerCells)
  const body = new Uint16Array(layerCells)
  let total = 0
  for (let y = 0; y < sliceHeight; y++) {
    const rowStart = cellRowStart[y]
    let offset = y * sliceWidth * 4
    for (let x = 0; x < sliceWidth; x++, offset += 4) {
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      if (!isBodyPixel(r, g, b)) continue
      const cell = rowStart + cellColumn[x]
      red[cell] += r
      green[cell] += g
      blue[cell] += b
      body[cell]++
      total++
    }
  }
  return { slice, red, green, blue, body, total }
}
type SliceSums = ReturnType<typeof sliceSums>

// Slice numbers as runs, such as 2017–2020, 2424–2435
function runsText(slices: readonly number[]) {
  const runs: string[] = []
  for (let n = 0; n < slices.length; ) {
    let end = n
    while (end + 1 < slices.length && slices[end + 1] === slices[end] + 1) end++
    runs.push(end === n ? `${slices[n]}` : `${slices[n]}–${slices[end]}`)
    n = end + 1
  }
  return runs.join(', ')
}

// The grid of every layer read: one byte per cell for body, three for its colour. Each slice is decided once the
// dipWindow non-blank slices after it are read: a missing one adds nothing to its layer (segment.ts). Memory holds the
// sums of the layer being built and of the slices waiting on that decision, never the slices themselves
async function readLayers(from: number, to: number, cache: boolean) {
  const firstLayer = layerOf(from)
  const layers = layerOf(to) - firstLayer + 1
  const body = new Uint8Array(layerCells * layers)
  const colors = new Uint8Array(layerCells * layers * 3)
  // Each slice's body pixels, once read
  const counts = new Int32Array(to - from + 1)
  const missing: Record<MissingReason, number[]> = { blank: [], short: [] }
  const missingLayers = Array.from({ length: layers }, () => false)
  const pending: SliceSums[] = []
  let fetched = from - 1
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
      if (!isBodyCell(count, layer.pixels[cell])) continue
      body[base + cell] = 1
      colors[(base + cell) * 3] = Math.round(layer.red[cell] / count)
      colors[(base + cell) * 3 + 1] = Math.round(layer.green[cell] / count)
      colors[(base + cell) * 3 + 2] = Math.round(layer.blue[cell] / count)
    }
    if (layer.index % 10 === 9 || layer.index === layers - 1) {
      const read = fetched - from + 1
      const left = ((performance.now() - started) / 1000 / read) * (to - fetched)
      console.log(`Read slices to ${fetched}: ${read} of ${to - from + 1}, about ${Math.ceil(left / 60)} min left`)
    }
    for (const sums of [layer.red, layer.green, layer.blue, layer.body, layer.pixels]) sums.fill(0)
    layer.kept = 0
    layer.index++
  }

  // The body pixel counts of up to dipWindow non-blank slices read from start onwards, by step, nearest first
  const nonBlank = (start: number, step: 1 | -1) => {
    const found: number[] = []
    for (let slice = start; slice >= from && slice <= fetched && found.length < dipWindow; slice += step) {
      const count = counts[slice - from]
      if (count > 0) found.push(count)
    }
    return found
  }
  const decide = () => {
    while (pending.length > 0) {
      const sums = pending[0]
      const after = nonBlank(sums.slice + 1, 1)
      if (after.length < dipWindow && fetched < to) return
      pending.shift()
      while (layerOf(sums.slice) - firstLayer > layer.index) finishLayer()
      const reason = missingReason(sums.total, nonBlank(sums.slice - 1, -1), after)
      if (reason) missing[reason].push(sums.slice)
      else keep(sums)
    }
  }

  // Four downloads at a time, one layer's slices
  for (let batchFirst = from; batchFirst <= to; ) {
    const batchLast = Math.min(to, firstSlice + (layerOf(batchFirst) + 1) * slicesPerLayer - 1)
    const slices = Array.from({ length: batchLast - batchFirst + 1 }, (_, n) => batchFirst + n)
    // Each slice is summed, and its pixels let go, as soon as it's read, so no more than a batch's slices are held at once
    const read = await Promise.all(slices.map(async (slice) => sliceSums(slice, await readSlice(slice, cache))))
    for (const sums of read) counts[sums.slice - from] = sums.total
    pending.push(...read)
    fetched = batchLast
    decide()
    batchFirst = batchLast + 1
  }
  while (layer.index < layers) finishLayer()

  // A layer made only of missing slices is filled from its nearest read layers, so the body stays one piece
  const layerText = (index: number) => {
    const first = Math.max(from, firstSlice + (firstLayer + index) * slicesPerLayer)
    const last = Math.min(to, firstSlice + (firstLayer + index + 1) * slicesPerLayer - 1)
    return `${first}–${last}`
  }
  if (missing.blank.length > 0) console.log(`Blank slices, read as missing: ${runsText(missing.blank)}`)
  if (missing.short.length > 0) console.log(`Short slices, read as missing: ${runsText(missing.short)}`)
  const sources = fillMissingLayers(body, colors, layerCells, missingLayers)
  sources.forEach((source, index) => {
    if (source === index) return
    console.log(
      source < 0
        ? `Layer ${layerText(index)} has no slice and nothing to fill it from`
        : `Layer ${layerText(index)} has no slice, so it's filled from layer ${layerText(source)}`,
    )
  })
  return { firstLayer, layers, body, colors, read: to - from + 1 }
}

// Keeps the largest piece of body and crops the grid to its bounds
function cropToBody(grid: Awaited<ReturnType<typeof readLayers>>, from: number, to: number): Volume {
  const { cells: kept, size: bodyCount } = largestPiece(grid.body, nx, ny, grid.layers)
  if (bodyCount === 0) throw new Error(`No body found in slices ${from} to ${to}`)
  const low = [nx, ny, grid.layers]
  const high = [-1, -1, -1]
  for (let k = 0; k < grid.layers; k++) {
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

  const size: Triple = [high[0] - low[0] + 1, high[1] - low[1] + 1, high[2] - low[2] + 1]
  const mask = new Uint8Array(maskBytes(size[0] * size[1] * size[2]))
  const colors = new Uint8Array(bodyCount * 3)
  let written = 0
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const source = i + low[0] + nx * (j + low[1] + ny * (k + low[2]))
        if (kept[source] === 0) continue
        const index = cellIndex(size, i, j, k)
        mask[index >> 3] |= 1 << (index & 7)
        colors.set(grid.colors.subarray(source * 3, source * 3 + 3), written * 3)
        written++
      }
    }
  }
  return {
    size,
    spacing: [pixelsPerCell * pixelSize, pixelsPerCell * pixelSize, slicesPerLayer * sliceSpacing],
    offset: [low[0], low[1], grid.firstLayer + low[2]],
    firstSlice: from,
    lastSlice: to,
    mask,
    colors,
  }
}

// The previews, drawn through format.ts's scene axes so they show the body as the app will. Each view looks along one
// scene axis (0 x, 1 y, 2 z): right and up are the scene axes across the image, with right's sign, and toward is the
// side the view looks from. A plane view shows the cells in the middle of the grid along that axis; otherwise each
// line of sight shows its nearest body cell
interface PreviewView {
  file: string
  right: 0 | 1 | 2
  rightSign: 1 | -1
  up: 0 | 1 | 2
  toward: 0 | 1 | 2
  towardSign: 1 | -1
  plane: boolean
}
const previewViews: readonly PreviewView[] = [
  // From the front, which faces +z: the body's left (+x) on the right
  { file: 'front.png', right: 0, rightSign: 1, up: 1, toward: 2, towardSign: 1, plane: false },
  { file: 'coronal.png', right: 0, rightSign: 1, up: 1, toward: 2, towardSign: 1, plane: true },
  // From the body's right (−x): the front (+z) on the right
  { file: 'sagittal.png', right: 2, rightSign: 1, up: 1, toward: 0, towardSign: -1, plane: true },
]

async function drawPreviews(volume: Volume) {
  const [sx, sy, sz] = volume.size
  // The grid's bounds along the scene's axes, in whole cells
  const corner = sceneCell(sx - 1, sy - 1, sz - 1)
  const low = [0, 1, 2].map((axis) => Math.min(0, corner[axis]))
  const high = [0, 1, 2].map((axis) => Math.max(0, corner[axis]))

  for (const view of previewViews) {
    const rightLow = view.rightSign > 0 ? low[view.right] : -high[view.right]
    const width = high[view.right] - low[view.right] + 1
    const height = high[view.up] - low[view.up] + 1
    const middle = Math.floor((low[view.toward] + high[view.toward]) / 2)
    const nearest = new Float64Array(width * height).fill(-Infinity)
    const image = new PNG({ width: width * previewScale, height: height * previewScale })
    // Black where no body is drawn, opaque throughout
    for (let n = 3; n < image.data.length; n += 4) image.data[n] = 255

    let body = 0
    for (let k = 0; k < sz; k++) {
      for (let j = 0; j < sy; j++) {
        for (let i = 0; i < sx; i++) {
          if (!isMaskedBody(volume.mask, cellIndex(volume.size, i, j, k))) continue
          const color = body++ * 3
          const at = sceneCell(i, j, k)
          if (view.plane && at[view.toward] !== middle) continue
          const u = at[view.right] * view.rightSign - rightLow
          const v = high[view.up] - at[view.up]
          const depth = at[view.toward] * view.towardSign
          if (depth <= nearest[u + width * v]) continue
          nearest[u + width * v] = depth
          for (let dy = 0; dy < previewScale; dy++) {
            for (let dx = 0; dx < previewScale; dx++) {
              const offset = ((v * previewScale + dy) * image.width + u * previewScale + dx) * 4
              image.data[offset] = volume.colors[color]
              image.data[offset + 1] = volume.colors[color + 1]
              image.data[offset + 2] = volume.colors[color + 2]
            }
          }
        }
      }
    }
    const path = join(previewFolder, view.file)
    await writeWhole(path, PNG.sync.write(image))
    console.log(`Preview: ${path}`)
  }
}

async function main() {
  const { from, to, out, cache, previews } = options()
  const started = performance.now()
  if (previews) {
    await drawPreviews(readVolume(await readFile(out)))
    return
  }

  console.log(`Reading slices ${from} to ${to}${cache ? `, keeping them in ${cacheFolder}` : ''}`)
  const grid = await readLayers(from, to, cache)
  const volume = cropToBody(grid, from, to)
  const bytes = writeVolume(volume)
  await writeWhole(out, bytes)
  await drawPreviews(volume)

  const { size } = await stat(out)
  const seconds = (performance.now() - started) / 1000
  console.log(`Slices read: ${grid.read} (${from} to ${to})`)
  console.log(`Grid: ${volume.size.join(' × ')} cells, from cell ${volume.offset.join(', ')} of the full grid`)
  console.log(`Body cells: ${(volume.colors.length / 3).toLocaleString('en')}`)
  console.log(`Wrote ${out}: ${(size / 1e6).toFixed(2)} MB`)
  console.log(`Took ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
