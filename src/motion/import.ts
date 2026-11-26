import type { AnimationClip, Object3D, Quaternion, Vector3 } from 'three'
import { jointNames, type JointName } from '../rig/rig.ts'
import { poseLength, writeBakedClip, type BakedClip, type BakedNote } from './clip.ts'
import { readSourceRig, restPoseName, restRotations, retargetClip, skeletonOfBones, sourceClipOf, type PastLimits, type SourceRig } from './retarget.ts'

// Bringing a clip in from a file, on the page: a GLB or glTF, an FBX or a BVH, dropped on the page or chosen with the
// Motion folder's Import, read by three's own loaders, its skeleton and every clip in it retargeted onto this rig
// (retarget.ts), and each clip kept as a baked clip, which Save writes out as the library's files are written. The
// loaders are fetched the first time a file is brought in, so a page that never imports never loads them. Whatever
// the file draws, a character's mesh, its materials and its textures, is let go as soon as the bones are read: only
// the bones and the clips are used, and nothing of the file is drawn or kept

export interface ImportedClip {
  // The clip's name in the file
  name: string
  clip: BakedClip
  // The joint that strayed furthest past its limits as retargeted, and the one holding it within them turned most,
  // which the log reports
  past: PastLimits
  held: PastLimits
}

export interface ImportedFile {
  // The file's name, without its extension
  name: string
  // Whose rig the file's names were read as, Mixamo's or the Quaternius library's
  rig: string
  clips: ImportedClip[]
  // The source's rest pose on this rig, with no clip, and the way each of its limbs points at rest, in the scene's
  // axes: for a source resting in a T-pose, this rig's T-pose
  rest: Record<JointName, Quaternion>
  directions: Partial<Record<JointName, Vector3>>
}

// The kinds of file the Import button offers, by extension
export const importExtensions = ['.glb', '.gltf', '.fbx', '.bvh'] as const

interface Loaded {
  root: Object3D
  clips: AnimationClip[]
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

async function load(file: File): Promise<Loaded> {
  const extension = extensionOf(file.name)
  if (extension === '.bvh') {
    const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js')
    const { skeleton, clip } = new BVHLoader().parse(await file.text())
    const [root] = skeleton.bones
    if (!root) throw new Error(`${file.name} holds no bones`)
    return { root, clips: [clip] }
  }
  if (extension === '.fbx') {
    const [{ FBXLoader }, bytes] = await Promise.all([import('three/addons/loaders/FBXLoader.js'), file.arrayBuffer()])
    const group = new FBXLoader().parse(bytes, '')
    return { root: group, clips: group.animations }
  }
  if (extension === '.glb' || extension === '.gltf') {
    const [{ GLTFLoader }, bytes] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), file.arrayBuffer()])
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    return { root: gltf.scene, clips: gltf.animations }
  }
  throw new Error(`${file.name} isn't a file the page can read: it reads ${importExtensions.join(', ')}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const disposable = (value: unknown): value is { dispose: () => void } => isRecord(value) && typeof value.dispose === 'function'

// Lets go of whatever the file would draw with: each mesh's geometry and materials, and every texture they hold
function release(root: Object3D) {
  root.traverse((object) => {
    const geometry: unknown = Reflect.get(object, 'geometry')
    if (disposable(geometry)) geometry.dispose()
    const material: unknown = Reflect.get(object, 'material')
    const materials: unknown[] = Array.isArray(material) ? material : [material]
    for (const each of materials) {
      if (!isRecord(each) || each.isMaterial !== true) continue
      for (const value of Object.values(each)) if (isRecord(value) && value.isTexture === true && disposable(value)) value.dispose()
      if (disposable(each)) each.dispose()
    }
  })
}

// Where each limb of the source points at rest, in the scene's axes, for the log
const restLines = (rig: SourceRig) =>
  jointNames.flatMap((joint) => {
    const entry = rig.directions[joint]
    if (!entry) return []
    const { x, y, z } = entry.direction
    return [`${joint} (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})${entry.to ? '' : ', as its parent'}`]
  })

// Reads a file and retargets every clip in it
export async function importMotionFile(file: File): Promise<ImportedFile> {
  const { root, clips } = await load(file)
  try {
    if (clips.length === 0) throw new Error(`${file.name} holds no clip`)
    const skeleton = skeletonOfBones(root)
    const rig = readSourceRig(skeleton)
    const missing = jointNames.filter((joint) => rig.bones[joint] < 0)
    const leaning = rig.square ? '' : ", its axes leaning from the scene's"
    const lacking = missing.length > 0 ? `; it has no bone for the ${missing.join(', ')}` : ''
    console.info(
      `VisibleHuman: ${file.name} has ${rig.table.source}'s names and rests in ${restPoseName(rig)}${leaning}${lacking}. ` +
        `At rest its limbs point ${restLines(rig).join(', ')}`,
    )
    const read = clips.map((clip): ImportedClip => {
      const source = sourceClipOf(clip)
      // A clip of one moment is held as a pose is
      const timed = source.duration > 0 ? source : { ...source, duration: poseLength, times: [0] }
      const { clip: baked, past, held } = retargetClip(skeleton, timed, rig)
      return { name: clip.name, clip: baked, past, held }
    })
    for (const { name, clip, past, held } of read) {
      const within =
        past.degrees > 0
          ? `, the ${past.joint} ${past.degrees.toFixed(1)}° past its limits at ${past.time.toFixed(2)} s, held within them by turning the ${held.joint} ${held.degrees.toFixed(1)}° at most, at ${held.time.toFixed(2)} s`
          : ', every joint within its limits'
      console.info(`VisibleHuman: ${file.name}'s ${name}, ${clip.duration.toFixed(3)} s${within}`)
    }
    const dot = file.name.lastIndexOf('.')
    const directions: ImportedFile['directions'] = {}
    for (const joint of jointNames) {
      const entry = rig.directions[joint]
      if (entry) directions[joint] = entry.direction
    }
    return { name: dot > 0 ? file.name.slice(0, dot) : file.name, rig: rig.table.source, clips: read, rest: restRotations(skeleton, rig), directions }
  } finally {
    release(root)
  }
}

// A name for a file, from a label: lower case, a dash between words
export const fileNameOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'motion'

// Downloads a baked clip as the library's files are written, to be put in public/motion/ and listed by
// `npm run motion`
export function saveBakedClip(clip: BakedClip, note: BakedNote) {
  const blob = new Blob([writeBakedClip(clip, note)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileNameOf(note.label)}.json`
  link.click()
  // The download has its own hold on the blob once it starts
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The page's file input, which the Import button opens; the drop target lends it
let picker: (() => void) | null = null
export const provideImportPicker = (open: (() => void) | null) => {
  picker = open
}
export const openImportPicker = () => picker?.()
