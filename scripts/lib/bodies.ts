// The bodies the volume script builds, one entry each: where a body's slices are in the data root, how they're named,
// their geometry, the levels it can be built at, its scene axes and the quirks of its set. The male and the female are
// here; the head follows, an entry of the same shape.

import type { SceneAxes } from '../../src/volume/format.ts'

// One level a body can be built at: the voxel's nominal spacing in millimetres, the pixels it spans across a slice
// and the slices it spans along the body
export interface Level {
  spacing: number
  pixels: number
  slices: number
  // The level the page opens on, whose file is committed; the others are built only before a deploy
  default?: true
}

// How a slice's file is named: the prefix, the slice number padded to digits, a sub-slice suffix where a number has
// several files (the female's a, b and c, 0.33 mm apart), then the extension
export interface Naming {
  prefix: string
  digits: number
  subSlices: readonly string[]
  extension: string
}

// A body's CT set, where it has one: the set's id, how a slice's image and header files are named around its number
// (the male's cvm1125f.png and cvm1125f.txt), and what the NLM calls the scan
export interface CtSet {
  set: string
  image: { prefix: string; suffix: string }
  header: { prefix: string; suffix: string }
  source: string
  // Scanned fresh, in air, so the CT's body silhouette is the body's on every slice and the fit always matches it; the
  // male's frozen CT is matched only where its silhouette's area agrees with the photographs'
  inAir?: true
}

export interface Body {
  id: string
  // As the page names it, and the credit for it the NLM's terms ask for
  label: string
  credit: string
  // The data set the slices are in, by the id scripts/lib/sets.ts gives it
  set: string
  firstSlice: number
  lastSlice: number
  naming: Naming
  // Every slice's size in pixels
  width: number
  height: number
  // Millimetres across a pixel, and between neighbouring files along the body
  pixelSize: number
  sliceSpacing: number
  levels: readonly Level[]
  axes: SceneAxes
  // The runs of slices photographed from one frozen block, kept for evening out the colour steps between them
  cryoBlocks: readonly (readonly [number, number])[]
  // Files known to hold no image. They're still read when they decode, so the build measures them; one that can't be
  // decoded is read as missing instead of stopping the build, and named in the log
  blankFiles: readonly string[]
  // Files the NLM's set lists with no bytes in them, which no decoder can read: read as missing, and named in the log
  emptyFiles: readonly string[]
  // Names in the body's sequence the NLM's set doesn't have: read as missing without looking for a file
  absentFiles: readonly string[]
  // A pixel rule of the body's own, where the male's blue-gel rule doesn't fit its background
  segmentRule?: (r: number, g: number, b: number) => boolean
  // The CT scanned slice for slice with the photographs, which the density channel is resampled from
  ct?: CtSet
}

// The name of a CT slice's image or header file
export function ctFileName(body: Body, kind: 'image' | 'header', slice: number) {
  if (!body.ct) throw new Error(`The ${body.id} has no CT set`)
  const { prefix, suffix } = body.ct[kind]
  return `${prefix}${String(slice).padStart(body.naming.digits, '0')}${suffix}`
}

// The file name of one slice, or of one of its sub-slices
export function fileName(body: Body, slice: number, subSlice = '') {
  const { prefix, digits, extension } = body.naming
  return `${prefix}${String(slice).padStart(digits, '0')}${subSlice}${extension}`
}

const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, n) => first + n)

// One file of a body: its index in the body's sequence of files from the first slice's first sub-slice, which layers
// are counted from whatever range is read; the slice number it belongs to; its name; and whether the set lacks it
export interface Frame {
  index: number
  slice: number
  name: string
  absent: boolean
}

// The body's files from frame index first to last, in order: a number's sub-slices in their order, then the next number
export function framesOf(body: Body, first: number, last: number): Frame[] {
  const subs = body.naming.subSlices
  const absent = new Set(body.absentFiles)
  const frames: Frame[] = []
  for (let index = first; index <= last; index++) {
    const slice = body.firstSlice + Math.floor(index / subs.length)
    const name = fileName(body, slice, subs[index % subs.length])
    frames.push({ index, slice, name, absent: absent.has(name) })
  }
  return frames
}

// The index of the last frame of the body
export const lastFrame = (body: Body) => (body.lastSlice - body.firstSlice + 1) * body.naming.subSlices.length - 1

// A frame as written on the command line, a slice number and, where the body has sub-slices, optionally one of them,
// as 1500 or 1500b, as a frame index; a bare number is its first sub-slice at a range's start, its last at the end
export function frameOf(body: Body, text: string, end: 'first' | 'last'): number {
  const subs = body.naming.subSlices
  const letters = subs.filter((sub) => sub !== '').join('')
  const match = new RegExp(`^(\\d+)([${letters}]?)$`).exec(text)
  const slice = match ? Number(match[1]) : NaN
  if (!match || slice < body.firstSlice || slice > body.lastSlice) {
    const example = letters === '' ? '' : `, or one of its sub-slices as ${body.firstSlice}${letters[letters.length - 1]}`
    throw new Error(`Takes a slice number from ${body.firstSlice} to ${body.lastSlice}${example}, not ${text}`)
  }
  const sub = match[2] === '' ? (end === 'first' ? 0 : subs.length - 1) : subs.indexOf(match[2])
  return (slice - body.firstSlice) * subs.length + sub
}

