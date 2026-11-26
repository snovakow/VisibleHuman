// The motion library's index script: lists every pose and clip under public/motion/ in its index.json, each read by the
// page's own readers, with its kind and a clip's length, keeping what each entry already says, its label and whether
// it's a layer among them. A file added to the folder, as a clip saved from the page after importing it, is listed by
// running it again. Run by `npm run motion`, on Node's own TypeScript.
//
//   --folder PATH   the library's folder, public/motion by default

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { indexLibrary, type FolderFile } from '../src/motion/libraryIndex.ts'
import { writeWhole } from './lib/files.ts'

function options() {
  const { values } = parseArgs({ options: { folder: { type: 'string', default: 'public/motion' } }, strict: true })
  return { folder: values.folder }
}

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path} isn't JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

async function main() {
  const { folder } = options()
  const indexPath = join(folder, 'index.json')
  const names = (await readdir(folder)).filter((name) => name.endsWith('.json') && name !== 'index.json')
  const files: FolderFile[] = []
  for (const name of names) files.push({ name, json: await readJson(join(folder, name)) })
  let before: string | null = null
  try {
    before = await readFile(indexPath, 'utf8')
  } catch {
    before = null
  }
  const indexed = indexLibrary(before === null ? null : JSON.parse(before), files)
  for (const id of indexed.added) console.log(`Added ${id}`)
  for (const id of indexed.dropped) console.log(`Dropped ${id}, whose file is gone`)
  if (indexed.text === before) {
    console.log(`${indexPath} lists the ${files.length} motions already, unchanged`)
    return
  }
  await writeWhole(indexPath, new TextEncoder().encode(indexed.text))
  console.log(`Wrote ${indexPath}, listing ${files.length} motions`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
