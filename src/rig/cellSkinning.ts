import { Vector3 } from 'three'
import type { Triple } from '../volume/format.ts'
import type { Level } from '../volume/levels.ts'
import { sourceOfScene, type Bound, type Placement } from './pose.ts'
import { jointNames, skeletonShape, type JointName } from './rig.ts'
import { noChain } from './rigFile.ts'
import { mostJoints, skinningAtSource, type RigGridCells } from './sampling.ts'

// The skinning of a posed body's splat levels, cell by cell, and the pose's arithmetic on their centres: what the
// splats' poser runs on the CPU under the WebGL 2 fallback and its compute pass runs on WebGPU. Pure, so the page
// builds it a share at a time and the tests run it

// Each splat's joints and shares, four a splat as three's skinning takes them, found once for a level, and the sphere
// no pose can carry a splat's centre out of
export interface SplatSkinning {
  joints: Uint8Array<ArrayBuffer>
  weights: Float32Array<ArrayBuffer>
  reach: { center: Triple; radius: number }
}

// A level built for the body posed, by chain, and its cells' skinning
export interface PosedLevel {
  level: Level
  skinning: SplatSkinning
}

// A skinning found a share of the cells at a time: advance takes up to `cells` more and returns the skinning once it
// has every cell, and again on any later call
export interface SkinningBuild {
  advance: (cells: number) => SplatSkinning | null
}

// Each cell skinned as the flesh at its rest centre, on its own chain's side of any wall, as the surface's skin is at a
// vertex, so a cell of the arm beside the chest follows the arm. A cell beyond the rig's reach follows the root. The
// reach: every joint is held to its parent at its offset, and the root where the scan has it, so a point that follows
// one joint stays within its distance from that joint at rest plus the joint's path to the root along the skeleton;
// a blend of joints lies between what each would make of it, so within the farthest
export function skinSplats(level: Pick<Level, 'count' | 'centers' | 'chains'>, file: RigGridCells, placement: Placement, bound: Bound): SplatSkinning {
  const skinning = skinningBuild(level, file, placement, bound).advance(level.count)
  if (!skinning) throw new Error('The skinning took every cell and isn\'t found')
  return skinning
}

export function skinningBuild(level: Pick<Level, 'count' | 'centers' | 'chains'>, file: RigGridCells, placement: Placement, bound: Bound): SkinningBuild {
  const { count, centers, chains } = level
  const joints = new Uint8Array(count * mostJoints)
  const weights = new Float32Array(count * mostJoints)
  const restJoints = jointNames.map((name) => new Vector3().setFromMatrixPosition(bound.bindWorld[name]))
  const path = new Map<JointName, number>()
  for (const name of jointNames) {
    const { parent } = skeletonShape[name]
    path.set(name, parent ? (path.get(parent) ?? 0) + bound.offsets[name].length() : 0)
  }
  const pathOf = jointNames.map((name) => path.get(name) ?? 0)
  const root = bound.offsets.hips
  let radius = 0
  const point = new Vector3()
  let next = 0
  let found: SplatSkinning | null = null
  const advance = (cells: number) => {
    if (found) return found
    const end = Math.min(count, next + cells)
    for (let n = next; n < end; n++) {
      point.fromArray(centers, n * 3)
      const chain = chains?.[n]
      const side = chain !== undefined && chain !== noChain ? chain : undefined
      const own = skinningAtSource(file, sourceOfScene(placement, point), side)
      if (!own) {
        weights[n * mostJoints] = 1
        radius = Math.max(radius, point.distanceTo(root))
        continue
      }
      own.joints.forEach((joint, m) => {
        joints[n * mostJoints + m] = joint
        weights[n * mostJoints + m] = own.weights[m]
        radius = Math.max(radius, point.distanceTo(restJoints[joint]) + pathOf[joint])
      })
    }
    next = end
    if (next < count) return null
    found = { joints, weights, reach: { center: [root.x, root.y, root.z], radius } }
    return found
  }
  return { advance }
}

// Writes each splat's posed centre, its rest centre taken by each of its joints' skinning matrices, sixteen numbers a
// joint in jointNames' order as three's skeleton keeps them, blended by its shares. Written three numbers a splat into
// `positions` and four into `padded` where each is given: the geometry's own centres and the copy a shader reads
export function poseSplats(
  rest: Float32Array,
  skinning: Pick<SplatSkinning, 'joints' | 'weights'>,
  matrices: ArrayLike<number>,
  positions: Float32Array | null,
  padded: Float32Array | null,
) {
  const { joints, weights } = skinning
  const count = rest.length / 3
  for (let n = 0; n < count; n++) {
    const x = rest[n * 3]
    const y = rest[n * 3 + 1]
    const z = rest[n * 3 + 2]
    let px = 0
    let py = 0
    let pz = 0
    for (let m = 0; m < mostJoints; m++) {
      const w = weights[n * mostJoints + m]
      if (w === 0) continue
      const e = joints[n * mostJoints + m] * 16
      px += w * (matrices[e] * x + matrices[e + 4] * y + matrices[e + 8] * z + matrices[e + 12])
      py += w * (matrices[e + 1] * x + matrices[e + 5] * y + matrices[e + 9] * z + matrices[e + 13])
      pz += w * (matrices[e + 2] * x + matrices[e + 6] * y + matrices[e + 10] * z + matrices[e + 14])
    }
    if (positions) {
      positions[n * 3] = px
      positions[n * 3 + 1] = py
      positions[n * 3 + 2] = pz
    }
    if (padded) {
      padded[n * 4] = px
      padded[n * 4 + 1] = py
      padded[n * 4 + 2] = pz
    }
  }
}
