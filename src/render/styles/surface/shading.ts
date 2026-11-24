import { abs, dot, normalize, normalView, normalWorldGeometry, positionView, positionWorld, pow } from 'three/tsl'
import type { Node } from 'three/webgpu'

// What the surface's lit materials share beyond the body's sampler: where under a surface its colour is read, and the
// rim, a light along a surface's edges where it turns away from the eye

// How sharply Rim's light is confined to a surface's edge
const rimPower = 3

// The point a distance inside a surface from a fragment, along the surface's own outward normal, whichever side is
// seen, so that the colour is the tissue's just under the skin or the bone
export function positionInside(distance: Node<'float'>): Node<'vec3'> {
  return positionWorld.sub(normalWorldGeometry.mul(distance))
}

// How much a surface's edge lights up at a fragment: Rim's strength where the surface turns right away from the eye,
// falling off sharply toward where it faces the eye. The normal faces the eye on both sides of a surface, so the far
// side of a shell has its rim too
export function rimAt(rim: Node<'float'>): Node<'float'> {
  const facing = abs(dot(normalView, normalize(positionView).negate()))
  return pow(facing.oneMinus(), rimPower).mul(rim)
}
