import { BufferGeometry, Float32BufferAttribute, Matrix4, SkinnedMesh, Uint16BufferAttribute, Vector4, type Material } from 'three'
import { add, attribute, dot, float, length, normalGeometry, positionGeometry, uniform, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { jointNames } from '../../../rig/rig.ts'
import type { CutPlane } from '../../cuts.ts'
import type { MeshSkinning } from '../../../surface/rigSkin.ts'
import type { Posed } from '../../posed.ts'

// The surface's meshes skinned to a posed body's bones: their vertices' skinning set as three's attributes, each mesh
// bound to the rig's skeleton, and the materials' reads of the body's texture made where the scan holds each point,
// not where the pose has moved it, so the flesh keeps its own colour as it moves. A wall's faces lie on each other
// at rest, which would draw a seam inside the body; a wall's material shows them only once the pose has parted the two
// sides there by more than wallOpen, measuring at each vertex the gap between where its own side's skinning and the
// other side's put it

// How far apart a wall's two sides must be, in millimetres, before its faces show
const wallOpen = 0.5
// How near a fragment's wall flag, blended from its triangle's corners, must come to 1 before it counts as a wall's
// face: only where every corner lies on the wall. A triangle that joins the skin to a wall's face, with corners on
// both, is skin wherever it's drawn; hidden from its middle on, as a flag of a half took it, it left a slit along
// every wall where it meets the skin, open to the air behind (498 such pixels at rest from the front, 39 without)
const wholeWall = 0.999

// Where a mesh's point lies in the scan, and the way its surface faces there: its own attributes, before the skinning
// moves them, since the meshes are made in the scene's frame at rest
export const restPosition = positionGeometry
export const restNormal = normalGeometry

// The bones' skinning matrices as a material reads them: one per joint, copied from the posed skeleton's ahead of each
// frame, so a material can skin a vertex by joints three's own skinning doesn't use. The copy runs every frame, a
// motion's included, so it makes nothing
export interface SkinMatrices {
  matrices: Matrix4[]
  node: ReturnType<typeof uniformArray<'mat4'>>
  // Copies the skeleton's matrices, as its last update left them
  copyFrom(posed: Posed): void
}

export function createSkinMatrices(): SkinMatrices {
  const matrices = jointNames.map(() => new Matrix4())
  const node = uniformArray<'mat4'>(matrices, 'mat4')
  return {
    matrices,
    node,
    copyFrom(posed) {
      const from = posed.skeleton.skeleton.boneMatrices
      if (!from) return
      for (let n = 0; n < matrices.length; n++) matrices[n].fromArray(from, n * 16)
    },
  }
}

// The mesh's vertices skinned by the skinning matrices with the joints and shares of the attributes named, as three's
// skinning does, so a vertex's place under its other side's skinning can be measured against its own
function skinnedBy(skin: SkinMatrices, indices: string, shares: string): Node<'vec3'> {
  const index = attribute(indices, 'uvec4')
  const share = attribute(shares, 'vec4')
  const rest = vec4(positionGeometry, 1)
  return add(
    skin.node.element(index.x).mul(rest).mul(share.x),
    skin.node.element(index.y).mul(rest).mul(share.y),
    skin.node.element(index.z).mul(rest).mul(share.z),
    skin.node.element(index.w).mul(rest).mul(share.w),
  ).xyz
}

// Whether a fragment of a mesh with walls is drawn: everywhere but a wall's face its pose hasn't parted
export function wallShown(skin: SkinMatrices): Node<'bool'> {
  const gap = varying(length(skinnedBy(skin, 'skinIndex', 'skinWeight').sub(skinnedBy(skin, 'otherIndex', 'otherWeight'))), 'vWallGap')
  return attribute('wall', 'float').lessThan(float(wholeWall)).or(gap.greaterThan(float(wallOpen)))
}

// The three cuts as a posed mesh's materials test them, at the rest position, where the scan holds each point, rather
// than where the pose has moved it, so a cut stays the same section of the anatomy as the body moves. Each fragment's
// distances inside the three planes are measured at its vertices and carried to it, which is exact, since the rest
// position runs linearly across a triangle; the planes are uniforms set in place, so moving a cut compiles nothing
export interface CutTest {
  // Sets the planes from the cuts, Axial, Coronal and Sagittal, as cutPlanes gives them
  set(planes: readonly [CutPlane, CutPlane, CutPlane]): void
  // Whether a fragment lies inside every plane, or every plane but the one skipped, which a cap lies on
  kept(skip?: 0 | 1 | 2): Node<'bool'>
}

export function createCutTest(): CutTest {
  const planes = [new Vector4(), new Vector4(), new Vector4()] as const
  const nodes = planes.map((plane) => uniform(plane))
  const inside = (n: number) => dot(nodes[n].xyz, positionGeometry).add(nodes[n].w)
  const distances = varying(vec3(inside(0), inside(1), inside(2)), 'vCutDistance')
  const axes = [distances.x, distances.y, distances.z]
  return {
    set(cut) {
      cut.forEach(({ normal, constant }, n) => planes[n].set(normal[0], normal[1], normal[2], constant))
    },
    kept(skip) {
      const tested = axes.filter((_, n) => n !== skip).map((distance) => distance.greaterThanEqual(0))
      return tested.reduce((all, each) => all.and(each))
    },
  }
}

// Sets a geometry's skinning attributes from the worker's arrays: four joints and shares a vertex, and, for a mesh
// with walls, the other side's and which vertices lie on a wall
export function setSkinning(geometry: BufferGeometry, skinning: MeshSkinning) {
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Uint16Array.from(skinning.joints), 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinning.weights, 4))
  if (skinning.otherJoints && skinning.otherWeights && skinning.walls) {
    geometry.setAttribute('otherIndex', new Uint16BufferAttribute(Uint16Array.from(skinning.otherJoints), 4))
    geometry.setAttribute('otherWeight', new Float32BufferAttribute(skinning.otherWeights, 4))
    geometry.setAttribute('wall', new Float32BufferAttribute(Float32Array.from(skinning.walls), 1))
  }
}

// A mesh skinned to the posed body's skeleton, as the scene holds it at rest, so no bind matrix moves it. Its bounds
// would follow the bones only by being measured again, so it's never culled
export function skinnedMesh(geometry: BufferGeometry, material: Material, posed: Posed): SkinnedMesh {
  const mesh = new SkinnedMesh(geometry, material)
  mesh.bind(posed.skeleton.skeleton, new Matrix4())
  mesh.frustumCulled = false
  return mesh
}
