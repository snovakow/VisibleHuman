import { readAnglePose, type AnglePose } from './angles.ts'

// The motion library, public/motion/: an index of every pose and motion the page offers, each in a file of its own, so
// that one is added by writing its file and its line in the index. A pose is written by hand as each joint's turn from
// the neutral pose (angles.ts), the same for every body

export interface MotionEntry {
  // Unique in the library
  id: string
  // As the panel lists it
  label: string
  // Relative to the page
  file: string
}

const indexUrl = 'motion/index.json'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (record: Record<string, unknown>, key: string, where: string) => {
  const value = record[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${where} has no ${key}`)
  return value
}

// Reads the index's parsed JSON, throwing a clear error where it isn't one
export function readLibrary(json: unknown): MotionEntry[] {
  if (!isRecord(json) || !Array.isArray(json.motions)) throw new Error('The motion library lists no motions')
  const entries = json.motions.map((value: unknown, n): MotionEntry => {
    const where = `Motion ${n + 1}`
    if (!isRecord(value)) throw new Error(`${where} isn't an object`)
    return { id: text(value, 'id', where), label: text(value, 'label', where), file: text(value, 'file', where) }
  })
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('The motion library names a motion twice')
  return entries
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, signal ? { signal } : {})
  if (!response.ok) throw new Error(`Couldn't fetch ${url}: HTTP ${response.status}`)
  return response.json()
}

export async function loadLibrary(signal?: AbortSignal): Promise<MotionEntry[]> {
  return readLibrary(await fetchJson(indexUrl, signal))
}

export async function loadPose(entry: MotionEntry, signal?: AbortSignal): Promise<AnglePose> {
  return readAnglePose(await fetchJson(entry.file, signal), `The motion ${entry.id}`)
}
