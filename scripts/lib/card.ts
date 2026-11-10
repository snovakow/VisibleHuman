// The Kodak Gray Scale strip photographed beside each cryosection, read as an exposure reference. The strip is a row
// of grey patches, white (A) at one end, each about a tenth darker than the one before it, on a card in a black
// holder. It's found by its shape, not its brightness: the frames also hold a card of white and coloured control
// patches at the start of the legs, brighter than the strip's white, and on some slices the strip's white is stained.
// The scan clips the white patch at its white point, and the next patch's green with it, so the reference is the first
// patch of the strip that no channel clips: patch 2, two steps down from the white

import type { RawImage } from './decode.ts'
import type { Triple } from '../../src/volume/format.ts'

// The strip lies in this share of the frame from its foot: in the lower fifth on most of the male's slices, higher
// in the frames of the third block, which leave a band of black below the photograph
const stripSearch = 0.3
// The patches' pitch along the strip, in pixels, at the male's 0.33 mm per pixel
export const patchPitch = 32
// The white patch's edge against the holder: a pixel at least this bright with one at most this dark this many pixels
// past it
const edgeBright = 180
const edgeDark = 70
const edgeReach = 4
// The patches past the white that are checked to fall in luminance, each to under the first share of the one before
// it and over the second, read over a box this many pixels wide at each patch's centre
const stairPatches = 6
const stairStep = [0.985, 0.7] as const
const stairBox = 9
// A patch is read this many pixels inside its edges, clear of the strip's blur and the printed lines
const patchInset = 7
// The patches read, from the white, and the one taken as the reference
const patchesRead = 4
export const referencePatch = 2
// A reference patch of fewer pixels than this is too little of the strip to read
const minPatchPixels = 500
// A channel at this level or above has reached the scan's white point of 240
export const clipLevel = 239

export interface CardReading {
  // The mean colour of each patch read, from the white
  patches: Triple[]
  // The pixels each patch was read over
  pixels: number
  // The share of the white patch's pixels with a channel at the clip level
  whiteClipped: number
  // Where the white patch's edge against the holder was found, and the rows of the strip
  edge: number
  rows: readonly [number, number]
}

// The strip's patches in one slice, or null where no strip is found or its reference patch is too small to read
export function readGrayScale(image: RawImage): CardReading | null {
  const { width, height, channels, data } = image
  const top = Math.floor(height * (1 - stripSearch))
  const luminance = new Float32Array(width * (height - top))
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * channels
      luminance[(y - top) * width + x] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    }
  }
  const at = (x: number, y: number) => luminance[(y - top) * width + x]
  const box = (centre: number, y: number) => {
    let sum = 0
    for (let x = centre - (stairBox - 1) / 2; x <= centre + (stairBox - 1) / 2; x++) sum += at(x, y)
    return sum / stairBox
  }
  const centre = (patch: number, edge: number) => edge - patch * patchPitch - patchPitch / 2
  // Every pixel that is the white patch's edge on its row, with the strip falling away to its left
  const edges = new Map<number, number[]>()
  const reach = (stairPatches + 1) * patchPitch
  for (let y = top; y < height; y++) {
    for (let x = reach; x < width - edgeReach; x++) {
      if (at(x, y) < edgeBright || at(x + edgeReach, y) > edgeDark) continue
      let previous = box(centre(1, x), y)
      if (previous < edgeBright * 0.8) continue
      let falls = true
      for (let patch = 2; patch <= stairPatches && falls; patch++) {
        const next = box(centre(patch, x), y)
        falls = next < previous * stairStep[0] && next > previous * stairStep[1]
        previous = next
      }
      if (!falls) continue
      const rows = edges.get(x) ?? []
      rows.push(y)
      edges.set(x, rows)
    }
  }
  if (edges.size === 0) return null
  // The pixels up to edgeReach left of the white's last column pass the edge test too, so the edge is the rightmost of
  // those found on at least half as many rows as the edge found on most; the strip's rows are all of theirs
  const [mode, modeRows] = [...edges].reduce((best, entry) => (entry[1].length > best[1].length ? entry : best))
  const cluster = [...edges].filter(([x, ys]) => Math.abs(x - mode) <= edgeReach && ys.length * 2 >= modeRows.length)
  const edge = Math.max(...cluster.map(([x]) => x))
  const rows = cluster.flatMap(([, ys]) => ys)
  const first = Math.min(...rows) + patchInset
  const last = Math.max(...rows) - patchInset
  if (last < first) return null
  let pixels = 0
  let clipped = 0
  const patches = Array.from({ length: patchesRead }, (_, patch): Triple => {
    const sums = [0, 0, 0]
    pixels = 0
    for (let y = first; y <= last; y++) {
      for (let x = edge - (patch + 1) * patchPitch + 1 + patchInset; x <= edge - patch * patchPitch - patchInset; x++) {
        const p = (y * width + x) * channels
        sums[0] += data[p]
        sums[1] += data[p + 1]
        sums[2] += data[p + 2]
        if (patch === 0 && Math.max(data[p], data[p + 1], data[p + 2]) >= clipLevel) clipped++
        pixels++
      }
    }
    return [sums[0] / pixels, sums[1] / pixels, sums[2] / pixels]
  })
  if (pixels < minPatchPixels) return null
  return { patches, pixels, whiteClipped: clipped / pixels, edge, rows: [first - patchInset, last + patchInset] }
}
