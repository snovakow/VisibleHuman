import { Sphere, Vector3 } from 'three'
import type { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { add, Fn, instanceIndex, storage, vec4 } from 'three/tsl'
import { StorageBufferAttribute, type ComputeNode, type WebGPURenderer } from 'three/webgpu'
import { mostJoints } from '../../../rig/sampling.ts'
import type { Posed } from '../../posed.ts'
import { createSkinMatrices } from '../surface/posed.ts'
import { poseSplats, type SplatSkinning } from '../../../rig/cellSkinning.ts'
import { centersOf, markForUpload, sortAgain } from './threeSplat.ts'

// The poser: moves a posed body's splat to the pose its bones stand in, whenever they've turned. Each splat moves with
// the joints and shares found for it once, and only its centre moves, since the splats are round and a turn leaves a
// round splat as it was. The cell table and the cuts go on reading the level's rest centres, so a cut stays the same
// section of the anatomy, and the splat is drawn from a copy of them that the poser writes.
//
// On WebGPU the centres are a storage buffer that the splat's shader and its sort's compute both read, so a compute pass
// skins the rest centres into it. On the WebGL 2 fallback the shader reads them from a texture over a padded copy of
// the buffer's array, and the sort runs on the CPU over the geometry's own centres, so the poser writes both and marks
// the texture for upload. Either way the splat is made to sort again, since the pose has moved what lies in front

// The workgroup three's splat runs its own passes in
const workgroupSize = 256

export interface SplatPoser {
  // Writes the posed centres if the bones have turned since the last write, or the body has been bound again, and
  // says whether it did
  pose(posed: Posed): boolean
  // Frees what the poser made for the GPU
  dispose(): void
}

// The poser for a splat built from rest centres, with the skinning found for them. The splat's sphere is set to the
// rig's reach, grown by a splat's own extent, which no pose carries a splat past: three culls the splat by it and
// spreads its sort's depths across it
export function createSplatPoser(
  splat: GaussianSplat,
  rest: Float32Array,
  skinning: SplatSkinning,
  splatRadius: number,
  renderer: WebGPURenderer,
  webgpu: boolean,
): SplatPoser {
  const { center, radius } = skinning.reach
  splat.boundingSphere = new Sphere(new Vector3(...center), radius + splatRadius)
  const centers = centersOf(splat)
  const count = rest.length / 3
  // The binding and its count of turns the centres were last written for
  let posedLast: Posed | null = null
  let turns = -1

  // On WebGPU, the compute pass and its buffers
  let gpu: { node: ComputeNode; attributes: StorageBufferAttribute[]; matrices: ReturnType<typeof createSkinMatrices> } | null = null
  if (webgpu && centers) {
    const rest4 = new Float32Array(count * 4)
    for (let n = 0; n < count; n++) rest4.set(rest.subarray(n * 3, n * 3 + 3), n * 4)
    const restAttribute = new StorageBufferAttribute(rest4, 4)
    const jointsAttribute = new StorageBufferAttribute(Uint32Array.from(skinning.joints), mostJoints)
    const weightsAttribute = new StorageBufferAttribute(skinning.weights.slice(), mostJoints)
    const restRead = storage(restAttribute, 'vec4', count).toReadOnly()
    const jointsRead = storage(jointsAttribute, 'uvec4', count).toReadOnly()
    const weightsRead = storage(weightsAttribute, 'vec4', count).toReadOnly()
    const centersWrite = storage(centers, 'vec4', count)
    const matrices = createSkinMatrices()
    const node = Fn(() => {
      const at = vec4(restRead.element(instanceIndex).xyz, 1).toVar()
      const joint = jointsRead.element(instanceIndex).toVar()
      const share = weightsRead.element(instanceIndex).toVar()
      const posed = add(
        matrices.node.element(joint.x).mul(at).mul(share.x),
        matrices.node.element(joint.y).mul(at).mul(share.y),
        matrices.node.element(joint.z).mul(at).mul(share.z),
        matrices.node.element(joint.w).mul(at).mul(share.w),
      )
      centersWrite.element(instanceIndex).assign(vec4(posed.xyz, 0))
    })().compute(count, [workgroupSize])
    gpu = { node, attributes: [restAttribute, jointsAttribute, weightsAttribute], matrices }
  }

  return {
    pose(posed) {
      if (posed === posedLast && posed.turns === turns) return false
      posedLast = posed
      turns = posed.turns
      if (gpu) {
        gpu.matrices.copyFrom(posed)
        void renderer.compute(gpu.node)
      } else {
        const matrices = posed.skeleton.skeleton.boneMatrices
        if (!matrices) return false
        // The geometry's centres, which the CPU sort reads, and the shader's padded copy, which three may have
        // swapped in since the last write, so it's read again each time
        const positions = splat.splatGeometry.getAttribute('position').array
        const padded = centers?.array
        poseSplats(
          rest,
          skinning,
          matrices,
          positions instanceof Float32Array ? positions : null,
          padded instanceof Float32Array ? padded : null,
        )
        if (centers) markForUpload(centers)
      }
      sortAgain(splat)
      return true
    },
    dispose() {
      if (!gpu) return
      gpu.node.dispose()
      for (const attribute of gpu.attributes) attribute.dispose()
      gpu = null
    },
  }
}
