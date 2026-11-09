import { DoubleSide, Mesh, PlaneGeometry } from 'three'
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  Discard,
  Fn,
  If,
  max,
  min,
  normalize,
  positionGeometry,
  step,
  varying,
  vec4,
  viewZToPerspectiveDepth,
} from 'three/tsl'
import type { Node, NodeMaterial } from 'three/webgpu'
import { leastDirection } from './rays.ts'

// The ray quad: one full-screen quad shared by the styles that march or trace the body's 3D texture. Its two triangles
// cover the viewport whatever the camera does, and each fragment builds the camera ray through its pixel, clips it to
// the box the cuts leave and starts it at the near plane, so the camera may be inside the body and no proxy geometry
// is scaled, culled or turned inside out. rays.ts holds the same arithmetic on the CPU, where the tests prove it

// The ray a fragment marches, from the camera through its pixel: where it starts, which way it goes, in the world and
// in view space, and the distances along it at which it enters and leaves the cut box, the entry no nearer than the
// near plane. Every quad style's fragment is a function of these
export interface QuadRay {
  origin: Node<'vec3'>
  direction: Node<'vec3'>
  // The direction in view space, whose z is negative in front of the camera, so that a distance t along the ray has
  // the view depth −t × viewDir.z
  viewDir: Node<'vec3'>
  tEnter: Node<'float'>
  tExit: Node<'float'>
}

// The quad as a mesh of the material, which draws from both sides, since a quad drawn from behind only would be culled
// as the camera turns, and is never frustum-culled, since its vertices are placed in clip space, not in the scene
export function createRayQuad(material: NodeMaterial) {
  material.side = DoubleSide
  // Each corner at its clip-space place, whatever the camera's matrices say
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  const quad = new Mesh(new PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  return quad
}

// A fragment of the quad: the ray through its pixel, clipped to the box between cutMin and cutMax, discarded where it
// misses the box, and otherwise handed to the style's fragment
export function rayQuad(cutMin: Node<'vec3'>, cutMax: Node<'vec3'>, fragment: (ray: QuadRay) => Node<'vec4'>): Node<'vec4'> {
  return Fn(() => {
    // The pixel's place in clip space, from −1 to 1 across and up, from the quad's corners
    const ndc = varying(positionGeometry.xy, 'vQuadNdc')
    // The ray in view space, through the pixel on the far plane, then turned into the world by the camera
    const far = cameraProjectionMatrixInverse.mul(vec4(ndc, 1, 1)).toVar()
    const viewDir = normalize(far.xyz.div(far.w)).toVar()
    const direction = normalize(cameraWorldMatrix.mul(vec4(viewDir, 0)).xyz).toVar()
    const origin = cameraPosition
    // The slab test: along each axis the nearer and the farther of the two faces' crossings, with each component of the
    // direction kept away from zero, so that a face parallel to the ray is never a division by zero
    const nudged = step(0, direction).mul(2).sub(1).mul(max(abs(direction), leastDirection))
    const toLow = cutMin.sub(origin).div(nudged)
    const toHigh = cutMax.sub(origin).div(nudged)
    const nearer = min(toLow, toHigh)
    const farther = max(toLow, toHigh)
    // The ray starts at the latest entry, or at the near plane where that lies within the box
    const tEnter = max(max(max(nearer.x, nearer.y), nearer.z), cameraNear.div(viewDir.z.negate())).toVar()
    const tExit = min(min(farther.x, farther.y), farther.z).toVar()
    If(tExit.lessThan(tEnter), () => {
      Discard()
    })
    return fragment({ origin, direction, viewDir, tEnter, tExit })
  })()
}

// The depth buffer's value for a point at a distance t along a fragment's ray, for a style that writes the depth of
// what it hits, so that what else is drawn composites with it. Writing a depth turns off early-z for the pass on both
// backends, which is why a miss discards before any sampling
export function hitDepth(t: Node<'float'>, viewDir: Node<'vec3'>): Node<'float'> {
  return viewZToPerspectiveDepth(t.mul(viewDir.z), cameraNear, cameraFar)
}
