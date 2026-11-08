// public/volume/bodies.json, the contract between the volume script and the page: the bodies, and for each the levels
// it can be built at, with the file each is loaded from. The script writes a level's entry when it writes the level's
// file into public/volume/; the page reads the list once and loads a level's file when it's chosen. A level is listed
// whether or not its file is on the host, since the finer ones are built only before a deploy

import type { Triple } from './format.ts'

// Where a level's density comes from: the colour stand-in, or the registered CT
export type DensitySource = 'colour' | 'ct'

export interface LevelEntry {
  // Such as "4mm", unique within the body
  id: string
  // As the panel lists it, such as "4 mm"
  label: string
  // Relative to the page, such as "volume/male-4mm.bin"
  file: string
  // The voxels' spacing along i, j and k, in millimetres
  spacing: Triple
  // The page opens on the default level, which is committed; the others are optional, built before a deploy
  default?: true
  optional?: true
  // Measured when the file was last built, and absent for a level never built: the grid in voxels, the file's bytes
  // as gzipped, the bytes of its RGBA texture, and where its density came from
  size?: Triple
  bytes?: number
  textureBytes?: number
  density?: DensitySource
}

export interface BodyEntry {
  // Such as "male", the id the volume file's header carries
  id: string
  label: string
  // The credit the NLM's terms ask for, naming the body
  credit: string
  levels: LevelEntry[]
}

export interface BodiesFile {
  bodies: BodyEntry[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${where} has no ${key}`)
  return value
}

const isPositive = (value: unknown): value is number => typeof value === 'number' && value > 0

function triple(record: Record<string, unknown>, key: string, where: string): Triple {
  const value = record[key]
  const [a, b, c]: unknown[] = Array.isArray(value) && value.length === 3 ? value : []
  if (!isPositive(a) || !isPositive(b) || !isPositive(c)) throw new Error(`${where}'s ${key} isn't three positive numbers`)
  return [a, b, c]
}

function readLevel(value: unknown, where: string): LevelEntry {
  if (!isRecord(value)) throw new Error(`${where} isn't an object`)
  const id = text(value, 'id', where)
  const at = `${where} ${id}`
  const level: LevelEntry = {
    id,
    label: text(value, 'label', at),
    file: text(value, 'file', at),
    spacing: triple(value, 'spacing', at),
  }
  if (value.default === true) level.default = true
  if (value.optional === true) level.optional = true
  if (value.size !== undefined) level.size = triple(value, 'size', at)
  for (const key of ['bytes', 'textureBytes'] as const) {
    const n = value[key]
    if (n === undefined) continue
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`${at}'s ${key} isn't a byte count`)
    level[key] = n
  }
  const { density } = value
  if (density === 'colour' || density === 'ct') level.density = density
  else if (density !== undefined) throw new Error(`${at}'s density ${JSON.stringify(density)} isn't colour or ct`)
  return level
}

// Reads the parsed JSON, throwing a clear error where it isn't the list the page expects. Every body has exactly one
// default level, which the page opens on
export function readBodies(json: unknown): BodiesFile {
  if (!isRecord(json) || !Array.isArray(json.bodies) || json.bodies.length === 0) {
    throw new Error('The list of bodies has no bodies')
  }
  const bodies = json.bodies.map((value: unknown, n): BodyEntry => {
    if (!isRecord(value)) throw new Error(`Body ${n + 1} isn't an object`)
    const id = text(value, 'id', `Body ${n + 1}`)
    const where = `The ${id}`
    if (!Array.isArray(value.levels) || value.levels.length === 0) throw new Error(`${where} has no levels`)
    const levels = value.levels.map((level: unknown, m) => readLevel(level, `${where}'s level ${m + 1}`))
    const defaults = levels.filter((level) => level.default).length
    if (defaults !== 1) throw new Error(`${where} has ${defaults} default levels, where it needs one`)
    if (new Set(levels.map((level) => level.id)).size !== levels.length) throw new Error(`${where} lists a level twice`)
    return { id, label: text(value, 'label', where), credit: text(value, 'credit', where), levels }
  })
  if (new Set(bodies.map((body) => body.id)).size !== bodies.length) throw new Error('The list names a body twice')
  return { bodies }
}

export function defaultLevel(body: BodyEntry): LevelEntry {
  const level = body.levels.find((candidate) => candidate.default)
  if (!level) throw new Error(`The ${body.id} has no default level`)
  return level
}

// The list with one level's entry replaced by a newly built one's. The body comes with every level it lists, so a
// body new to the list, or a level new to the body, is added in its place; the list's other bodies, and the body's
// other levels as last built, are kept
export function withLevel(file: BodiesFile | null, body: BodyEntry, built: LevelEntry): BodiesFile {
  const bodies = file ? [...file.bodies] : []
  const listed = bodies.find((candidate) => candidate.id === body.id)
  const levels = body.levels.map((level) => {
    if (level.id === built.id) return built
    return listed?.levels.find((candidate) => candidate.id === level.id) ?? level
  })
  const entry: BodyEntry = { id: body.id, label: body.label, credit: body.credit, levels }
  const at = bodies.findIndex((candidate) => candidate.id === body.id)
  if (at < 0) bodies.push(entry)
  else bodies[at] = entry
  return { bodies }
}
