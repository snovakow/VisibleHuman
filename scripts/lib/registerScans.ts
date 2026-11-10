// The registration of a body whose scans are whole grids, the head: its CAT fitted to the grid the volume script
// built from the photographs, its MRI fitted to the CAT, and the overlays that show both.
//
// The CAT's start is found from the two heads' principal axes, which leave 24 ways of matching them up; each is
// climbed from at coarse steps, and the best goes on to fine ones. That is done under both hands, against the
// photographs' grid as built and against its mirror image, and both scores are reported. The file's hand is the one
// kept: the one already in data/<body>/registration.json, or on a first fit the grid as built, which is the reading of
// the photographs the body's axes hold. The other hand counts as clearly better only where its best score beats the
// kept hand's by more than the spread, the standard deviation, of the 24 starts' scores under the kept hand; then the
// script stops and writes nothing, since which hand is true is not for a fit to change.
//
// The MRI has its own frame of reference, so the scanner doesn't say where it lies on the CAT; it's fitted by the
// mutual information of the two scans' values, from the two heads' centres with their patient axes matched and from
// the nearest matching of their principal axes, whichever ends higher.
//
// Overlays go to .cache/preview/register/: <body>-axial.png, -coronal.png and -sagittal.png, the grid's middle planes
// at three pixels a voxel with the CAT's bone outlined, magenta where the search started and cyan where it ended; the
// same planes with the MRI beside them under the same outline; and further planes through the forehead, the nose and
// the teeth under each hand, where a head's left and right differ most

import { join } from 'node:path'
import { readVolume, type Volume } from '../../src/volume/format.ts'
import {
  apply,
  identityMatrix,
  invert,
  rigidOf,
  rotationAngle,
  rotationsBetween,
  type RigidMap,
  type Vec3,
} from '../../src/volume/rigid.ts'
import type { Body } from './bodies.ts'
import { setFolder } from './data.ts'
import { gunzipFile, writePng } from './decode.ts'
import { readDicomSeries, type DicomVolume } from './dicom.ts'
import { previewFolder } from './previews.ts'
import { registrationPath } from './registration.ts'
import {
  boneHounsfield,
  catHeadFrame,
  catPoints,
  cryoTarget,
  mriPoints,
  sampleScan,
  scanCentre,
  scoreCat,
  scoreMri,
  searchRigid,
  startMap,
  type CatPoints,
  type CryoTarget,
  type Reach,
  type Stage,
  type Start,
} from './scanFit.ts'
import {
  catToCryoMap,
  handed,
  hands,
  loadScanRegistration,
  mriToCatMap,
  saveScanRegistration,
  type Hand,
  type ScanRegistration,
} from './scanRegistration.ts'

const overlayFolder = join(previewFolder, 'register')
// Each voxel of an overlay is drawn this many pixels across
const overlayScale = 3
const magenta = [255, 0, 255] as const
const cyan = [0, 255, 255] as const

// The steps every start is climbed by, then the steps the best goes on with, and how far a climb may go from its start
const coarse: readonly Stage[] = [
  { degrees: 5, millimetres: 4 },
  { degrees: 2.5, millimetres: 2 },
]
const fine: readonly Stage[] = [
  { degrees: 1, millimetres: 1 },
  { degrees: 0.5, millimetres: 0.5 },
]
const reach: Reach = { degrees: 15, millimetres: 20 }
// A start as it stands, before any step
const noMove = [0, 0, 0, 0, 0, 0]

// The grid the photographs were built into: the body's default level, as the volume script wrote it
async function loadGrid(body: Body) {
  const level = body.levels.find((candidate) => candidate.default) ?? body.levels[0]
  const path = `public/volume/${body.id}-${level.spacing}mm.bin`
  let bytes: Uint8Array
  try {
    bytes = await gunzipFile(path)
  } catch (error) {
    throw new Error(`${path} isn't built yet; npm run volume -- --body ${body.id} --spacing ${level.spacing} builds it`, { cause: error })
  }
  return { path, volume: readVolume(bytes) }
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const spreadOf = (values: readonly number[]) => {
  const centre = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - centre) ** 2)))
}
const fixed = (value: number, places = 3) => value.toFixed(places)

