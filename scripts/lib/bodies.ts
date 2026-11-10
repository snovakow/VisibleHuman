// The bodies the volume script builds, one entry each: where a body's slices are in the data root, how they're named,
// their geometry, the levels it can be built at, its scene axes and the quirks of its set: the male, the female and
// the head.

import type { SceneAxes } from '../../src/volume/format.ts'
import { isTissueOnIce } from '../../src/volume/segment.ts'

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

// The small JPEGs the NLM offers of a body's slices, where it has them: the set they're in, the extension that takes
// the place of the slice's own, and the slices a contact sheet shows, spread from the first to the last
export interface Thumbnails {
  set: string
  extension: string
  sheet: readonly number[]
}

// The scans of a whole body, each one grid in its scanner's frame, which a rigid transform places on the photographs:
// a CT, which the density channel is resampled from, and an MRI, which fills a channel of its own. Each is a set of
// DICOM files, a slice a file
export interface Scans {
  // The CT's set, and what its files' values are multiplied by to give Hounsfield units
  ct: { set: string; hounsfieldScale: number }
  mri: { set: string }
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
  // Files with more rows than the body's slices have, read from their top: a file of any other size stops the build
  tallFiles?: readonly string[]
  // How many pixels in from each side of a slice never count as body, where the frame's edge can't be told from
  // tissue; they still count among their cells' pixels, so a cell wholly inside the strip is never body
  frameInset?: { left?: number; top?: number; right?: number; bottom?: number }
  // The faces of its frozen blocks lie under frost, which the pixel rule reads as body: a slice near a face, or near a
  // run of blank or short slices, whose body is bluer than the slices past the frost's reach is read as missing, and
  // a layer keeping fewer than half its slices is filled from its neighbours (segment.ts)
  frostedFaces?: true
  // The short rule's window in millimetres, where the body keeps one of its own rather than segment.ts's 8 mm
  shortWindowMm?: number
  // A pixel rule of the body's own, where the male's blue-gel rule doesn't fit its background
  segmentRule?: (r: number, g: number, b: number) => boolean
  // The cells its body encloses are filled in as body, in the colour of all their pixels: for a body whose pixel rule
  // misses tissue that looks like its background, where that tissue lies inside tissue the rule finds
  fillsEnclosed?: true
  // The CT scanned slice for slice with the photographs, which the density channel is resampled from
  ct?: CtSet
  // The CT and the MRI scanned of the body whole, where it has them instead of a CT slice for slice
  scans?: Scans
  // The slices as small JPEGs, which a contact sheet is drawn from to read the body's orientation and background
  thumbnails?: Thumbnails
}

// The name of a slice's small JPEG
export function thumbnailName(body: Body, slice: number) {
  if (!body.thumbnails) throw new Error(`The ${body.id} has no set of small JPEGs`)
  const { prefix, digits } = body.naming
  return `${prefix}${String(slice).padStart(digits, '0')}${body.thumbnails.extension}`
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
// right to its left, rows from its back to its front, and slices down from the head (read from slice 1500). The
// faces where its first three blocks meet are frosted: 1505 and 2017 to 2020 read as short, and 1506 and 2016 as
// frosted
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
  frostedFaces: true,
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
// a block. The axes are the male's: her previews face the camera head up with the profile facing right. Frost lies
// on her blocks' faces as on the male's, but deeper, about 4 mm, a dozen photographs, either side of the black frames:
// the gel rule reads it as body, so her body pixels thin and turn blue there, which tinted the layers beside each run
// of black frames cyan before the frosted slices were read as missing
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
  frostedFaces: true,
  // The CT taken before the body was frozen, in air: 1,734 slices, 1001 to 2734, a millimetre apart
  ct: {
    set: 'female-ct',
    image: { prefix: 'cvf', suffix: 'f.png' },
    header: { prefix: 'c_vf', suffix: '.txt' },
    source: 'normalCT',
    inAir: true,
  },
}

