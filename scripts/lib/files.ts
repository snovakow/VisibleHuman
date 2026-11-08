// Writing files the scripts produce, so a failed run never leaves half a file where a whole one is expected.

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Writes through a temporary name, renamed into place once whole
export async function writeWhole(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}
