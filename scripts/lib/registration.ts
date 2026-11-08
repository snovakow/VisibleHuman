// data/<body>/registration.json: how a body's CT slices sit on its cryosections, one 2D similarity per segment, as
// the register script fitted it and as the volume script reads it. A segment is a run of slices that share one CT
// geometry within one cryo block; its similarity maps CT pixel centres to cryo pixel centres (similarity.ts)

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isFlip, type Similarity } from '../../src/volume/similarity.ts'
import { writeWhole } from './files.ts'

export interface Segment extends Similarity {
  // The first and last slice numbers the similarity covers
  slices: readonly [number, number]
  ctPixelMm: number
  dfovMm: number
  // The CT image's size in pixels. The similarity turns about its centre, (size − 1) / 2, with pixel centres counted
  // from 0 at the top-left
  ctSize: readonly [number, number]
  // Over the sample slices: the share of the CT's bone that lands on pale tissue in the photographs, and, where the CT
  // showed the body alone, the Dice overlap of the two body silhouettes
  score: number
  bodyScore?: number
  samples: readonly number[]
}

export interface Registration {
  body: string
  // Which CT set: the male's frozen CT, the female's normal CT
  source: string
  // The day it was fitted, as YYYY-MM-DD
  fitted: string
  cryoPixelMm: number
  segments: Segment[]
}

export const registrationPath = (body: string) => join('data', body, 'registration.json')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function pair(value: unknown, where: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !isNumber(value[0]) || !isNumber(value[1])) {
    throw new Error(`${where} isn't two numbers`)
  }
  return [value[0], value[1]]
}

function number(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key]
  if (!isNumber(value)) throw new Error(`${where}'s ${key} isn't a number`)
  return value
}

function textOf(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${where} has no ${key}`)
  return value
}

function readSegment(value: unknown, where: string): Segment {
  if (!isRecord(value)) throw new Error(`${where} isn't an object`)
  const slices = pair(value.slices, `${where}'s slices`)
  if (!isFlip(value.flip)) throw new Error(`${where}'s flip ${JSON.stringify(value.flip)} isn't none, vertical, horizontal or both`)
  if (!Array.isArray(value.samples) || !value.samples.every(isNumber)) throw new Error(`${where}'s samples aren't numbers`)
  const segment: Segment = {
    slices,
    ctPixelMm: number(value, 'ctPixelMm', where),
    dfovMm: number(value, 'dfovMm', where),
    ctSize: pair(value.ctSize, `${where}'s ctSize`),
    flip: value.flip,
    scale: number(value, 'scale', where),
    rotationDeg: number(value, 'rotationDeg', where),
    tx: number(value, 'tx', where),
    ty: number(value, 'ty', where),
    score: number(value, 'score', where),
    samples: value.samples,
  }
  if (value.bodyScore !== undefined) segment.bodyScore = number(value, 'bodyScore', where)
  return segment
}

// The parsed JSON as a registration, or a clear error where it isn't one
export function readRegistration(json: unknown): Registration {
  if (!isRecord(json)) throw new Error('The registration isn\'t an object')
  if (!Array.isArray(json.segments)) throw new Error('The registration has no segments')
  const segments = json.segments.map((segment: unknown, n) => readSegment(segment, `Segment ${n + 1}`))
  for (let n = 1; n < segments.length; n++) {
    if (segments[n].slices[0] <= segments[n - 1].slices[1]) throw new Error(`Segments ${n} and ${n + 1} overlap or are out of order`)
  }
  return {
    body: textOf(json, 'body', 'The registration'),
    source: textOf(json, 'source', 'The registration'),
    fitted: textOf(json, 'fitted', 'The registration'),
    cryoPixelMm: number(json, 'cryoPixelMm', 'The registration'),
    segments,
  }
}

// The body's registration file, or null where none has been fitted
export async function loadRegistration(body: string): Promise<Registration | null> {
  const path = registrationPath(body)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  try {
    return readRegistration(JSON.parse(text))
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

// Numbers to four decimals, so the file reads cleanly and a refit changes only what moved
const tidy = (value: number) => Number(value.toFixed(4))

export async function saveRegistration(registration: Registration) {
  const path = registrationPath(registration.body)
  const segments = registration.segments.map((segment) => {
    const tidied: Record<string, unknown> = {
      slices: segment.slices,
      ctPixelMm: segment.ctPixelMm,
      dfovMm: segment.dfovMm,
      ctSize: segment.ctSize,
      flip: segment.flip,
      scale: tidy(segment.scale),
      rotationDeg: tidy(segment.rotationDeg),
      tx: tidy(segment.tx),
      ty: tidy(segment.ty),
      score: tidy(segment.score),
    }
    if (segment.bodyScore !== undefined) tidied.bodyScore = tidy(segment.bodyScore)
    tidied.samples = segment.samples
    return tidied
  })
  const json = { ...registration, segments }
  await writeWhole(path, new TextEncoder().encode(`${JSON.stringify(json, null, 2)}\n`))
  return path
}

// The segment a slice falls in, or null where no CT covers it
export function segmentOf(registration: Registration, slice: number): Segment | null {
  return registration.segments.find(({ slices: [first, last] }) => slice >= first && slice <= last) ?? null
}