// A frame's name in the logs: its slice number, and its sub-slice letter where the body has them
export function frameText(body: Body, index: number) {
  const subs = body.naming.subSlices
  return `${body.firstSlice + Math.floor(index / subs.length)}${subs[index % subs.length]}`
}

// The male: 1,878 slices a millimetre apart, 2048 × 1216 pixels of 0.33 mm, photographed from four frozen blocks.
// Slices 2424 to 2435 are black in the NLM's set, between the thighs' block and the legs'. Columns run from the body's
// right to its left, rows from its back to its front, and slices down from the head (read from slice 1500)
const male: Body = {
  id: 'male',
  label: 'Male',
  credit: 'Visible Human Male, courtesy of the U.S. National Library of Medicine',
  set: 'male-colour',
  firstSlice: 1001,
  lastSlice: 2878,
  naming: { prefix: 'a_vm', digits: 4, subSlices: [''], extension: '.png' },
  width: 2048,
  height: 1216,
  pixelSize: 0.33,
  sliceSpacing: 1,
  // 12 × 12 pixels is 3.96 mm across, four slices 4 mm along; 6 × 6 and two slices for the 2 mm level
  levels: [
    { spacing: 4, pixels: 12, slices: 4, default: true },
    { spacing: 2, pixels: 6, slices: 2 },
  ],
  axes: { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } },
  cryoBlocks: [
    [1001, 1505],
    [1506, 2016],
    [2017, 2423],
    [2436, 2878],
  ],
  blankFiles: range(2424, 2435).map((slice) => `a_vm${slice}.png`),
  emptyFiles: [],
  absentFiles: [],
  // The frozen CT, scanned before the sectioning and numbered like the photographs: 1,877 slices, 1006 to 2882
  ct: {
    set: 'male-ct',
    image: { prefix: 'cvm', suffix: 'f.png' },
    header: { prefix: 'cvm', suffix: 'f.txt' },
    source: 'frozenCT',
  },
}

// The female's files from one sub-slice to another, inclusive, by name
const femaleRun = (from: string, to: string) => {
  const subs = ['a', 'b', 'c']
  const index = (name: string) => (Number(name.slice(0, 4)) - 1001) * 3 + subs.indexOf(name[4])
  return range(index(from), index(to)).map((n) => `avf${1001 + Math.floor(n / 3)}${subs[n % 3]}.png`)
}

// The female: 1,730 slice numbers a millimetre apart, each photographed three times, a, b and c, a third of a
// millimetre apart, 2048 × 1216 pixels of 0.33 mm as the male's. Her CT is numbered like the photographs, one slice
// a millimetre, which is why a number's three photographs span a millimetre, not 0.99. Four frozen blocks, each
// started on a new run of tag numbers and ended by black frames: 1492b to 1497b, 1977c to 1978b, and 2329c to 2330a
// beside the three names the set lacks. 2100a and 2100b are listed with no bytes on the NLM's server, in the middle of
// a block. The axes are the male's: her previews face the camera head up with the profile facing right
const female: Body = {
  id: 'female',
  label: 'Female',
  credit: 'Visible Human Female, courtesy of the U.S. National Library of Medicine',
  set: 'female-colour',
  firstSlice: 1001,
  lastSlice: 2730,
  naming: { prefix: 'avf', digits: 4, subSlices: ['a', 'b', 'c'], extension: '.png' },
  width: 2048,
  height: 1216,
  pixelSize: 0.33,
  sliceSpacing: 1 / 3,
  // 12 × 12 pixels is 3.96 mm across, twelve sub-slices 4 mm along; 6 × 6 and six sub-slices for the 2 mm level
  levels: [
    { spacing: 4, pixels: 12, slices: 12, default: true },
    { spacing: 2, pixels: 6, slices: 6 },
  ],
  axes: { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } },
  cryoBlocks: [
    [1001, 1492],
    [1497, 1977],
    [1978, 2328],
    [2330, 2730],
  ],
  blankFiles: [...femaleRun('1492b', '1497b'), ...femaleRun('1977c', '1978b'), 'avf2329c.png', 'avf2330a.png'],
  emptyFiles: ['avf2100a.png', 'avf2100b.png'],
  absentFiles: ['avf2328c.png', 'avf2329a.png', 'avf2329b.png', 'avf2730c.png'],
  // The CT taken before the body was frozen, in air: 1,734 slices, 1001 to 2734, a millimetre apart
  ct: {
    set: 'female-ct',
    image: { prefix: 'cvf', suffix: 'f.png' },
    header: { prefix: 'c_vf', suffix: '.txt' },
    source: 'normalCT',
    inAir: true,
  },
}

export const bodies: readonly Body[] = [male, female]

export function bodyOf(id: string): Body {
  const body = bodies.find((candidate) => candidate.id === id)
  if (!body) throw new Error(`No body is called ${id}; the bodies are ${bodies.map((b) => b.id).join(', ')}`)
  return body
}

export function levelOf(body: Body, spacing: number): Level {
  const level = body.levels.find((candidate) => candidate.spacing === spacing)
  if (!level) {
    const spacings = body.levels.map((l) => `${l.spacing}`).join(', ')
    throw new Error(`The ${body.id} has no ${spacing} mm level; its levels are ${spacings} mm`)
  }
  return level
}
