import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DoubleSide, Mesh, PlaneGeometry } from 'three'
import { Discard, float, Fn, If, positionWorld, select, uniform, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type UniformNode } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { boneDensity } from '../volume/density.ts'
import { bodyCoverage } from '../volume/format.ts'
import { cutLimits, type Cuts } from './cuts.ts'
import { createBodySampler, type BodySampler } from './surfaceShading.ts'
import { acquireCoverageTexture, acquireVolumeTexture, releaseCoverageTexture, releaseVolumeTexture } from './volumeTexture.ts'

// The caps on the surface style's cuts: a quad in each active cut's plane, sized to the box the cuts leave, showing
// the section through the body in the photographs' colours, read from the 3D texture at each pixel's place. Outside
// the skin the cap is see-through: it ends where the coverage crosses the skin's isolevel, which is the line the skin
// mesh is cut along, so the section is flush with the mesh's edge. The density's own edge, which is 0 outside the
// body, would end half a voxel out in steps along the grid. The bone's section is solid while the tissue's takes the
// skin's Opacity, so a see-through skin shows a see-through section. The caps stay outside the clipping group, since
// their size already keeps them within the other cuts

// Drawn ahead of the skin's see-through passes, so that a see-through section is laid over the bone inside before the
// skin is laid over it; among the opaque things the order doesn't matter, since each tests its depth
const capRenderOrder = -4

// The skin's isolevel on the coverage's scale of 0 to 1
const skinIso = bodyCoverage / 255

// Pulls the caps a little toward the eye, so that where a mesh runs along its cut plane the cap wins rather than
// fighting it
const polygonOffsetFactor = -1
const polygonOffsetUnits = -1

// A cap per cut, Axial, Coronal and Sagittal, in the cuts' order
type Caps = [Mesh, Mesh, Mesh]

interface Owned {
  caps: Caps
  material: MeshBasicNodeMaterial
  sampler: BodySampler
  opacity: UniformNode<'float'>
  boneThreshold: UniformNode<'float'>
}

export function CutCaps() {
  const get = useThree((s) => s.get)
  const volume = useStore((s) => s.volume)
  const bounds = useStore((s) => s.bounds)
  const cuts = useStore(
    useShallow((s): Cuts => ({ axial: s.options.axial, coronal: s.options.coronal, sagittal: s.options.sagittal })),
  )
  const capsOn = useStore((s) => s.options.caps)
  const opacity = useStore((s) => s.options.opacity)
  const boneThreshold = useStore((s) => s.options.boneThreshold)
  const owned = useRef<Owned | null>(null)

  // Owns the three quads and their one material for as long as the surface style is shown. Each is a unit square
  // turned into its cut's plane and scaled to the box's face there, and hidden while its cut is 0
  useEffect(() => {
    const { scene } = get()
    const sampler = createBodySampler()
    const opacityUniform = uniform(1)
    const thresholdUniform = uniform(boneDensity / 255)
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor, polygonOffsetUnits })
    material.colorNode = Fn(() => {
      If(sampler.coverageAt(positionWorld).lessThan(skinIso), () => {
        Discard()
      })
      const bone = sampler.densityAt(positionWorld).greaterThanEqual(thresholdUniform)
      return vec4(sampler.colourAt(positionWorld), select(bone, float(1), opacityUniform))
    })()
    const geometry = new PlaneGeometry(1, 1)
    const cap = () => {
      const quad = new Mesh(geometry, material)
      quad.renderOrder = capRenderOrder
      quad.visible = false
      return quad
    }
    const caps: Caps = [cap(), cap(), cap()]
    // The square faces +z: the Axial cap turns to face +y and the Sagittal to face +x
    caps[0].rotation.x = -Math.PI / 2
    caps[2].rotation.y = Math.PI / 2
    scene.add(...caps)
    owned.current = { caps, material, sampler, opacity: opacityUniform, boneThreshold: thresholdUniform }
    return () => {
      scene.remove(...caps)
      geometry.dispose()
      material.dispose()
      sampler.dispose()
      owned.current = null
    }
  }, [get])

  // The volume's textures, held while the volume is shown and let go when it changes or this unmounts
  useEffect(() => {
    const current = owned.current
    if (!current || !volume || !bounds) return undefined
    const colour = acquireVolumeTexture(volume)
    const coverage = acquireCoverageTexture(volume)
    current.sampler.show(colour, coverage, volume, bounds.center)
    return () => {
      releaseCoverageTexture(volume)
      releaseVolumeTexture(volume)
    }
  }, [volume, bounds])

  // Each cap sits on its cut's plane, over the face of the box the cuts leave, and shows only while its cut is open
  useEffect(() => {
    const current = owned.current
    if (!current || !bounds) return
    const [hx, hy, hz] = bounds.half
    const { top, front, right } = cutLimits(bounds.half, cuts)
    const [axial, coronal, sagittal] = current.caps
    const shown = volume !== null && capsOn
    axial.visible = shown && cuts.axial > 0
    axial.position.set((right + hx) / 2, top, (front - hz) / 2)
    axial.scale.set(hx - right, front + hz, 1)
    coronal.visible = shown && cuts.coronal > 0
    coronal.position.set((right + hx) / 2, (top - hy) / 2, front)
    coronal.scale.set(hx - right, top + hy, 1)
    sagittal.visible = shown && cuts.sagittal > 0
    sagittal.position.set(right, (top - hy) / 2, (front - hz) / 2)
    sagittal.scale.set(front + hz, top + hy, 1)
  }, [volume, bounds, cuts, capsOn])

  // The tissue's section takes the skin's Opacity, so the cap is drawn with the see-through things below 1
  useEffect(() => {
    const current = owned.current
    if (!current) return
    current.opacity.value = opacity
    current.boneThreshold.value = boneThreshold / 255
    const { material } = current
    const transparent = opacity < 1
    if (material.transparent !== transparent) {
      material.transparent = transparent
      material.needsUpdate = true
    }
  }, [opacity, boneThreshold])

  return null
}