// One hand's fit: every start's coarse score, and the best start climbed on to the fine steps
function fitHand(points: CatPoints, target: CryoTarget) {
  const total = (map: RigidMap) => scoreCat(points, target, map).total
  const starts: Start[] = rotationsBetween(points.frame.axes, target.frame.axes).map((rotation) => ({
    rotation,
    from: points.frame.centroid,
    to: target.frame.centroid,
  }))
  const climbs = starts.map((start) => searchRigid(total, start, coarse, reach))
  const best = climbs.reduce((a, b, n) => (b.score > climbs[a].score ? n : a), 0)
  const found = searchRigid(total, starts[best], [...coarse, ...fine], reach)
  return {
    starts: climbs.map((climb) => climb.score),
    best,
    startMap: startMap(starts[best], noMove),
    found,
    scores: scoreCat(points, target, found.map),
  }
}

// A plane of the grid: along which axis it's cut (0 across the slices' columns, 1 down their rows, 2 along the
// slices), and at which voxel
interface Plane {
  name: string
  axis: 0 | 1 | 2
  index: number
}

// The grid's voxel under a plane's pixel, as fractions of a voxel, and the plane's size in voxels
function planeGeometry(volume: Volume, plane: Plane) {
  const [nx, ny, nz] = volume.size
  const [width, height] = plane.axis === 2 ? [nx, ny] : plane.axis === 1 ? [nx, nz] : [ny, nz]
  const voxel = (a: number, b: number): Vec3 => (plane.axis === 2 ? [a, b, plane.index] : plane.axis === 1 ? [a, plane.index, b] : [plane.index, a, b])
  return { width, height, voxel }
}

// A plane of the photographs' grid in colour, the body's voxels on black, at the overlays' scale
function planeColours(volume: Volume, plane: Plane) {
  const { width, height, voxel } = planeGeometry(volume, plane)
  const [nx, ny] = volume.size
  const data = new Uint8Array(width * overlayScale * height * overlayScale * 3)
  for (let y = 0; y < height * overlayScale; y++) {
    for (let x = 0; x < width * overlayScale; x++) {
      const [i, j, k] = voxel(Math.floor(x / overlayScale), Math.floor(y / overlayScale))
      const from = i + nx * (j + ny * k)
      if (volume.coverage[from] < 128) continue
      const at = (x + width * overlayScale * y) * 3
      data[at] = volume.red[from]
      data[at + 1] = volume.green[from]
      data[at + 2] = volume.blue[from]
    }
  }
  return { width: width * overlayScale, height: height * overlayScale, channels: 3, data }
}

// Where each pixel of a plane's overlay lies in the grid's millimetres: the centre of the pixel's share of its voxel
function pixelPoints(volume: Volume, plane: Plane) {
  const { width, height, voxel } = planeGeometry(volume, plane)
  const { origin, spacing } = volume
  return {
    width: width * overlayScale,
    height: height * overlayScale,
    at: (x: number, y: number): Vec3 => {
      const [i, j, k] = voxel((x + 0.5) / overlayScale - 0.5, (y + 0.5) / overlayScale - 0.5)
      return [origin[0] + i * spacing[0], origin[1] + j * spacing[1], origin[2] + k * spacing[2]]
    },
  }
}

// Draws, onto an image of a plane, the outline of the CAT's bone as a map from the grid's millimetres to the CAT's
// patient frame places it
function drawBone(
  image: { width: number; height: number; data: Uint8Array },
  left: number,
  volume: Volume,
  plane: Plane,
  cat: DicomVolume,
  scale: number,
  toCat: (point: Vec3) => Vec3,
  colour: readonly [number, number, number],
) {
  const { width, height, at } = pixelPoints(volume, plane)
  const bone = new Uint8Array(width * height)
  const air = -1000 / scale
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (sampleScan(cat, toCat(at(x, y)), air) * scale >= boneHounsfield) bone[x + width * y] = 1
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bone[x + width * y] === 0) continue
      const edge =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        bone[x - 1 + width * y] === 0 || bone[x + 1 + width * y] === 0 || bone[x + width * (y - 1)] === 0 || bone[x + width * (y + 1)] === 0
      if (edge) image.data.set(colour, (left + x + image.width * y) * 3)
    }
  }
}

