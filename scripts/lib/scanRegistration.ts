// data/<body>/registration.json for a body whose scans are whole grids, as the head's CAT and MRI are: the rigid
// transform that places the CAT on the photographs' grid and the one that places the MRI on the CAT, as the register
// script fitted them and as the volume script reads them (src/volume/rigid.ts has the convention). Each turns about
// its source grid's centre and lands it on its target's, and the centres are recorded here, in millimetres in each
// grid's own frame: the scans' in their patient frames, the photographs' from the first slice's top-left pixel.
//
// The file also holds the hand: whether the CAT's left and right are the photographs' as the body's axes read them,
// or their mirror image, in which case the photographs' columns are mirrored about the grid's centre before the
// transform's result is used. The register script fits under the hand the file holds and never changes it; changing
// it is an edit of this file, together with the body's axes

import { readFile } from 'node:fs/promises'
import type { Triple } from '../../src/volume/format.ts'
import { rigidMap, type Rigid, type RigidMap, type Vec3 } from '../../src/volume/rigid.ts'
import { writeWhole } from './files.ts'
import { registrationPath } from './registration.ts'

export type Hand = 'same' | 'mirrored'
export const hands: readonly Hand[] = ['same', 'mirrored']

interface ScanRecord {
  set: string
  // Columns, rows and slices, the millimetres between them, and the frame of reference the files give
  size: Triple
  spacing: Triple
  frameUID: string
  centreMm: Triple
}

