// This project's additions to the /deploy skill, which builds a branch's committed files in a temp folder and
// copies the build into the live folder. The skill is shared between projects, so this file names this one's folder
// among the machine's live folders, which git config deploy.liveRoot says where to find, and adds the part of the
// site that npm run build doesn't make.
//
// That part is the finer volume levels, the male's and the female's 2 mm files and the head's 1 mm, which are too
// large to commit, so the build's copy of public/volume/ lacks them. A finer level goes live where the committed
// bodies.json holds its measured entry, which npm run volume writes when it builds the level; the head's 0.6 mm,
// never built, has none. Each is built here as npm run volume builds it, from the built commit's scripts and the
// NLM's images in the data root, and copied in after the rest of the site. A build takes minutes, about 11 for the
// male, 27 for the female and 6 for the head, so it's kept outside the checkout under a key of every committed file
// it depends on, and a later deploy whose files are the same reuses it.
//
//     --data <dir>    the data root the levels are built from, else VHP_DATA, else the volume script's default

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'

// The volume script, whose imports, followed through the built commit, are the modules a level's build runs
const script = 'scripts/build-volume.ts'

const isFile = (path) => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Where built levels are kept between deploys, one file a level, named by the key of what built it: the machine's
// cache folder, never the checkout or the temp folder the skill removes
const cacheFolder = () => {
  const home = process.env.XDG_CACHE_HOME || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : join(homedir(), '.cache'))
  return join(home, 'VisibleHuman', 'levels')
}

// What a level's build depends on, besides the NLM's images, which don't change: the volume script and every module
// it imports, the body's data/<body>/registration.json, and the packages they import, with their own, as
// package-lock.json pins them. All are read from the built commit, so the key is the commit's
function inputsKey(src, bodyId, levelId) {
  const hash = createHash('sha256').update(`${bodyId} ${levelId}\n`)
  const modules = new Set()
  const packages = new Set()
  const visit = (path) => {
    if (modules.has(path)) return
    modules.add(path)
    const text = readFileSync(join(src, path), 'utf8')
    for (const [, from, bare] of text.matchAll(/^\s*(?:import|export)\s+[\w\s{},*$]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)) {
      const spec = from ?? bare
      if (spec.startsWith('.')) visit(posix.join(posix.dirname(path), spec))
      else if (!spec.startsWith('node:')) packages.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'))
    }
  }
  visit(script)
  const registration = `data/${bodyId}/registration.json`
  const files = [...modules, ...(isFile(join(src, registration)) ? [registration] : [])].sort()
  for (const path of files) hash.update(`${path}\n`).update(readFileSync(join(src, path))).update('\n')

  const locked = JSON.parse(readFileSync(join(src, 'package-lock.json'), 'utf8')).packages ?? {}
  const pinned = new Set()
  const pin = (name) => {
    const key = `node_modules/${name}`
    if (pinned.has(key) || !locked[key]) return
    pinned.add(key)
    const { dependencies = {}, optionalDependencies = {} } = locked[key]
    for (const each of Object.keys({ ...dependencies, ...optionalDependencies })) pin(each)
  }
  for (const name of packages) pin(name)
  for (const key of [...pinned].sort()) hash.update(`${key} ${locked[key].version} ${locked[key].integrity ?? ''}\n`)
  return hash.digest('hex').slice(0, 16)
}

// Builds one level in the built commit's folder, which writes it into public/volume/ there, and returns how long it
// took, as the script reports it
function build(src, bodyId, spacing, data, name) {
  const args = [script, '--body', bodyId, '--spacing', spacing, ...(data ? ['--data', data] : [])]
  let output
  try {
    output = execFileSync(process.execPath, args, { cwd: src, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const tail = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n')
    throw new Error(`building ${name} failed, so nothing was copied:\n${tail || error.message}`)
  }
  return /^Took (.+)$/m.exec(output)?.[1] ?? null
}

// Puts a build where later deploys find it, through a temporary name so a stopped run leaves no half file, and drops
// the level's builds from other files
function keep(from, kept, prefix) {
  mkdirSync(dirname(kept), { recursive: true })
  const temporary = `${kept}.${process.pid}.tmp`
  copyFileSync(from, temporary)
  renameSync(temporary, kept)
  for (const name of readdirSync(dirname(kept))) {
    const path = join(dirname(kept), name)
    if (name.startsWith(prefix) && name.endsWith('.bin') && path !== kept) unlinkSync(path)
  }
}

export default {
  liveName: 'visiblehuman',
  options: ['data'],

  steps({ src, out, liveDir, options, dryRun }) {
    const data = options.data ? resolve(options.data.replace(/^~(?=$|\/)/, homedir())) : undefined
    const listed = JSON.parse(readFileSync(join(out, 'volume', 'bodies.json'), 'utf8'))
    const cache = cacheFolder()
    const files = []
    for (const body of listed.bodies) {
      for (const level of body.levels.filter((each) => each.optional && each.bytes)) {
        const name = `the ${body.id}'s ${level.label} level`
        const prefix = `${body.id}-${level.id}-`
        const kept = join(cache, `${prefix}${inputsKey(src, body.id, level.id)}.bin`)
        const built = join(out, level.file)
        if (isFile(kept)) {
          console.log(`Reusing ${name}, built before from the same files`)
        } else if (dryRun) {
          console.log(`Would build ${name} from the NLM's images, as no deploy has from these files`)
          continue
        } else {
          console.log(`Building ${name} from the NLM's images, as no deploy has from these files`)
          const took = build(src, body.id, level.id.replace(/mm$/, ''), data, name)
          keep(join(src, 'public', level.file), kept, prefix)
          console.log(`Built ${name}${took ? ` in ${took}` : ''}`)
        }
        copyFileSync(kept, built)
        const { size } = statSync(built)
        if (size !== level.bytes) {
          console.log(
            `Note: bodies.json records ${name} at ${level.bytes.toLocaleString('en')} bytes, and its build has ` +
              `${size.toLocaleString('en')}; npm run volume rebuilds it in the checkout and records the entry to commit`,
          )
        }
        files.push({ from: built, to: join(liveDir, level.file) })
      }
    }
    return [{ files }]
  },
}