// The planes drawn: the grid's three middle planes, then planes named by the slice or the row of the photographs
// they pass through, where the forehead's sinuses, the nose's septum and the teeth are
function planesOf(body: Body, volume: Volume): { middle: Plane[]; telling: Plane[] } {
  const [nx, ny, nz] = volume.size
  const { origin, spacing } = volume
  const layerOf = (slice: number) => Math.round(((slice - body.firstSlice) * body.sliceSpacing - origin[2]) / spacing[2])
  const rowOf = (row: number) => Math.round((row * body.pixelSize - origin[1]) / spacing[1])
  const within = (index: number, count: number) => Math.max(0, Math.min(count - 1, index))
  return {
    middle: [
      { name: 'axial', axis: 2, index: Math.floor(nz / 2) },
      { name: 'coronal', axis: 1, index: Math.floor(ny / 2) },
      { name: 'sagittal', axis: 0, index: Math.floor(nx / 2) },
    ],
    telling: [
      ...[560, 640, 880, 1200].map((slice): Plane => ({ name: `axial-${slice}`, axis: 2, index: within(layerOf(slice), nz) })),
      ...[200, 330].map((row): Plane => ({ name: `coronal-row${row}`, axis: 1, index: within(rowOf(row), ny) })),
    ],
  }
}

// The MRI's values along a plane of the grid, in grey from black at no signal to white at the scan's 99th percentile
function planeMri(volume: Volume, plane: Plane, mri: DicomVolume, top: number, toMri: (point: Vec3) => Vec3) {
  const { width, height, at } = pixelPoints(volume, plane)
  const data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grey = Math.max(0, Math.min(255, Math.round((255 * sampleScan(mri, toMri(at(x, y)), 0)) / top)))
      data.fill(grey, (x + width * y) * 3, (x + width * y) * 3 + 3)
    }
  }
  return { width, height, channels: 3, data }
}

interface Drawn {
  volume: Volume
  cat: DicomVolume
  mri: DicomVolume
  scale: number
  mriTop: number
  cryoCentre: Vec3
}

// Writes a plane's overlay: the CAT's bone outline on the photographs' plane, the start's in magenta where one is
// given and the fit's in cyan; and, where an MRI map is given, the MRI's plane beside it under the fit's outline
async function drawPlane(
  body: Body,
  drawn: Drawn,
  plane: Plane,
  hand: Hand,
  fitted: RigidMap,
  start: RigidMap | null,
  mriToCat: RigidMap | null,
  suffix = '',
) {
  const { volume, cat, mri, scale, mriTop, cryoCentre } = drawn
  const toCat = (map: RigidMap) => {
    const back = invert(map)
    return (point: Vec3) => apply(back, handed(hand, cryoCentre, point))
  }
  const colours = planeColours(volume, plane)
  const paths: string[] = []
  const overlay = { ...colours, data: colours.data.slice() }
  if (start) drawBone(overlay, 0, volume, plane, cat, scale, toCat(start), magenta)
  drawBone(overlay, 0, volume, plane, cat, scale, toCat(fitted), cyan)
  const path = join(overlayFolder, `${body.id}-${plane.name}${suffix}.png`)
  await writePng(path, overlay)
  paths.push(path)
  if (mriToCat) {
    const catToMri = invert(mriToCat)
    const fromGrid = toCat(fitted)
    const scan = planeMri(volume, plane, mri, mriTop, (point) => apply(catToMri, fromGrid(point)))
    const gap = 6
    const pair = { width: colours.width * 2 + gap, height: colours.height, channels: 3, data: new Uint8Array((colours.width * 2 + gap) * colours.height * 3) }
    for (let y = 0; y < colours.height; y++) {
      pair.data.set(colours.data.subarray(y * colours.width * 3, (y + 1) * colours.width * 3), y * pair.width * 3)
      pair.data.set(scan.data.subarray(y * scan.width * 3, (y + 1) * scan.width * 3), (y * pair.width + colours.width + gap) * 3)
    }
    drawBone(pair, 0, volume, plane, cat, scale, fromGrid, cyan)
    drawBone(pair, colours.width + gap, volume, plane, cat, scale, fromGrid, cyan)
    const mriPath = join(overlayFolder, `${body.id}-mri-${plane.name}${suffix}.png`)
    await writePng(mriPath, pair)
    paths.push(mriPath)
  }
  return paths
}

const scanRecord = (set: string, scan: DicomVolume) => ({
  set,
  size: scan.size,
  spacing: scan.spacing,
  frameUID: scan.frameUID,
  centreMm: scanCentre(scan),
})

