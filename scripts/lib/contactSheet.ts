// A contact sheet of a body's slices, drawn from the small JPEGs the NLM offers beside them, which a body's scene axes
// and its background rule are decided from before anything is built: which way the face points, which side is the
// subject's right, which end the neck is at, and what the body is set in. The sheet shows the chosen slices in a row
// under their numbers, the patch read at each corner outlined on them, each patch's mean colour as a swatch under its
// slice, and a histogram of the patches' pixels a channel. The log gives the same numbers as text

import { join } from 'node:path'
import { blueMargin, darkMax, greyRange, isBodyPixel } from '../../src/volume/segment.ts'
import { thumbnailName, type Body } from './bodies.ts'
import { requireDataFile, setFolder } from './data.ts'
import { readRgb, writeAnnotatedPng, type RawImage } from './decode.ts'
import { previewFolder } from './previews.ts'

// The patch read at each corner of a thumbnail, in its pixels a side: an eighth of the head's width, wide enough to
// average over the JPEG's blocks and small enough to stay clear of the head
const patchSize = 32
const corners = ['top left', 'top right', 'bottom left', 'bottom right'] as const

// The sheet's measures, in pixels: the space around each thing, the rows of text, a swatch, and the histogram, three
// pixels a value
const gap = 16
const titleRow = 34
const numberRow = 30
const swatchRow = 28
const swatchWidth = 36
const valueWidth = 3
const plotHeight = 180
const axisRow = 22
const noteRow = 22
const background = 24

type Rgb = readonly [number, number, number]

// How the rule tuned on the male's blue gel reads a pixel, in the order it tests (segment.ts): as gel, as the dark
// frame, as a grey card, or else as body
const readings = ['blue', 'dark', 'grey', 'body'] as const
function readingOf(r: number, g: number, b: number): (typeof readings)[number] {
  if (b > r + blueMargin) return 'blue'
  const max = Math.max(r, g, b)
  if (max < darkMax) return 'dark'
  return max - Math.min(r, g, b) < greyRange ? 'grey' : 'body'
}

const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const text = (x: number, y: number, size: number, content: string, fill = '#e8e8e8') =>
  `<text x="${x}" y="${y}" font-family="Menlo, Consolas, monospace" font-size="${size}" fill="${fill}">${escaped(content)}</text>`
const percent = (share: number) => `${(100 * share).toFixed(1)} %`
const rgbText = (colour: Rgb) => colour.map((value) => Math.round(value)).join(' ')

