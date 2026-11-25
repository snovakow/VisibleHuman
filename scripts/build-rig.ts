// The rig script: builds a body's rig file, public/volume/<body>.rig.bin, from its rig, data/<body>/rig.json, its
// finest built level, whose voxels find the walls where its limbs lie against its trunk and each other, and its
// default level, whose grid the file is on; records the file in public/volume/bodies.json; and draws the previews into
// .cache/preview/rig/: the skeleton over the bone, a close-up of every joint, and the chains in slices across the body
// with their walls. It reports each joint's turn from the neutral pose in the scan, which must lie within the joint's
// limits. Run by `npm run rig`, on Node's own TypeScript.
//
//   --body ID     which body: male or female, the bodies with limbs
//   --previews    draw the skeleton's previews alone, over the body's finest built level, and build nothing

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { defaultLevel, readBodies, withRig, type BodiesFile, type LevelEntry } from '../src/volume/bodies.ts'
import { readVolume, type Volume } from '../src/volume/format.ts'
import { jointNames, limitsOf, readRig, scanAngles, scanFrames, type Rig } from '../src/rig/rig.ts'
import { writeRigFile } from '../src/rig/rigFile.ts'
import { gunzipFile } from './lib/decode.ts'
import { writeWhole } from './lib/files.ts'
import { buildRig } from './lib/rigBuild.ts'
import { drawChainPreview, drawRigPreviews, rigPreviewFolder, type ChainSlice } from './lib/rigPreviews.ts'

const volumeFolder = 'public/volume'
const bodiesPath = join(volumeFolder, 'bodies.json')
const rigPath = (body: string) => join('data', body, 'rig.json')
const rigFileName = (body: string) => `${body}.rig.bin`

// The chains' preview slices: whole, at heights in millimetres along the slices, through the arms against the chest,
// the forearms and hands against the belly and the pelvis, and the thighs against each other; and up close, cropped
// across the body in millimetres, where a limb lies against the trunk or the other leg, to judge each wall against the
// gel beside it. The crops are the male's; a body's own previews show where its limbs lie
const chainHeights = [360, 420, 480, 540, 600, 660, 720, 780, 820, 860, 900, 960, 1040, 1120, 1200, 1300]
const wallCrops: Record<string, ChainSlice[]> = {
  male: [
    { mm: 400, crop: { columns: [90, 260], rows: [60, 280] } },
    { mm: 440, crop: { columns: [90, 260], rows: [60, 280] } },
    { mm: 400, crop: { columns: [420, 590], rows: [60, 280] } },
    { mm: 440, crop: { columns: [420, 590], rows: [60, 280] } },
    { mm: 720, crop: { columns: [130, 300], rows: [140, 360] } },
    { mm: 780, crop: { columns: [130, 300], rows: [140, 360] } },
    { mm: 720, crop: { columns: [390, 560], rows: [140, 360] } },
    { mm: 780, crop: { columns: [390, 560], rows: [140, 360] } },
    { mm: 840, crop: { columns: [160, 330], rows: [140, 360] } },
    { mm: 840, crop: { columns: [360, 530], rows: [140, 360] } },
    { mm: 1000, crop: { columns: [258, 428], rows: [60, 280] } },
    { mm: 1060, crop: { columns: [258, 428], rows: [60, 280] } },
    { mm: 800, crop: { columns: [160, 330], rows: [180, 360] } },
    { mm: 820, crop: { columns: [160, 330], rows: [180, 360] } },
    { mm: 850, crop: { columns: [180, 350], rows: [180, 360] } },
    { mm: 870, crop: { columns: [200, 370], rows: [180, 360] } },
  ],
}

