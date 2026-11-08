import { readBodies, type BodiesFile, type LevelEntry } from './bodies.ts'
import { readVolume, type Volume } from './format.ts'

// The files ship with the site, so they're fetched relative to the page and the build works from any folder
export const bodiesUrl = 'volume/bodies.json'

// Whether an error is an aborted fetch's, which a newer load has taken over from
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

// A level listed in bodies.json whose file this host doesn't have: the finer levels are built only before a deploy
export class NotBuiltError extends Error {
  constructor(level: LevelEntry) {
    super(`The ${level.label} level isn't built on this host`)
    this.name = 'NotBuiltError'
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const httpText = (response: Response) =>
  `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`

// A file the host doesn't have: a 404, or the page itself, which a host that falls back to it (as Vite's dev server
// does) sends for any path it has no file at
const isMissing = (response: Response) =>
  response.status === 404 || (response.ok && (response.headers.get('content-type') ?? '').startsWith('text/html'))

// Fetches the list of bodies and their levels, with a message that says whether the fetch failed or the list was
// refused
export async function loadBodies(signal: AbortSignal): Promise<BodiesFile> {
  let json: unknown
  try {
    const response = await fetch(bodiesUrl, { signal })
    if (!response.ok) throw new Error(httpText(response))
    json = await response.json()
  } catch (error) {
    if (isAbort(error)) throw error
    throw new Error(`Couldn't fetch the list of bodies, ${bodiesUrl}: ${messageOf(error)}`, { cause: error })
  }
  try {
    return readBodies(json)
  } catch (error) {
    throw new Error(`The list of bodies, ${bodiesUrl}, was refused. ${messageOf(error)}`, { cause: error })
  }
}

// gzip's magic bytes. The files are gzipped on disk, but a host may have unzipped one on the way, as a server that
// sends it with a Content-Encoding does, so the bytes say which they are
const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

// The bytes are read whole, so their first two can say whether they're gzipped, then decompressed from a Blob
async function gunzip(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export interface LoadedVolume {
  volume: Volume
  // The file's bytes as fetched, and the milliseconds to decompress them and to read them
  bytes: number
  gunzipMs: number
  readMs: number
}

// Fetches a level's file and reads it, with a message that says whether the fetch failed or the file was refused,
// and a NotBuiltError where the host doesn't have it
export async function loadVolume(level: LevelEntry, signal: AbortSignal): Promise<LoadedVolume> {
  const url = level.file
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const response = await fetch(url, { signal })
    if (isMissing(response)) throw new NotBuiltError(level)
    if (!response.ok) throw new Error(httpText(response))
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (isAbort(error) || error instanceof NotBuiltError) throw error
    throw new Error(`Couldn't fetch the volume file, ${url}: ${messageOf(error)}`, { cause: error })
  }
  const start = performance.now()
  try {
    const raw = isGzip(bytes) ? await gunzip(bytes) : bytes
    const unzipped = performance.now()
    const volume = readVolume(raw)
    const read = performance.now()
    return { volume, bytes: bytes.length, gunzipMs: unzipped - start, readMs: read - unzipped }
  } catch (error) {
    throw new Error(`The volume file, ${url}, was refused. ${messageOf(error)}`, { cause: error })
  }
}
