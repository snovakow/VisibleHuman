import { readVolume, type Volume } from './format.ts'

// The volume file ships with the site, so it's fetched relative to the page and the build works from any folder
export const volumeUrl = 'volume/male-4mm.bin'

// Whether an error is an aborted fetch's, which a newer load has taken over from
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Fetches the volume file and reads it, with a message that says whether the fetch failed or the file was refused
export async function loadVolume(signal: AbortSignal): Promise<Volume> {
  let bytes: Uint8Array
  try {
    const response = await fetch(volumeUrl, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (isAbort(error)) throw error
    throw new Error(`Couldn't fetch the volume file, ${volumeUrl}: ${messageOf(error)}`, { cause: error })
  }
  try {
    return readVolume(bytes)
  } catch (error) {
    throw new Error(`The volume file, ${volumeUrl}, was refused. ${messageOf(error)}`, { cause: error })
  }
}
