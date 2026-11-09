import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { cameraPosition, clamp, float, length, mix, uniform, vec4 } from 'three/tsl'
import { NodeMaterial, type Mesh, type UniformNode } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { cutBox, type Cuts } from './cuts.ts'
import { createRayQuad, rayQuad } from './rayQuad.ts'

// The Volume style, as a placeholder until the ray march arrives: the quad draws how far along each pixel's ray the
// box the cuts leave is entered, as a grey ramp, darker nearer, and nothing else, so that the quad, its rays and the
// cuts are proven before anything is sampled along them

// The ramp's grey at the nearest the box can come, above black so that the box's edge shows against the background
const rampFloor = 0.1

// The quad, its material and the uniforms the fragment reads
interface Drawn {
  quad: Mesh
  material: NodeMaterial
  cutMin: UniformNode<'vec3'>
  cutMax: UniformNode<'vec3'>
  radius: UniformNode<'float'>
}

export function BodyVolume() {
  const get = useThree((s) => s.get)
  const bounds = useStore((s) => s.bounds)
  const cuts = useStore(
    useShallow((s): Cuts => ({ axial: s.options.axial, coronal: s.options.coronal, sagittal: s.options.sagittal })),
  )
  const drawn = useRef<Drawn | null>(null)

  // Owns the quad for as long as the style is shown. The material tests and writes no depth, since the ramp is a
  // check of the rays alone, and is hidden until the body's bounds give it a box
  useEffect(() => {
    const { scene } = get()
    const cutMin = uniform(new Vector3())
    const cutMax = uniform(new Vector3())
    // The radius of the sphere about the body's centre that holds its bounds
    const radius = uniform(0)
    const material = new NodeMaterial()
    material.depthTest = false
    material.depthWrite = false
    material.colorNode = rayQuad(cutMin, cutMax, ({ tEnter }) => {
      // The nearest the box can be entered is the sphere's near side, and the ramp reaches white a diameter past it
      const nearest = length(cameraPosition).sub(radius)
      const ramp = clamp(tEnter.sub(nearest).div(radius.mul(2)), 0, 1)
      const grey = mix(float(rampFloor), float(1), ramp)
      return vec4(grey, grey, grey, 1)
    })
    const quad = createRayQuad(material)
    quad.visible = false
    scene.add(quad)
    drawn.current = { quad, material, cutMin, cutMax, radius }
    return () => {
      scene.remove(quad)
      quad.geometry.dispose()
      material.dispose()
      drawn.current = null
    }
  }, [get])

  // The box the cuts leave of the bounds goes to the fragment as two corners
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    current.quad.visible = bounds !== null
    if (!bounds) return
    const box = cutBox(bounds.half, cuts)
    current.cutMin.value.fromArray(box.min)
    current.cutMax.value.fromArray(box.max)
    current.radius.value = Math.hypot(...bounds.half)
  }, [bounds, cuts])

  return null
}