// The head: 1,477 slices 0.147 mm apart, 1056 × 1528 pixels of 0.147 mm, gzipped TIFFs, from one frozen block, with
// every slice also offered as a JPEG a quarter the size. Read from the contact sheet of those: the crown is at slice 1
// and the throat under the chin at 1477, so slices run down as the male's; the face is at the top of the image, the
// male's turned half a turn, so rows run from the front to the back; and columns run from the subject's left to its
// right, as a block cut from the crown down shows from above. The CAT, whose own left and right the scanner records,
// bears that out: fitted under both hands it scores higher this way, and its frontal sinuses, the larger on the
// subject's left, lie on the photographs' only this way (register.ts).
// It's set in ice, not gel: white frost over the crown and grey ice below, which a pixel rule of its own tells from
// tissue, and the tissue that rule can't tell, inside tissue it can, is filled back in. Slices 500 to 508 are under
// a film of frost, and the builder reads 502 to 507 as short. The frame is narrower than the head: the subject's
// right side passes out of it over slices 233 to 1288 and the left over 353 to 1216, and the tip of the nose and the
// back of the head touch its top and bottom
// The head's CAT files hold half of Hounsfield units, by the rescale they state themselves: air beside the head
// reads −490 where air is −1000, fat −45 where fat is about −100, the frontal bone's outer table 956 and the teeth's
// enamel 1065 to 1365, where cortical bone is 1200 to 1900 and enamel 2500 and over; soft tissue reads 0 to 10. A
// line through the air and the fat gives 2.01 times the file's value less 9, so the values are doubled
const headCatHounsfieldScale = 2

// The head's short rule looks eight slices either way, 1.2 mm, the window its pixel rule was tuned and its file built
// with. Its ice frosts over 500 to 508, and the builder reads 502 to 507 short; over 8 mm, 54 of its slices, it reads
// 508 short too, which would change its file
const headShortWindowMm = 8 * 0.147

const head: Body = {
  id: 'head',
  label: 'Head',
  credit: 'Visible Human Project additional head images, courtesy of the U.S. National Library of Medicine',
  set: 'head-cryo',
  firstSlice: 1,
  lastSlice: 1477,
  naming: { prefix: '', digits: 4, subSlices: [''], extension: '.tiff.gz' },
  width: 1056,
  height: 1528,
  pixelSize: 0.147,
  sliceSpacing: 0.147,
  // 8 × 8 pixels and eight slices is 1.18 mm a side; 7 × 7 and seven 1.03 mm; 4 × 4 and four 0.59 mm
  levels: [
    { spacing: 1.2, pixels: 8, slices: 8, default: true },
    { spacing: 1, pixels: 7, slices: 7 },
    { spacing: 0.6, pixels: 4, slices: 4 },
  ],
  axes: { x: { source: 0, sign: -1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: -1 } },
  cryoBlocks: [[1, 1477]],
  blankFiles: [],
  emptyFiles: [],
  absentFiles: [],
  // 0293 has a 1,529th row, a copy of its first; its first 1,528 line up with its neighbours'
  tallFiles: ['0293.tiff.gz'],
  // The frame's right edge lies in the block holder's shadow, dark and a little red, which the pixel rule takes for
  // tissue: built without this, the last three columns of 8-pixel cells were body from the top of the frame to the
  // bottom through slices 590 to 1150, a wall joined to the head where the head leaves the frame, and a fourth in part
  frameInset: { right: 32 },
  segmentRule: isTissueOnIce,
  fillsEnclosed: true,
  shortWindowMm: headShortWindowMm,
  // The CAT, 463 slices half a millimetre apart, and of the four MRI series the T2 at 512 × 512, 229 slices a
  // millimetre apart; both taken before the head was frozen
  scans: { ct: { set: 'head-cat-dicom', hounsfieldScale: headCatHounsfieldScale }, mri: { set: 'head-mri-dicom/T2_512' } },
  thumbnails: { set: 'head-cryo-jpeg', extension: '.04.jpg', sheet: [1, 300, 600, 740, 900, 1200, 1477] },
}

export const bodies: readonly Body[] = [male, female, head]

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
