// The bodies the volume script builds, one entry each: where a body's slices are in the data root, how they're named,
// their geometry, the levels it can be built at, its scene axes and the quirks of its set. The male is here; the
// female and the head follow in their milestones, each an entry of the same shape.

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
  // decoded, such as a 0-byte file, is read as missing instead of stopping the build
  blankFiles: readonly string[]
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
  // The frozen CT, scanned before the sectioning and numbered like the photographs: 1,877 slices, 1006 to 2882
  ct: {
    set: 'male-ct',
    image: { prefix: 'cvm', suffix: 'f.png' },
    header: { prefix: 'cvm', suffix: 'f.txt' },
    source: 'frozenCT',
  },
}

export const bodies: readonly Body[] = [male]

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
