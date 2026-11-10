// The fetch script: mirrors the NLM's Visible Human sets into the data root, one folder per set under the NLM's file
// names, and writes manifest.json there to say what each set holds. Run by `npm run fetch`, on Node's own TypeScript.
// Re-running it continues where it stopped: files present at their listed size are skipped, and partial ones resume.
//
//   --set a,b,...   the sets to fetch, by id (scripts/lib/sets.ts), or "all"; by default the core sets, without the
//                   70 mm film scans. head-mri and head-mri-dicom stand for their four series
//   --data PATH     the data root, rather than VHP_DATA or ~/Data/VisibleHuman
//   --dry-run       read the listings and say what a fetch would do, changing nothing
//   --verify        check every file's size against its listing and write the manifest, downloading nothing
//   --md5           with --verify, also compare each file's MD5 with the server's ETag where that's a plain MD5

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { dataRoot, missingRuns, setFolder, writeManifest, type SetRecord } from './lib/data.ts'
import { parseListing, type ListedFile } from './lib/listing.ts'
import { baseUrl, selectSets, wantedFiles, type DataSet, type WantedFile } from './lib/sets.ts'

// Four requests at a time at most, listings and downloads alike, which the mirror serves without limiting
const connections = 4
// A failed request is tried again after a growing pause, attempt × this, four times in all
const attempts = 4
const retryPause = 2000
// A request is given up only when no bytes arrive for this long; a limit on its total time would end a slow but
// steady download of a 37.6 MB TIFF
const stallSeconds = 60
// How often a set's progress is logged while it downloads
const progressSeconds = 10
// S3 gives a single-part upload's MD5 as its ETag; a multipart upload's ETag ends in "-<parts>" and isn't one
const plainMd5 = /^"?([0-9a-f]{32})"?$/i

function options() {
  const { values } = parseArgs({
    options: {
      set: { type: 'string' },
      data: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      md5: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.md5 && !values.verify) throw new Error('--md5 goes with --verify')
  if (values['dry-run'] && values.verify) throw new Error('--dry-run and --verify are separate runs')
  return {
    sets: selectSets(values.set),
    root: dataRoot(values.data),
    dryRun: values['dry-run'],
    verify: values.verify,
    md5: values.md5,
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const log = (text: string) => console.log(`${now()} ${text}`)

function sizeText(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

function durationText(seconds: number) {
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

const setsText = (count: number) => `${count} ${count === 1 ? 'set' : 'sets'}`
const fileUrl = (folder: string, name: string) => `${baseUrl}/${folder}/${encodeURIComponent(name)}`

// Runs work over the items, at most `limit` at a time, in order of starting. Once one fails, no more start, and its
// error is thrown when those under way have settled, so a set that fails leaves nothing running beside the next
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  const failures: unknown[] = []
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      try {
        await work(items[next++])
      } catch (error) {
        failures.push(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failures.length > 0) throw failures[0]
}

// An abort signal that fires once nothing has arrived for stallSeconds; touch() on every chunk puts it off
function stallGuard(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`no bytes arrived for ${stallSeconds} s from ${url}`)),
    stallSeconds * 1000,
  )
  return { signal: controller.signal, touch: () => timer.refresh(), done: () => clearTimeout(timer) }
}

async function retrying<T>(what: string, run: () => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt === attempts) throw new Error(`${what} failed ${attempts} times: ${String(error)}`, { cause: error })
      log(`${what} failed (${String(error)}), so trying again`)
      await pause(retryPause * attempt)
    }
  }
}

