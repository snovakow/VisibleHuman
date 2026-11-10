// The data root, where the NLM's sets are kept outside the repository: one folder per set, and manifest.json, which
// the fetch script writes to say what each set holds.

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { sets } from './sets.ts'

const defaultRoot = join(homedir(), 'Data', 'VisibleHuman')
const manifestName = 'manifest.json'

// What one set holds, as the last fetch or verify found it
export interface SetRecord {
  files: number
  expected: number
  bytes: number
  // The wanted names not present at their listed size, as runs in the set's order
  missing: string[]
  complete: boolean
  checked: string
  // Where --md5 ran: files whose MD5 matched the server's ETag, files with no plain-MD5 ETag to match, and mismatches
  md5?: { matched: number; unchecked: number; mismatched: string[] }
}

interface Manifest {
  root: string
  checked: string
  sets: Record<string, SetRecord>
}

// The root from --data, else VHP_DATA, else ~/Data/VisibleHuman
export function dataRoot(flag?: string) {
  const chosen = flag ?? process.env.VHP_DATA
  return chosen === undefined || chosen === '' ? defaultRoot : resolve(chosen)
}

export const setFolder = (root: string, id: string) => join(root, ...id.split('/'))

// A file of a set, which a build script needs; one that isn't there is an error that says how to fetch it
export async function requireDataFile(root: string, id: string, name: string) {
  const path = join(setFolder(root, id), name)
  try {
    await access(path)
  } catch {
    throw new Error(`${path} is missing; npm run fetch -- --set ${id} --data ${root} fetches it`)
  }
  return path
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function isSetRecord(value: unknown): value is SetRecord {
  return (
    isRecord(value) &&
    typeof value.files === 'number' &&
    typeof value.expected === 'number' &&
    typeof value.bytes === 'number' &&
    Array.isArray(value.missing) &&
    value.missing.every((run) => typeof run === 'string') &&
    typeof value.complete === 'boolean' &&
    typeof value.checked === 'string'
  )
}

function isManifest(value: unknown): value is Manifest {
  return (
    isRecord(value) &&
    typeof value.root === 'string' &&
    typeof value.checked === 'string' &&
    isRecord(value.sets) &&
    Object.values(value.sets).every(isSetRecord)
  )
}

// The manifest, or null where there's none yet; one that can't be read or isn't a manifest is an error, not something
// to overwrite
async function readManifest(root: string): Promise<Manifest | null> {
  const path = join(root, manifestName)
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  if (!isManifest(value)) throw new Error(`${path} isn't a manifest this script wrote`)
  return value
}

// Writes the records given over any older ones, keeps the other sets' records, and lists them in the table's order.
// Through a temporary name, so a failed write never leaves half a manifest
export async function writeManifest(root: string, records: ReadonlyMap<string, SetRecord>) {
  const older = (await readManifest(root))?.sets ?? {}
  const merged: Record<string, SetRecord> = {}
  for (const { id } of sets) {
    const record = records.get(id) ?? older[id]
    if (record) merged[id] = record
  }
  const manifest: Manifest = { root, checked: new Date().toISOString(), sets: merged }
  const path = join(root, manifestName)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(temporary, path)
  return path
}

// The missing names as runs of neighbours in the set's order, such as "avf2328c.png–avf2329b.png"
export function missingRuns(names: readonly string[], missing: ReadonlySet<string>) {
  const runs: string[] = []
  for (let n = 0; n < names.length; n++) {
    if (!missing.has(names[n])) continue
    let end = n
    while (end + 1 < names.length && missing.has(names[end + 1])) end++
    runs.push(end === n ? names[n] : `${names[n]}–${names[end]}`)
    n = end
  }
  return runs
}