const isFile = async (path: string) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function options() {
  const { values } = parseArgs({
    options: {
      body: { type: 'string' },
      previews: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.body === undefined) throw new Error('--body says which body, as in --body male')
  return { body: values.body, previews: values.previews }
}

const fileOf = (level: LevelEntry) => resolve('public', level.file)
const meanSpacing = (level: LevelEntry) => (level.spacing[0] + level.spacing[1] + level.spacing[2]) / 3

// The body's finest level whose file is on this host, which shows the joints' spaces and the gel between touching
// surfaces best
async function finestBuilt(listed: BodiesFile, body: string): Promise<LevelEntry> {
  const entry = listed.bodies.find((candidate) => candidate.id === body)
  if (!entry) throw new Error(`bodies.json lists no ${body}`)
  const built: LevelEntry[] = []
  for (const level of entry.levels) if (await isFile(fileOf(level))) built.push(level)
  if (built.length === 0) throw new Error(`None of the ${body}'s levels is built on this host`)
  return built.reduce((finest, level) => (meanSpacing(level) < meanSpacing(finest) ? level : finest))
}

async function loadLevel(level: LevelEntry, body: string): Promise<Volume> {
  const volume = readVolume(await gunzipFile(fileOf(level)))
  if (volume.body !== body) throw new Error(`${level.file} holds the ${volume.body}, not the ${body}`)
  return volume
}

// Each joint's turn from the neutral pose in the scan, against its limits. One outside them is a fault in the rig or
// in the limits: the scan's pose is one the body held, so the IK must be able to reach it
function reportAngles(rig: Rig, volume: Volume) {
  const frames = scanFrames(rig, volume.axes)
  const outside: string[] = []
  for (const name of jointNames) {
    const limits = limitsOf(name)
    const angles = scanAngles(frames, name)
    const out = limits ? (['x', 'y', 'z'] as const).filter((axis, n) => angles[n] < limits[axis][0] || angles[n] > limits[axis][1]) : []
    if (out.length > 0) outside.push(`${name} about ${out.join(', ')}`)
    const text = angles.map((angle) => angle.toFixed(1).padStart(7)).join('')
    console.log(`${name.padEnd(14)}${text}${out.length > 0 ? `   outside its limits about ${out.join(', ')}` : ''}`)
  }
  if (outside.length > 0) throw new Error(`The scan's pose lies outside the limits of the ${outside.join('; ')}`)
}

async function main() {
  const start = performance.now()
  const chosen = options()
  const rig = readRig(JSON.parse(await readFile(rigPath(chosen.body), 'utf8')))
  if (rig.body !== chosen.body) throw new Error(`${rigPath(chosen.body)} is the ${rig.body}'s rig`)
  const listed = readBodies(JSON.parse(await readFile(bodiesPath, 'utf8')))
  const finest = await finestBuilt(listed, chosen.body)
  const fine = await loadLevel(finest, chosen.body)
  reportAngles(rig, fine)

  if (!chosen.previews) {
    const body = listed.bodies.find((candidate) => candidate.id === chosen.body)
    if (!body) throw new Error(`bodies.json lists no ${chosen.body}`)
    const grid = await loadLevel(defaultLevel(body), chosen.body)
    console.log(`Finding the walls on the ${finest.label} level and building on the ${defaultLevel(body).label} level's grid`)
    const built = buildRig(rig, fine, grid, (line) => console.log(`  ${line}`))
    const bytes = gzipSync(writeRigFile(built.file), { level: 9 })
    const name = rigFileName(chosen.body)
    await writeWhole(join(volumeFolder, name), bytes)
    const updated = withRig(readBodies(JSON.parse(await readFile(bodiesPath, 'utf8'))), chosen.body, { file: `volume/${name}`, bytes: bytes.length })
    await writeWhole(bodiesPath, new TextEncoder().encode(`${JSON.stringify(updated, null, 2)}\n`))
    console.log(`Wrote ${join(volumeFolder, name)}, ${bytes.length.toLocaleString('en')} bytes, and its entry in ${bodiesPath}`)
    const chainsPath = join(rigPreviewFolder, `${chosen.body}-chains.png`)
    await drawChainPreview(fine, built.fine.chain, built.fine.joined, chainHeights.map((mm) => ({ mm })), chainsPath)
    console.log(`Preview: ${chainsPath}`)
    const crops = wallCrops[chosen.body]
    if (crops) {
      const wallsPath = join(rigPreviewFolder, `${chosen.body}-walls.png`)
      await drawChainPreview(fine, built.fine.chain, built.fine.joined, crops, wallsPath, 2)
      console.log(`Preview: ${wallsPath}`)
    }
  }

  for (const path of await drawRigPreviews(fine, rig)) console.log(`Preview: ${path}`)
  console.log(`Drawn over the ${finest.label} level. Took ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
