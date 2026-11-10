// Writing files the scripts produce, so a failed run never leaves half a file where a whole one is expected.

import { rmSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// The signals a run is stopped by, from the terminal (Ctrl-C) or from another process
const stoppingSignals = ['SIGINT', 'SIGTERM'] as const

// Writes through a temporary name, renamed into place once whole. A write that fails, or a run stopped while it
// writes, takes the temporary file with it, so none is left beside the files it would have replaced; a stopped run
// then stops as the signal asks, once the file is gone
export async function writeWhole(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  const stop = (signal: NodeJS.Signals) => {
    rmSync(temporary, { force: true })
    for (const each of stoppingSignals) process.off(each, stop)
    process.kill(process.pid, signal)
  }
  for (const signal of stoppingSignals) process.on(signal, stop)
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  } finally {
    for (const signal of stoppingSignals) process.off(signal, stop)
  }
}