// Draws the body's contact sheet into the previews' folder and returns its path and what it read, as lines for the log
export async function drawContactSheet(body: Body, root: string, folder = previewFolder) {
  const { thumbnails } = body
  if (!thumbnails) throw new Error(`The ${body.id} has no set of small JPEGs to draw a contact sheet from`)
  const slices = thumbnails.sheet
  const names = slices.map((slice) => thumbnailName(body, slice))
  const images: RawImage[] = []
  for (const name of names) images.push(await readRgb(await requireDataFile(root, thumbnails.set, name)))
  const { width, height } = images[0]
  images.forEach((image, n) => {
    if (image.width !== width || image.height !== height) {
      throw new Error(`${names[n]} is ${image.width} × ${image.height}, not the ${width} × ${height} of ${names[0]}`)
    }
  })
  if (width < 2 * patchSize || height < 2 * patchSize) throw new Error(`${names[0]} is too small for corner patches of ${patchSize} px`)

  // Each corner patch's mean colour, and every patch pixel counted: by its value a channel, by how the gel rule reads
  // it, and by whether the body's own rule calls it body
  const histogram = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  const sums = [0, 0, 0]
  const squares = [0, 0, 0]
  const read = { blue: 0, dark: 0, grey: 0, body: 0 }
  const isBody = body.segmentRule ?? isBodyPixel
  let ownBody = 0
  let pixels = 0
  const patchOrigins = corners.map((_, c) => [c % 2 === 0 ? 0 : width - patchSize, c < 2 ? 0 : height - patchSize] as const)
  const means = images.map(({ channels, data }) =>
    patchOrigins.map(([left, top]): Rgb => {
      const mean = [0, 0, 0]
      for (let y = top; y < top + patchSize; y++) {
        for (let x = left; x < left + patchSize; x++) {
          const offset = (x + width * y) * channels
          const r = data[offset]
          const g = data[offset + 1]
          const b = data[offset + 2]
          ;[r, g, b].forEach((value, c) => {
            mean[c] += value
            histogram[c][value]++
            sums[c] += value
            squares[c] += value * value
          })
          read[readingOf(r, g, b)]++
          if (isBody(r, g, b)) ownBody++
          pixels++
        }
      }
      return [mean[0] / (patchSize * patchSize), mean[1] / (patchSize * patchSize), mean[2] / (patchSize * patchSize)]
    }),
  )
  const overall = sums.map((sum) => sum / pixels)
  const spread = squares.map((square, c) => Math.sqrt(Math.max(0, square / pixels - overall[c] * overall[c])))

  // The sheet: a title, the slices' numbers, the slices, two rows of swatches, then the histogram beside its notes
  const tilesTop = gap + titleRow + numberRow
  const swatchesTop = tilesTop + height + gap / 2
  const plotTop = swatchesTop + 2 * swatchRow + gap
  const plotWidth = 256 * valueWidth
  const sheetWidth = Math.max(gap + images.length * (width + gap), 2 * gap + plotWidth + 760)
  const sheetHeight = plotTop + plotHeight + axisRow + gap
  const data = new Uint8Array(sheetWidth * sheetHeight * 3).fill(background)
  const tileLeft = (n: number) => gap + n * (width + gap)
  images.forEach((image, n) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (x + width * y) * image.channels
        data.set(image.data.subarray(from, from + 3), (tileLeft(n) + x + sheetWidth * (tilesTop + y)) * 3)
      }
    }
  })

  const reduction = body.width / width
  const sizeNote =
    `${width} × ${height} px each, the slices' ${body.width} × ${body.height} px of ${body.pixelSize} mm at 1/` +
    `${Number.isInteger(reduction) ? reduction : reduction.toFixed(2)} the size`
  const digits = body.naming.digits
  const numberOf = (slice: number) => String(slice).padStart(digits, '0')
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">`,
    text(gap, gap + 22, 20, `${body.label}: ${slices.length} of slices ${numberOf(body.firstSlice)}–${numberOf(body.lastSlice)} from ${thumbnails.set}, ${sizeNote}`),
  ]
  images.forEach((_, n) => {
    const left = tileLeft(n)
    svg.push(text(left, tilesTop - 9, 22, numberOf(slices[n])))
    patchOrigins.forEach(([x, y], c) => {
      svg.push(
        `<rect x="${left + x + 0.5}" y="${tilesTop + y + 0.5}" width="${patchSize - 1}" height="${patchSize - 1}" fill="none" stroke="#ffffff" stroke-width="1"/>`,
      )
      // The swatches sit as their corners do: the top two in the first row, the left ones on the left
      const swatchLeft = left + (c % 2) * (width / 2)
      const swatchTop = swatchesTop + Math.floor(c / 2) * swatchRow
      const [r, g, b] = means[n][c].map(Math.round)
      svg.push(
        `<rect x="${swatchLeft}" y="${swatchTop}" width="${swatchWidth}" height="${swatchRow - 6}" fill="rgb(${r},${g},${b})" stroke="#808080" stroke-width="1"/>`,
        text(swatchLeft + swatchWidth + 6, swatchTop + 16, 13, `${r} ${g} ${b}`),
      )
    })
  })

  // The histogram: a channel's count at each value as a filled outline, the three laid over one another, each scaled
  // to the tallest count by its square root, so a second colour among the corners shows beside the main one
  const plotLeft = gap
  const tallest = Math.max(...histogram.map((counts) => Math.max(...counts)))
  svg.push(`<rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#000000" stroke="#808080" stroke-width="1"/>`)
  const channelColours = ['#ff5050', '#40d040', '#5080ff']
  histogram.forEach((counts, c) => {
    const base = plotTop + plotHeight
    let path = `M${plotLeft},${base}`
    for (let value = 0; value < 256; value++) {
      const top = base - Math.sqrt(counts[value] / tallest) * (plotHeight - 4)
      path += `V${top.toFixed(1)}H${plotLeft + (value + 1) * valueWidth}`
    }
    svg.push(`<path d="${path}V${base}Z" fill="${channelColours[c]}" fill-opacity="0.45" stroke="${channelColours[c]}" stroke-width="1"/>`)
  })
  for (const value of [0, 64, 128, 192, 255]) {
    const x = plotLeft + (value + 0.5) * valueWidth
    svg.push(
      `<line x1="${x}" y1="${plotTop + plotHeight}" x2="${x}" y2="${plotTop + plotHeight + 5}" stroke="#808080" stroke-width="1"/>`,
      text(x - (value < 10 ? 4 : value < 100 ? 8 : 12), plotTop + plotHeight + 19, 13, String(value)),
    )
  }
  const gelNote = `By the male's gel rule: ${readings.map((reading) => `${reading} ${percent(read[reading] / pixels)}`).join(', ')}`
  const notes = [
    `Corner patches: ${patchSize} × ${patchSize} px at the four corners of each slice, ${pixels.toLocaleString('en')} px in all`,
    `Mean    red ${overall[0].toFixed(1)}, green ${overall[1].toFixed(1)}, blue ${overall[2].toFixed(1)}`,
    `Spread  red ${spread[0].toFixed(1)}, green ${spread[1].toFixed(1)}, blue ${spread[2].toFixed(1)} (standard deviation)`,
    gelNote,
  ]
  if (body.segmentRule) notes.push(`By the ${body.id}'s own rule: body ${percent(ownBody / pixels)}`)
  notes.push('Histogram: red, green and blue of every patch pixel, heights by the square root of the count')
  notes.forEach((note, n) => svg.push(text(plotLeft + plotWidth + gap, plotTop + 18 + n * noteRow, 14, note)))
  svg.push('</svg>')

  const path = join(folder, `${body.id}-sheet.png`)
  await writeAnnotatedPng(path, { width: sheetWidth, height: sheetHeight, channels: 3, data }, svg.join(''))

  const lines = [
    `Contact sheet: ${path}`,
    `Slices ${slices.map(numberOf).join(', ')} from ${setFolder(root, thumbnails.set)}: ${sizeNote}`,
    `Corner patches' mean colours (${corners.join(', ')}):`,
    ...means.map((patches, n) => `  ${numberOf(slices[n])}: ${patches.map(rgbText).join(' | ')}`),
    ...notes.slice(0, -1),
  ]
  return { path, lines }
}