export interface ScanRegistration {
  body: string
  // The day it was fitted, as YYYY-MM-DD
  fitted: string
  hand: Hand
  // The CAT, with what its files' values are multiplied by to give Hounsfield units
  cat: ScanRecord & { hounsfieldScale: number }
  mri: ScanRecord & { sameFrameAsCat: boolean }
  // photographs mm = R · (CAT mm − the CAT's centre) + cryoCentreMm + translationMm
  catToCryo: Rigid & { cryoCentreMm: Triple }
  // CAT mm = R · (MRI mm − the MRI's centre) + the CAT's centre + translationMm
  mriToCat: Rigid
  // The share of the CAT's bone on pale tissue, the Dice overlap of the two silhouettes, and the mutual information
  // of the MRI and the CAT, in nats
  score: number
  bodyScore: number
  mriScore: number
  // Both hands' best fits, bone share and silhouette overlap summed, and the margin one had to beat the other by
  hands: { same: number; mirrored: number; margin: number }
  method: string
  // Set by whoever edits the transform by hand, so the next reader knows it isn't the fit's
  manual: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function record(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  if (!isRecord(value)) throw new Error(`The registration has no ${key}`)
  return value
}

function number(parent: Record<string, unknown>, key: string, where: string): number {
  const value = parent[key]
  if (!isNumber(value)) throw new Error(`${where}'s ${key} isn't a number`)
  return value
}

function triple(parent: Record<string, unknown>, key: string, where: string): Triple {
  const value = parent[key]
  const [a, b, c]: unknown[] = Array.isArray(value) && value.length === 3 ? value : []
  if (!isNumber(a) || !isNumber(b) || !isNumber(c)) throw new Error(`${where}'s ${key} isn't three numbers`)
  return [a, b, c]
}

function text(parent: Record<string, unknown>, key: string, where: string): string {
  const value = parent[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${where} has no ${key}`)
  return value
}

function scanRecord(parent: Record<string, unknown>, key: string): ScanRecord {
  const value = record(parent, key)
  const where = `The registration's ${key}`
  return {
    set: text(value, 'set', where),
    size: triple(value, 'size', where),
    spacing: triple(value, 'spacing', where),
    frameUID: text(value, 'frameUID', where),
    centreMm: triple(value, 'centreMm', where),
  }
}

const isHand = (value: unknown): value is Hand => value === 'same' || value === 'mirrored'

// The parsed JSON as a registration, or a clear error where it isn't one
export function readScanRegistration(json: unknown): ScanRegistration {
  if (!isRecord(json)) throw new Error("The registration isn't an object")
  if (!isHand(json.hand)) throw new Error(`The registration's hand ${JSON.stringify(json.hand)} isn't same or mirrored`)
  const cat = record(json, 'cat')
  const mri = record(json, 'mri')
  const catToCryo = record(json, 'catToCryo')
  const mriToCat = record(json, 'mriToCat')
  const both = record(json, 'hands')
  const scale = number(cat, 'hounsfieldScale', "The registration's cat")
  if (!(scale > 0)) throw new Error(`The registration's cat has a hounsfieldScale of ${scale}`)
  return {
    body: text(json, 'body', 'The registration'),
    fitted: text(json, 'fitted', 'The registration'),
    hand: json.hand,
    cat: { ...scanRecord(json, 'cat'), hounsfieldScale: scale },
    mri: { ...scanRecord(json, 'mri'), sameFrameAsCat: mri.sameFrameAsCat === true },
    catToCryo: {
      rotationDeg: triple(catToCryo, 'rotationDeg', "The registration's catToCryo"),
      translationMm: triple(catToCryo, 'translationMm', "The registration's catToCryo"),
      cryoCentreMm: triple(catToCryo, 'cryoCentreMm', "The registration's catToCryo"),
    },
    mriToCat: {
      rotationDeg: triple(mriToCat, 'rotationDeg', "The registration's mriToCat"),
      translationMm: triple(mriToCat, 'translationMm', "The registration's mriToCat"),
    },
    score: number(json, 'score', 'The registration'),
    bodyScore: number(json, 'bodyScore', 'The registration'),
    mriScore: number(json, 'mriScore', 'The registration'),
    hands: {
      same: number(both, 'same', "The registration's hands"),
      mirrored: number(both, 'mirrored', "The registration's hands"),
      margin: number(both, 'margin', "The registration's hands"),
    },
    method: text(json, 'method', 'The registration'),
    manual: json.manual === true,
  }
}

// The body's registration file, or null where none has been fitted
export async function loadScanRegistration(body: string): Promise<ScanRegistration | null> {
  const path = registrationPath(body)
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  try {
    return readScanRegistration(JSON.parse(content))
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

// Numbers to four decimals, so the file reads cleanly and a refit changes only what moved
const tidy = (value: number) => Number(value.toFixed(4))
const tidied = ([a, b, c]: Triple): Triple => [tidy(a), tidy(b), tidy(c)]

export async function saveScanRegistration(registration: ScanRegistration) {
  const { cat, mri, catToCryo, mriToCat, hands: both } = registration
  const json = {
    ...registration,
    cat: { ...cat, spacing: tidied(cat.spacing), centreMm: tidied(cat.centreMm) },
    mri: { ...mri, spacing: tidied(mri.spacing), centreMm: tidied(mri.centreMm) },
    catToCryo: {
      rotationDeg: tidied(catToCryo.rotationDeg),
      translationMm: tidied(catToCryo.translationMm),
      cryoCentreMm: tidied(catToCryo.cryoCentreMm),
    },
    mriToCat: { rotationDeg: tidied(mriToCat.rotationDeg), translationMm: tidied(mriToCat.translationMm) },
    score: tidy(registration.score),
    bodyScore: tidy(registration.bodyScore),
    mriScore: tidy(registration.mriScore),
    hands: { same: tidy(both.same), mirrored: tidy(both.mirrored), margin: tidy(both.margin) },
  }
  const path = registrationPath(registration.body)
  await writeWhole(path, new TextEncoder().encode(`${JSON.stringify(json, null, 2)}\n`))
  return path
}

// The map from the CAT's patient frame into the photographs' grid, before any mirroring
export const catToCryoMap = (registration: ScanRegistration): RigidMap =>
  rigidMap(registration.catToCryo, registration.cat.centreMm, registration.catToCryo.cryoCentreMm)

// The map from the MRI's patient frame into the CAT's
export const mriToCatMap = (registration: ScanRegistration): RigidMap =>
  rigidMap(registration.mriToCat, registration.mri.centreMm, registration.cat.centreMm)

// A point of the photographs' grid, in its millimetres, as the transforms take it: itself, or under the mirrored
// hand its mirror image across the grid's centre, column for column
export const handed = (hand: Hand, cryoCentreMm: Triple, [x, y, z]: Vec3): Vec3 =>
  hand === 'mirrored' ? [2 * cryoCentreMm[0] - x, y, z] : [x, y, z]