async function readListing(folder: string) {
  const url = `${baseUrl}/${folder}/index.html`
  return retrying(`The listing ${url}`, async () => {
    const guard = stallGuard(url)
    try {
      const response = await fetch(url, { signal: guard.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const chunks: Buffer[] = []
      for await (const chunk of response.body) {
        guard.touch()
        chunks.push(Buffer.from(chunk))
      }
      const files = parseListing(Buffer.concat(chunks).toString('utf8'))
      if (files.length === 0) throw new Error('it lists no files')
      return files
    } finally {
      guard.done()
    }
  })
}

const sizeOf = (path: string) =>
  stat(path).then(
    (s) => s.size,
    () => null,
  )

// Where a wanted file stands on disk: present at its listed size, absent, short (a partial under its own name),
// or larger than its listing, which only a fresh download repairs
type State = 'present' | 'absent' | 'short' | 'larger'

async function stateOf(path: string, bytes: number | null): Promise<{ state: State; size: number | null }> {
  const size = await sizeOf(path)
  if (size === null) return { state: 'absent', size }
  if (bytes === null || size === bytes) return { state: 'present', size }
  return { state: size > bytes ? 'larger' : 'short', size }
}

interface Progress {
  received: number
}

// Downloads one file through <name>.part, resuming the part with a Range request when the server answers 206, and
// renames it into place once it's whole and at its listed size. Returns how it went, for the log
async function download(file: WantedFile, folder: string, progress: Progress) {
  const path = join(folder, file.name)
  const part = `${path}.part`
  if (file.bytes === 0) {
    // Listed as empty on the server itself, so there's nothing to ask for
    await writeFile(path, new Uint8Array())
    await rm(part, { force: true })
    return 'empty'
  }
  const url = fileUrl(file.folder, file.name)
  let resumedFrom = 0
  let wholePart = false
  await retrying(`The download ${url}`, async () => {
    let offset = (await sizeOf(part)) ?? 0
    if (file.bytes !== null && offset > file.bytes) {
      await rm(part)
      offset = 0
    }
    if (file.bytes !== null && offset === file.bytes) {
      wholePart = true
      return
    }
    const guard = stallGuard(url)
    const headers: Record<string, string> = { 'accept-encoding': 'identity' }
    if (offset > 0) headers.range = `bytes=${offset}-`
    let handle: FileHandle | null = null
    try {
      const response = await fetch(url, { headers, signal: guard.signal })
      // A range the file doesn't reach, which means it changed on the server: the part is dropped, and the next
      // attempt starts again
      if (response.status === 416) {
        await rm(part, { force: true })
        throw new Error(`HTTP 416 for bytes ${offset} on, so starting again`)
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      let append = false
      if (offset > 0 && response.status === 206) {
        const range = response.headers.get('content-range') ?? ''
        if (!range.startsWith(`bytes ${offset}-`)) {
          await rm(part)
          throw new Error(`asked for bytes ${offset} on, got ${range}, so starting again`)
        }
        append = true
        if (resumedFrom === 0) resumedFrom = offset
      }
      handle = await open(part, append ? 'a' : 'w')
      for await (const chunk of response.body) {
        guard.touch()
        const bytes = Buffer.from(chunk)
        await handle.write(bytes)
        progress.received += bytes.length
      }
    } finally {
      guard.done()
      await handle?.close()
    }
    const size = (await sizeOf(part)) ?? 0
    if (file.bytes !== null && size !== file.bytes) {
      if (size > file.bytes) await rm(part)
      throw new Error(`it ended at ${size} bytes, not the listed ${file.bytes}`)
    }
  })
  await rename(part, path)
  if (wholePart && resumedFrom === 0) return 'the part was already whole'
  return resumedFrom > 0 ? `resumed from byte ${resumedFrom}` : 'whole'
}

async function md5Of(path: string) {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function etagOf(file: WantedFile) {
  const url = fileUrl(file.folder, file.name)
  return retrying(`The HEAD of ${url}`, async () => {
    const guard = stallGuard(url)
    try {
      const response = await fetch(url, { method: 'HEAD', signal: guard.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.headers.get('etag')
    } finally {
      guard.done()
    }
  })
}

// One set's run: read its listings, see what's on disk, then report, verify or download, and give its manifest record
async function runSet(set: DataSet, root: string, mode: { dryRun: boolean; verify: boolean; md5: boolean }) {
  const listings = new Map<string, readonly ListedFile[]>()
  await eachLimited(
    set.sources.flatMap((source) => source.folders),
    connections,
    async (folder) => {
      listings.set(folder, await readListing(folder))
    },
  )
  const { names, files, unlisted, unexpected } = wantedFiles(set, listings)
  const folder = setFolder(root, set.id)
  const listedBytes = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
  if (unexpected.length > 0) {
    const some = unexpected.slice(0, 5).join(', ')
    log(`${set.id}: ${unexpected.length} listed files fall outside the set's names and are left alone: ${some}`)
  }
  if (unlisted.length > 0) {
    const runs = missingRuns(names, new Set(unlisted)).join(', ')
    log(`${set.id}: ${unlisted.length} wanted names aren't listed: ${runs}`)
  }
  if (names.length !== set.expected) log(`${set.id}: ${names.length} names wanted, where ${set.expected} were expected`)

  const states = new Map<string, { state: State; size: number | null }>()
  await eachLimited(files, 16, async (file) => {
    states.set(file.name, await stateOf(join(folder, file.name), file.bytes))
  })
  const toFetch = files.filter((file) => states.get(file.name)?.state !== 'present')
  const fetchBytes = toFetch.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
  const present = new Set(files.filter((file) => states.get(file.name)?.state === 'present').map((file) => file.name))
  const larger = toFetch.filter((file) => states.get(file.name)?.state === 'larger')
  const short = toFetch.filter((file) => states.get(file.name)?.state === 'short')
  log(
    `${set.id}: ${names.length} files (${set.expected} expected), ${sizeText(listedBytes)}; ${present.size} present, ` +
      `${toFetch.length} to fetch (${sizeText(fetchBytes)})` +
      (larger.length > 0 ? `, ${larger.length} larger than listed` : '') +
      (short.length > 0 ? `, ${short.length} short` : ''),
  )
  if (mode.dryRun) return null

  const failed: string[] = []
  let md5: SetRecord['md5']
  if (mode.verify) {
    for (const file of [...larger, ...short]) {
      log(`${set.id}/${file.name} is ${states.get(file.name)?.size} bytes, listed as ${file.bytes}`)
    }
    if (mode.md5) {
      md5 = { matched: 0, unchecked: 0, mismatched: [] }
      const tally = md5
      await eachLimited(
        files.filter((file) => present.has(file.name)),
        connections,
        async (file) => {
          const match = plainMd5.exec((await etagOf(file)) ?? '')
          if (!match) {
            tally.unchecked++
            return
          }
          if ((await md5Of(join(folder, file.name))) === match[1].toLowerCase()) tally.matched++
          else {
            tally.mismatched.push(file.name)
            log(`${set.id}/${file.name}'s MD5 doesn't match the server's ETag; deleting it and fetching repairs it`)
          }
        },
      )
      log(
        `${set.id}: MD5 matched for ${tally.matched}, ${tally.unchecked} have no plain-MD5 ETag, ` +
          `${tally.mismatched.length} mismatched`,
      )
    }
  } else if (toFetch.length > 0) {
    await mkdir(folder, { recursive: true })
    // A file larger than its listing is deleted and fetched whole; a short one under its own name is a partial left by
    // a download that wrote in place, so it becomes the part to resume, unless a part is there already
    for (const file of larger) {
      const size = states.get(file.name)?.size
      log(`${set.id}/${file.name} is ${size} bytes, larger than the listed ${file.bytes}, so fetching it again`)
      await rm(join(folder, file.name))
    }
    for (const file of short) {
      const path = join(folder, file.name)
      if ((await sizeOf(`${path}.part`)) === null) await rename(path, `${path}.part`)
      else await rm(path)
    }
    const progress: Progress = { received: 0 }
    const started = performance.now()
    let fetched = 0
    const report = () => {
      const seconds = (performance.now() - started) / 1000
      const rate = progress.received / Math.max(seconds, 1e-3)
      const left = Math.max(0, fetchBytes - progress.received)
      log(
        `${set.id}: ${fetched} of ${toFetch.length} fetched, ` +
          `${sizeText(progress.received)} of ${sizeText(fetchBytes)}, ${sizeText(rate)}/s` +
          (fetched < toFetch.length && rate > 0 ? `, about ${durationText(left / rate)} left` : ''),
      )
    }
    const ticker = setInterval(report, progressSeconds * 1000)
    try {
      await eachLimited(toFetch, connections, async (file) => {
        try {
          const how = await download(file, folder, progress)
          if (how !== 'whole') log(`${set.id}/${file.name}: ${how}`)
          present.add(file.name)
          fetched++
        } catch (error) {
          failed.push(file.name)
          log(String(error))
        }
      })
    } finally {
      clearInterval(ticker)
    }
    report()
  }

  const missing = new Set(names.filter((name) => !present.has(name)))
  const bytes = files.reduce((sum, file) => sum + (present.has(file.name) ? (file.bytes ?? 0) : 0), 0)
  const record: SetRecord = {
    files: present.size,
    expected: set.expected,
    bytes,
    missing: missingRuns(names, missing),
    complete: missing.size === 0 && present.size === set.expected && (md5?.mismatched.length ?? 0) === 0,
    checked: new Date().toISOString(),
    ...(md5 ? { md5 } : {}),
  }
  const missingText =
    (record.missing.length > 0 ? `, missing ${record.missing.join(', ')}` : '') +
    (md5 && md5.mismatched.length > 0 ? `, MD5 mismatched for ${md5.mismatched.join(', ')}` : '')
  log(
    `${set.id}: ${record.files} of ${record.expected} files, ${sizeText(bytes)}, ` +
      (record.complete ? 'complete' : `incomplete${missingText}`),
  )
  return { record, failed }
}

async function main() {
  const { sets: chosen, root, dryRun, verify, md5 } = options()
  const what = dryRun ? 'A dry run of' : verify ? `Verifying the ${md5 ? 'sizes and MD5s' : 'sizes'} of` : 'Fetching'
  log(`${what} ${setsText(chosen.length)} in ${root}`)
  const started = performance.now()
  const records = new Map<string, SetRecord>()
  const failedSets: string[] = []
  let incomplete = 0
  let failedFiles = 0
  for (const set of chosen) {
    // A set that fails, such as on a listing the server won't give, leaves the others to run and be recorded
    const result = await runSet(set, root, { dryRun, verify, md5 }).catch((error: unknown) => {
      log(`${set.id}: ${String(error)}`)
      failedSets.push(set.id)
      return null
    })
    if (!result) continue
    records.set(set.id, result.record)
    if (!result.record.complete) incomplete++
    failedFiles += result.failed.length
  }
  const seconds = (performance.now() - started) / 1000
  if (failedSets.length > 0) {
    log(`${setsText(failedSets.length)} couldn't be read, so went unrecorded: ${failedSets.join(', ')}`)
    process.exitCode = 1
  }
  if (dryRun) {
    log(`Dry run done in ${durationText(seconds)}; nothing was changed`)
    return
  }
  const path = await writeManifest(root, records)
  const complete = `${records.size - incomplete} of ${setsText(chosen.length)} complete`
  log(`${complete}, in ${durationText(seconds)}; wrote ${path}`)
  if (failedFiles > 0) log(`${failedFiles} downloads failed; running the same command again resumes them`)
  if (incomplete > 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
