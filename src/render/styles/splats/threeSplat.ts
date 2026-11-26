import { Texture } from 'three'
import { StorageBufferAttribute } from 'three/webgpu'
import type { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'

// What the splats read of three's GaussianSplat beyond what its types declare. Each field is read through a guard, and
// a three that keeps it elsewhere gets the fallback each reader names rather than an error. On a three upgrade, check
// these fields against objects/GaussianSplat.js, gpgpu/CountingSort.js and the fallback's GLSLNodeBuilder.setupPBO:
// `_buffers`, whose fields hold the splat's storage buffers, its centres' among them as `centerRead`, `_sort`, the
// splat's counting sort, whose fields hold its own, `_sortInitialized`, which says whether it has sorted yet, and a
// storage attribute's `pbo`

// The fields of the splat that hold storage buffers, its own and its sort's
const buffersField = '_buffers'
const sortField = '_sort'
// The splat's storage node for its centres, among its buffers, which its shader and its GPU sort both read
const centersField = 'centerRead'
// Whether the splat has sorted, which three clears only on a turn of the view
const sortedField = '_sortInitialized'
// And the field of a storage attribute that holds the texture the WebGL 2 fallback reads it through
const pboField = 'pbo'

// The storage attributes an object holds, as fields of its own or as the value of a storage node it holds
function storageAttributesIn(holder: unknown, into: Set<StorageBufferAttribute>) {
  if (typeof holder !== 'object' || holder === null) return
  for (const field of Object.values(holder)) {
    if (field instanceof StorageBufferAttribute) into.add(field)
    else if (typeof field === 'object' && field !== null) {
      const value: unknown = Reflect.get(field, 'value')
      if (value instanceof StorageBufferAttribute) into.add(value)
    }
  }
}

// Every storage attribute a splat and its sort hold: its centres, covariances and colours, and its sort's order, bins,
// histogram and offsets. None if a later three keeps them elsewhere, which leaves them to the garbage collector again
export function storageAttributesOf(splat: GaussianSplat): StorageBufferAttribute[] {
  const found = new Set<StorageBufferAttribute>()
  storageAttributesIn(Reflect.get(splat, buffersField), found)
  storageAttributesIn(Reflect.get(splat, sortField), found)
  return [...found]
}

// The texture the WebGL 2 fallback reads a storage attribute through, which three makes the first time a shader reads
// the attribute and keeps on it as `pbo`; none on WebGPU, or before a shader has read it
function textureOf(attribute: StorageBufferAttribute): Texture | null {
  const pbo: unknown = Reflect.get(attribute, pboField)
  return pbo instanceof Texture ? pbo : null
}

// Frees what a splat holds on the GPU that three's splat, which has no dispose(), leaves behind: each storage attribute
// by its own dispose(), which is the only thing that frees one no geometry holds, and on the fallback the texture
// each was read through, which disposing the attribute leaves behind
export function freeSplatBuffers(splat: GaussianSplat) {
  for (const attribute of storageAttributesOf(splat)) {
    textureOf(attribute)?.dispose()
    attribute.dispose()
  }
}

// The storage attribute holding the splat's centres, four floats a splat, which its shader reads on WebGPU and its
// GPU sort reads to order the splats; on the WebGL 2 fallback its array, which three swaps for a padded copy when a
// shader first reads it, is what the texture of its centres is made from. None if a later three keeps it elsewhere
export function centersOf(splat: GaussianSplat): StorageBufferAttribute | null {
  const buffers: unknown = Reflect.get(splat, buffersField)
  if (typeof buffers !== 'object' || buffers === null) return null
  const node: unknown = Reflect.get(buffers, centersField)
  if (typeof node !== 'object' || node === null) return null
  const value: unknown = Reflect.get(node, 'value')
  return value instanceof StorageBufferAttribute ? value : null
}

// Marks a storage attribute's new contents for upload: on the fallback, to the texture a shader reads it through, as
// three's counting sort marks its order's; on WebGPU, where a compute pass writes it in place, nothing is needed
export function markForUpload(attribute: StorageBufferAttribute) {
  const texture = textureOf(attribute)
  if (texture) texture.needsUpdate = true
}

// Makes the splat sort again before it's next drawn, as it does only when the view has turned far enough, since the
// splats' depths change with the pose. Where a later three keeps this elsewhere, nothing is forced, and the order
// waits for the view to turn
export function sortAgain(splat: GaussianSplat) {
  if (typeof Reflect.get(splat, sortedField) === 'boolean') Reflect.set(splat, sortedField, false)
}
