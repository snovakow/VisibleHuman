import { Vector3 } from 'three'
import {
  abs,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  dot,
  float,
  fog,
  If,
  max,
  rangeFogFactor,
  renderGroup,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { Triple } from '../volume/format.ts'

// The depth cue every style shares: the far side of the body darkened, from none at its nearest point to the cue's
// share at its farthest, so that near and far read apart in a body one can see through. The splats multiply it into
// their colour, the volume into each step and the raytrace into each hit, and the surface's meshes take it as the
// scene's fog, so the cue reaches the styles by two routes: a material either takes the scene's fog or applies the cue
// itself and turns the fog off. PDBSplat's shading is the model

// smoothstep is undefined when its edges meet, so the depth cue spans at least this, in millimetres, before a body loads
const minimumSpan = 0.001

export interface DepthCue {
  // The view depths of the bounds' nearest and farthest points, which the cue darkens between
  near: Node<'float'>
  far: Node<'float'>
  // What the cue leaves of a colour at a view depth, from 1 at the bounds' nearest point to 1 less its share at their
  // farthest. At a share of 0 it's exactly 1, so a colour multiplied by it is unchanged
  at(viewDepth: Node<'float'>): Node<'float'>
  // The cue along a ray, for a march that asks at every step: what the cue leaves of a colour at a distance along the
  // ray, given how much view depth each millimetre of the ray covers. The depth grows evenly with the distance, so
  // where the cue's ramp starts and how fast it runs are worked out once for the ray, here, and a step then costs a
  // multiply and an add ahead of the ramp's curve, which is smoothstep's own, and nothing at all at a share of 0,
  // where the march runs as fast as it did without a cue. Called from inside the shader function that marches, since
  // it declares the ray's variables there
  alongRay(depthPerDistance: Node<'float'>): (distance: Node<'float'>) => Node<'float'>
  // The cue as a scene's fog, for the materials that take fog. Fog to black reads as a depth cue over the page's
  // black, and at a share of 0 it leaves the colour untouched
  fog: Node
  // The cue's share, and the body's bounds as their half extents along the scene's x, y and z, in millimetres, or
  // none before a body loads
  set(share: number, half: Triple | null): void
  // The same cue for bounds that move about the scene, as a posed body's do, given as their centre and half extents:
  // the share is the one set, the bounds the nodes'
  within(center: Node<'vec3'>, half: Node<'vec3'>): RayCue
}

// What a style that marches or traces asks of the cue
export type RayCue = Pick<DepthCue, 'near' | 'far' | 'at' | 'alongRay'>

export function createDepthCue(): DepthCue {
  // Each is a uniform three refreshes on every render for every material: one in an object's own group refreshes,
  // for a material that holds no node, only when that object's material or transform changes, so a plain material
  // that takes the cue as fog would miss a new value
  const share = uniform(0).setGroup(renderGroup)
  const bodyHalf = uniform(new Vector3()).setGroup(renderGroup)

  // How far bounds about a centre reach toward the camera from it, and away from it: their half extents laid along the
  // way the camera looks. A standing body is several times as tall as it is deep, so a sphere about it, which reaches
  // as far from every side, would leave the cue a fraction of its range from the front, where the male's is a sixth
  const towardCamera = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz
  const between = (centreDepth: Node<'float'>, half: Node<'vec3'>): RayCue => {
    const span = max(dot(abs(towardCamera), half), minimumSpan)
    const near = centreDepth.sub(span)
    const far = centreDepth.add(span)
    return {
      near,
      far,
      at: (viewDepth) => float(1).sub(share.mul(smoothstep(near, far, viewDepth))),
      alongRay(depthPerDistance) {
        const range = far.sub(near).toVar()
        const rate = depthPerDistance.div(range).toVar()
        const start = near.div(range).negate().toVar()
        return (distance) => {
          const left = float(1).toVar()
          If(share.greaterThan(0), () => {
            const along = clamp(distance.mul(rate).add(start), 0, 1).toVar()
            left.assign(float(1).sub(share.mul(along.mul(along).mul(along.mul(-2).add(3)))))
          })
          return left
        }
      },
    }
  }
  // The body's bounds are centred on the origin, so its centre's view depth follows the camera as it orbits, zooms or
  // pans
  const cue = between(cameraViewMatrix.mul(vec4(0, 0, 0, 1)).z.negate(), bodyHalf)

  return {
    ...cue,
    fog: fog(vec3(0), rangeFogFactor(cue.near, cue.far).mul(share)),
    set(value, half) {
      share.value = value
      if (half) bodyHalf.value.fromArray(half)
      else bodyHalf.value.set(0, 0, 0)
    },
    within: (center, half) => between(cameraViewMatrix.mul(vec4(center, 1)).z.negate(), half),
  }
}
