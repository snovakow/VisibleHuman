import { Vector3 } from 'three'
import { sourceOfScene, type Placement } from '../rig/pose.ts'
import { noChain } from '../rig/rigFile.ts'
import { mostJoints, nearestCell, skinningAtSource, type RigGridCells } from '../rig/sampling.ts'
import type { IsosurfaceMesh } from './marchingCubes.ts'

// The skinning of a posed body's meshes, vertex by vertex, as three's skinned meshes take it: four joints a vertex and
// their shares. The skin and the shell follow the flesh about each vertex, blended from the rig file's cells, on the
// vertex's own side of any wall; a wall's vertex also carries the skinning of the side across it, so a material can
// tell how far the wall has opened there and show its faces only once it has. The bone follows its own part alone, the
// joint the flesh about it follows most, so a bone moves rigidly whatever the Bone threshold has meshed of it. Pure, so
// a worker runs it

// A rigid mesh's triangles that join two chains' bones, where one lay against the other in the scan, as a hand's on the
// pelvis: they'd stretch from one to the other as the pose parts them, so they're left out. Each triangle's corners
// are tested by the chain of the joint each follows
export function partedTriangles(indices: Uint32Array, joints: Uint8Array, chainOfJoint: (joint: number) => number): Uint32Array<ArrayBuffer> {
  const kept: number[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const a = chainOfJoint(joints[indices[t] * mostJoints])
    const b = chainOfJoint(joints[indices[t + 1] * mostJoints])
    const c = chainOfJoint(joints[indices[t + 2] * mostJoints])
    if (a === b && b === c) kept.push(indices[t], indices[t + 1], indices[t + 2])
  }
  return Uint32Array.from(kept)
}

export interface MeshSkinning {
  // Four joints a vertex, by their index in jointNames, and their shares
  joints: Uint8Array<ArrayBuffer>
  weights: Float32Array<ArrayBuffer>
  // For the skin and the shell: the side across the wall at each vertex, as joints and shares, which away from a wall
  // are the vertex's own; and 1 where the vertex lies on a wall
  otherJoints?: Uint8Array<ArrayBuffer>
  otherWeights?: Float32Array<ArrayBuffer>
  walls?: Uint8Array<ArrayBuffer>
}

export type SkinningMode = 'blended' | 'rigid'

export function skinMesh(
  mesh: IsosurfaceMesh & { sides?: Uint8Array; walls?: Uint8Array },
  file: RigGridCells,
  placement: Placement,
  mode: SkinningMode,
): MeshSkinning {
  const vertices = mesh.positions.length / 3
  const joints = new Uint8Array(vertices * mostJoints)
  const weights = new Float32Array(vertices * mostJoints)
  const walled = mode === 'blended' && mesh.sides !== undefined && mesh.walls !== undefined
  const otherJoints = walled ? new Uint8Array(vertices * mostJoints) : undefined
  const otherWeights = walled ? new Float32Array(vertices * mostJoints) : undefined
  const point = new Vector3()
  for (let v = 0; v < vertices; v++) {
    point.fromArray(mesh.positions, v * 3)
    const source = sourceOfScene(placement, point)
    const side = mesh.sides && mesh.sides[v] !== noChain ? mesh.sides[v] : undefined
    const onWall = mesh.walls?.[v] === 1
    const own = skinningAtSource(file, source, side, onWall)
    // A vertex beyond the rig's reach, which the meshes' don't come near, follows the root rather than none
    if (!own) {
      weights[v * mostJoints] = 1
      if (otherWeights) otherWeights[v * mostJoints] = 1
      continue
    }
    if (mode === 'rigid') {
      // The joint the cells about the vertex follow most, which needn't be the first they name
      let most = 0
      for (let n = 1; n < own.weights.length; n++) if (own.weights[n] > own.weights[most]) most = n
      joints[v * mostJoints] = own.joints[most]
      weights[v * mostJoints] = 1
      continue
    }
    own.joints.forEach((joint, n) => {
      joints[v * mostJoints + n] = joint
      weights[v * mostJoints + n] = own.weights[n]
    })
    if (!otherJoints || !otherWeights) continue
    // Across the wall: the chain the nearest cell records on the far side, skinned as that chain's flesh
    let across = own
    if (onWall && side !== undefined) {
      const nearest = nearestCell(file, source)
      const cells = file.cells
      const far = nearest < 0 ? noChain : cells.chain[nearest] === side ? cells.otherChain[nearest] : cells.chain[nearest]
      if (far !== noChain) across = skinningAtSource(file, source, far, true) ?? own
    }
    across.joints.forEach((joint, n) => {
      otherJoints[v * mostJoints + n] = joint
      otherWeights[v * mostJoints + n] = across.weights[n]
    })
  }
  const skinning: MeshSkinning = { joints, weights }
  if (otherJoints && otherWeights && mesh.walls) {
    skinning.otherJoints = otherJoints
    skinning.otherWeights = otherWeights
    skinning.walls = mesh.walls.slice()
  }
  return skinning
}
