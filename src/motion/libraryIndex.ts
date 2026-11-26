import { readMotionFile } from './clip.ts'
import { readLibrary } from './library.ts'

// The library's index, public/motion/index.json, made from the files beside it, as `npm run motion` writes it: every
// motion file listed once, by its id, with its kind and, for a clip, its length in seconds, each read by the page's own
// readers, so a file the page couldn't read stops the index being written. An entry already listed keeps every key it
// holds, its label, its short label and whether it's a layer among them, and its place in the list; a file new to the
// index is added after them by its name, its id and label from its own keys where it has them, as a baked clip's file
// has its label, or else from its name; and an entry whose file is gone is dropped. Written a motion to a line, so
// that a file added shows in a diff as one line, and the same files always give the same bytes

export interface FolderFile {
  // The file's name in the folder, as walk.json
  name: string
  // Its parsed JSON
  json: unknown
}

export interface Indexed {
  // The index as written
  text: string
  // The ids added and dropped, for the script to say
  added: string[]
  dropped: string[]
}

// Where the page finds the library's files, relative to the page
const libraryFolder = 'motion/'
const indexName = 'index.json'

// The keys every entry is written with first, in this order, then any others in the order the entry had them
const leadingKeys = ['id', 'label', 'short', 'file', 'kind', 'duration', 'layer']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const stem = (name: string) => name.replace(/\.json$/, '')

function writeEntry(entry: Record<string, unknown>): string {
  const keys = [...leadingKeys.filter((key) => key in entry), ...Object.keys(entry).filter((key) => !leadingKeys.includes(key))]
  return `{ ${keys.map((key) => `${JSON.stringify(key)}: ${JSON.stringify(entry[key])}`).join(', ')} }`
}

export function indexLibrary(index: unknown, files: readonly FolderFile[]): Indexed {
  // The index as it stands, read as the page reads it so that one the page would refuse is refused here, and kept as
  // written so that what the page passes over is kept
  const listed: Record<string, unknown>[] = []
  if (index !== null) {
    readLibrary(index)
    if (isRecord(index) && Array.isArray(index.motions)) for (const entry of index.motions) if (isRecord(entry)) listed.push({ ...entry })
  }
  const motionFiles = files.filter((file) => file.name !== indexName && file.name.endsWith('.json')).toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const byPath = new Map(motionFiles.map((file) => [`${libraryFolder}${file.name}`, file]))

  const entries: Record<string, unknown>[] = []
  const seen = new Set<string>()
  const dropped: string[] = []
  const described = (entry: Record<string, unknown>, file: FolderFile) => {
    const read = readMotionFile(file.json, `The motion ${file.name}`)
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'kind' && key !== 'duration'))
    return read.kind === 'pose' ? { ...rest, kind: read.kind } : { ...rest, kind: read.kind, duration: read.clip.duration }
  }
  for (const entry of listed) {
    const path = typeof entry.file === 'string' ? entry.file : ''
    const file = byPath.get(path)
    if (!file) {
      dropped.push(String(entry.id))
      continue
    }
    if (seen.has(path)) throw new Error(`The index lists ${path} twice`)
    seen.add(path)
    entries.push(described(entry, file))
  }
  const added: string[] = []
  for (const [path, file] of byPath) {
    if (seen.has(path)) continue
    const own = isRecord(file.json) ? file.json : {}
    const id = typeof own.id === 'string' && own.id !== '' ? own.id : stem(file.name)
    const label = typeof own.label === 'string' && own.label !== '' ? own.label : id.replaceAll('-', ' ')
    entries.push(described({ id, label, file: path }, file))
    added.push(id)
  }

  const ids = new Map<unknown, string>()
  for (const entry of entries) {
    const other = ids.get(entry.id)
    if (other !== undefined) throw new Error(`Two motions are named ${String(entry.id)}: ${other} and ${String(entry.file)}`)
    ids.set(entry.id, String(entry.file))
  }
  const text = entries.length === 0 ? '{ "motions": [] }\n' : `{\n  "motions": [\n${entries.map((entry) => `    ${writeEntry(entry)}`).join(',\n')}\n  ]\n}\n`
  // What's written must read as the page reads it
  readLibrary(JSON.parse(text))
  return { text, added, dropped }
}
