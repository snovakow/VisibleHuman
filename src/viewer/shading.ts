import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
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
  positionView,
  rangeFogFactor,
  renderGroup,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { defaultOptions, type ViewOptions } from '../options.ts'
import { useStore } from '../store.ts'

// The depth cue every style shares: the far side of the body darkened, from none at its nearest point to Depth cue's
// share at its farthest, so that near and far read apart in a body one can see through. The splats multiply it into
// their colour, the volume into each step and the raytrace into each hit, and the surface's meshes take it as the
// scene's fog. PDBSplat's shading is the model

// The panel's shading options, by their names in the view options, which the scene copies in as they change, so a
// slider never rebuilds a material. Each is a uniform three refreshes on every render for every material: one in an
// object's own group refreshes, for a material that holds no node, only when that object's material or transform
// changes, so a plain material that takes the cue as fog would miss a new value
export const optionUniforms = {
  depthCue: uniform(defaultOptions.depthCue).setGroup(renderGroup),
} satisfies Partial<Record<keyof ViewOptions, unknown>>
export const { depthCue } = optionUniforms
// The loaded body's bounds, as their half extents along the scene's x, y and z, in millimetres
export const bodyHalf = uniform(new Vector3()).setGroup(renderGroup)

// smoothstep is undefined when its edges meet, so the depth cue spans at least this, in millimetres, before a body loads
const minimumSpan = 0.001

// The body's bounds are centred on the origin, so its centre's view depth follows the camera as it orbits, zooms or pans
const centreDepth = cameraViewMatrix.mul(vec4(0, 0, 0, 1)).z.negate()
// How far the bounds reach toward the camera from their centre, and away from it: their half extents laid along the
// way the camera looks. A standing body is several times as tall as it is deep, so a sphere about it, which reaches
// as far from every side, would leave the cue a fraction of its range from the front, where the male's is a sixth
const towardCamera = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz
const span = max(dot(abs(towardCamera), bodyHalf), minimumSpan)
// The view depths of the bounds' nearest and farthest points, which the depth cue darkens between
export const cueNear = centreDepth.sub(span)
export const cueFar = centreDepth.add(span)

// What the depth cue leaves of a colour at a view depth, from 1 at the bounds' nearest point to 1 − Depth cue at their
// farthest. At Depth cue 0 it's exactly 1, so a colour multiplied by it is unchanged
export function cueAt(viewDepth: Node<'float'>): Node<'float'> {
  return float(1).sub(depthCue.mul(smoothstep(cueNear, cueFar, viewDepth)))
}

// What the depth cue leaves of a splat's colour. Every pixel of a splat has its centre's view depth, as three rebuilds
// the fragment's position from a clip position whose depth all four corners share
export const depthShade = cueAt(positionView.z.negate())

// The depth cue along a ray, for a march that asks at every step: what the cue leaves of a colour at a distance along
// the ray, given how much view depth each millimetre of the ray covers. The depth grows evenly with the distance, so
// where the cue's ramp starts and how fast it runs are worked out once for the ray, here, and a step then costs a
// multiply and an add ahead of the ramp's curve, which is smoothstep's own, and nothing at all at Depth cue 0, where
// the march runs as fast as it did without a cue. Called from inside the shader function that marches, since it
// declares the ray's variables there
export function cueAlongRay(depthPerDistance: Node<'float'>): (distance: Node<'float'>) => Node<'float'> {
  const range = cueFar.sub(cueNear).toVar()
  const rate = depthPerDistance.div(range).toVar()
  const start = cueNear.div(range).negate().toVar()
  return (distance) => {
    const left = float(1).toVar()
    If(depthCue.greaterThan(0), () => {
      const along = clamp(distance.mul(rate).add(start), 0, 1).toVar()
      left.assign(float(1).sub(depthCue.mul(along.mul(along).mul(along.mul(-2).add(3)))))
    })
    return left
  }
}

// Keeps one shading option's uniform at the store's value
export function useOptionUniform(option: keyof typeof optionUniforms) {
  const value = useStore((s) => s.options[option])
  useEffect(() => {
    optionUniforms[option].value = value
  }, [option, value])
}

// Gives the scene the depth cue as fog, for the materials that take fog: the surface's meshes and its caps. Fog to
// black reads as a depth cue over the page's black, and at Depth cue 0 it leaves the colour untouched. Setting or
// clearing it recompiles the scene's materials once
export function useCueFog() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    const { scene } = get()
    scene.fogNode = fog(vec3(0), rangeFogFactor(cueNear, cueFar).mul(depthCue))
    return () => {
      scene.fogNode = null
    }
  }, [get])
}
