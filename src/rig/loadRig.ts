import type { RigEntry } from '../volume/bodies.ts'
import { readRigFile, type RigFile } from './rigFile.ts'

// Fetches a body's rig file and reads it, with a message that says whether the fetch failed or the file was refused.
// The file is gzipped on disk, but a host may have unzipped it on the way, so its first two bytes say which it is

const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

async function gunzip(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function loadRig(entry: RigEntry, signal: AbortSignal): Promise<RigFile> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const response = await fetch(entry.file, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(`Couldn't fetch the rig file, ${entry.file}: ${messageOf(error)}`, { cause: error })
  }
  try {
    return readRigFile(isGzip(bytes) ? await gunzip(bytes) : bytes)
  } catch (error) {
    throw new Error(`The rig file, ${entry.file}, was refused. ${messageOf(error)}`, { cause: error })
  }
}