const describe = (name: string, scan: DicomVolume) =>
  `${name}: ${scan.size.join(' × ')} voxels at ${scan.spacing.map((value) => fixed(value)).join(' × ')} mm, ${scan.position}, frame ${scan.frameUID}` +
  (scan.absent.length > 0 ? `, layers ${scan.absent.join(', ')} absent and filled from their neighbours` : '')

export async function registerScans(body: Body, root: string, preview: boolean) {
  const { scans } = body
  if (!scans) throw new Error(`The ${body.id} has no whole scans to register`)
  const started = performance.now()
  const { path: gridPath, volume } = await loadGrid(body)
  const scale = scans.ct.hounsfieldScale
  console.log(`Reading the ${body.id}'s CAT from ${setFolder(root, scans.ct.set)} and its MRI from ${setFolder(root, scans.mri.set)}`)
  const cat = await readDicomSeries(root, scans.ct.set)
  const mri = await readDicomSeries(root, scans.mri.set)
  console.log(describe('CAT', cat))
  console.log(describe('MRI', mri))
  console.log(`Photographs: ${gridPath}, ${volume.size.join(' × ')} voxels at ${volume.spacing.map((value) => fixed(value)).join(' × ')} mm`)

  const saved = await loadScanRegistration(body.id)
  const stackMm = (body.lastSlice - body.firstSlice + 1) * body.sliceSpacing
  const points = catPoints(cat, scale, stackMm)
  const targets = { same: cryoTarget(volume, false), mirrored: cryoTarget(volume, true) }
  const forMri = mriPoints(mri)
  const drawn: Drawn = { volume, cat, mri, scale, mriTop: forMri.top, cryoCentre: targets.same.centre }
  const { middle, telling } = planesOf(body, volume)

  if (preview) {
    if (!saved) throw new Error(`No registration to preview; npm run register -- --body ${body.id} fits one`)
    const fitted = catToCryoMap(saved)
    const scores = scoreCat(points, targets[saved.hand], fitted)
    const information = scoreMri(forMri, cat, scale, mriToCatMap(saved))
    console.log(
      `As saved, ${saved.hand} hand${saved.manual ? ', edited by hand' : ''}: bone share ${fixed(scores.bone)}, silhouette Dice ${fixed(scores.body)}, ` +
        `MRI mutual information ${fixed(information)}`,
    )
    // The start a fit would climb from, to show how far the saved transform is from it
    const start = fitHand(points, targets[saved.hand]).startMap
    for (const plane of [...middle, ...telling]) {
      for (const path of await drawPlane(body, drawn, plane, saved.hand, fitted, start, mriToCatMap(saved))) console.log(`Overlay: ${path}`)
    }
    return
  }

  if (saved?.manual) {
    throw new Error(
      `${registrationPath(body.id)} says its transform was edited by hand, and a fit would replace it; ` +
        'set its "manual" to false to fit again, or run with --preview to draw it as it stands',
    )
  }
  const kept: Hand = saved?.hand ?? 'same'
  console.log(
    `CAT bone points: ${(points.bone.length / 3).toLocaleString('en')}, silhouette points: ${points.head.length.toLocaleString('en')}; ` +
      `the ${kept} hand is kept${saved ? `, as data/${body.id}/registration.json holds it` : ', the grid as built'}`,
  )
  const fits = { same: fitHand(points, targets.same), mirrored: fitHand(points, targets.mirrored) }
  for (const hand of hands) {
    const fit = fits[hand]
    console.log(
      `${hand} hand: the 24 starts' scores ${fit.starts.map((score) => fixed(score, 2)).join(' ')}; start ${fit.best + 1} taken, ` +
        `${fixed(fit.starts[fit.best])} at the coarse steps and ${fixed(fit.found.score)} at the fine (bone share ${fixed(fit.scores.bone)}, ` +
        `silhouette Dice ${fixed(fit.scores.body)}), moved ${fit.found.moved.map((value) => fixed(value, 1)).join(', ')} from its start` +
        `${fit.found.atEdge ? ', to the edge of the search' : ''}, ${fit.found.evaluations} evaluations`,
    )
  }
  const other: Hand = kept === 'same' ? 'mirrored' : 'same'
  const margin = spreadOf(fits[kept].starts)
  const lead = fits[other].found.score - fits[kept].found.score
  console.log(
    `Hands: ${kept} ${fixed(fits[kept].found.score)}, ${other} ${fixed(fits[other].found.score)}; the margin, the spread of the ${kept} ` +
      `hand's 24 starts, is ${fixed(margin)}; the ${other} hand ${lead > 0 ? 'leads' : 'trails'} by ${fixed(Math.abs(lead))}`,
  )
  // Both hands' fits on the planes where a head's two sides differ, so the eye can judge what the scores say
  for (const hand of hands) {
    for (const plane of telling) {
      for (const path of await drawPlane(body, drawn, plane, hand, fits[hand].found.map, null, null, `-${hand}`)) console.log(`Overlay: ${path}`)
    }
  }
  if (lead > margin) {
    throw new Error(
      `The ${other} hand scores clearly better than the ${kept} hand the registration keeps, by ${fixed(lead)} against a margin of ` +
        `${fixed(margin)}. Nothing is written: which side is the subject's right is a reading of the photographs, changed by ` +
        `editing the hand in data/${body.id}/registration.json and the body's axes together`,
    )
  }
  const fit = fits[kept]

  // The MRI on the CAT: from the two heads' centres with the patient axes matched, and from the nearest matching of
  // their principal axes
  const catFrame = catHeadFrame(cat, scale)
  const information = (map: RigidMap) => scoreMri(forMri, cat, scale, map)
  const nearest = rotationsBetween(forMri.frame.axes, catFrame.axes).reduce((a, b) => (rotationAngle(b) < rotationAngle(a) ? b : a))
  const mriStarts: Start[] = [identityMatrix, nearest].map((rotation) => ({ rotation, from: forMri.frame.centroid, to: catFrame.centroid }))
  const mriFits = mriStarts.map((start) => searchRigid(information, start, [...coarse, ...fine], reach))
  const mriFit = mriFits[0].score >= mriFits[1].score ? mriFits[0] : mriFits[1]
  console.log(
    `MRI on the CAT: frames ${mri.frameUID === cat.frameUID ? 'match' : 'differ'}; mutual information ${fixed(information(startMap(mriStarts[0], noMove)))} ` +
      `at the start, ${mriFits.map((found) => fixed(found.score)).join(' and ')} from the two starts (the second's axes ${fixed(rotationAngle(nearest), 1)}° ` +
      `from the patient's); the ${mriFit === mriFits[0] ? 'first' : 'second'} taken, moved ${mriFit.moved.map((value) => fixed(value, 1)).join(', ')}` +
      (mriFit.atEdge ? ', to the edge of the search' : ''),
  )

  const catCentre = scanCentre(cat)
  const mriCentre = scanCentre(mri)
  const registration: ScanRegistration = {
    body: body.id,
    fitted: new Date().toISOString().slice(0, 10),
    hand: kept,
    cat: { ...scanRecord(scans.ct.set, cat), hounsfieldScale: scale },
    mri: { ...scanRecord(scans.mri.set, mri), sameFrameAsCat: mri.frameUID === cat.frameUID },
    catToCryo: { ...rigidOf(fit.found.map, catCentre, targets.same.centre), cryoCentreMm: targets.same.centre },
    mriToCat: rigidOf(mriFit.map, mriCentre, catCentre),
    score: fit.scores.bone,
    bodyScore: fit.scores.body,
    mriScore: mriFit.score,
    hands: { same: fits.same.found.score, mirrored: fits.mirrored.found.score, margin },
    method: 'principal axes, then a stepwise search; the MRI by mutual information',
    manual: false,
  }
  const path = await saveScanRegistration(registration)
  for (const plane of [...middle, ...telling]) {
    for (const drawnPath of await drawPlane(body, drawn, plane, kept, fit.found.map, fit.startMap, mriFit.map)) console.log(`Overlay: ${drawnPath}`)
  }
  const { rotationDeg, translationMm } = registration.catToCryo
  console.log(
    `CAT to photographs: rotation ${rotationDeg.map((value) => fixed(value, 2)).join(', ')}°, translation ` +
      `${translationMm.map((value) => fixed(value, 2)).join(', ')} mm; bone share ${fixed(fit.scores.bone)}, silhouette Dice ${fixed(fit.scores.body)}`,
  )
  console.log(
    `MRI to CAT: rotation ${registration.mriToCat.rotationDeg.map((value) => fixed(value, 2)).join(', ')}°, translation ` +
      `${registration.mriToCat.translationMm.map((value) => fixed(value, 2)).join(', ')} mm; mutual information ${fixed(mriFit.score)}`,
  )
  console.log(`Wrote ${path} in ${Math.round((performance.now() - started) / 1000)} s`)
}
