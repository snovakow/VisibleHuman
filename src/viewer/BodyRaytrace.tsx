import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { CustomBlending, NoBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial, type Mesh } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { cutBox, type Cuts } from './cuts.ts'
import { stepShare } from './quality.ts'
import { createRayQuad } from './rayQuad.ts'
import { raytrace, traceIndex, type Raytrace } from './raytrace.ts'
import { asWebGPU } from './renderer.ts'
import { acquireCoverageTexture, acquireVolumeTexture, releaseCoverageTexture, releaseVolumeTexture } from './volumeTexture.ts'

// The Raytrace style: the skin and the bone traced through the body's 3D textures from the ray quad, with the
// surfaces, layers, shadows and light the panel sets

// Below full Opacity the quad is drawn with the transparent things, after everything opaque, so that what the skin
// lets through is all there
const quadRenderOrder = 1000

// The quad, its material and the trace its material draws
interface Drawn {
  quad: Mesh
  material: NodeMaterial
  tracer: Raytrace
}

export function BodyRaytrace() {
  const get = useThree((s) => s.get)
  const volume = useStore((s) => s.volume)
  const bounds = useStore((s) => s.bounds)
  const cuts = useStore(
    useShallow((s): Cuts => ({ axial: s.options.axial, coronal: s.options.coronal, sagittal: s.options.sagittal })),
  )
  const trace = useStore((s) => s.options.trace)
  const layers = useStore((s) => s.options.layers)
  const shadows = useStore((s) => s.options.shadows)
  const lightAzimuth = useStore((s) => s.options.lightAzimuth)
  const lightElevation = useStore((s) => s.options.lightElevation)
  const boneThreshold = useStore((s) => s.options.boneThreshold)
  const rim = useStore((s) => s.options.rim)
  const opacity = useStore((s) => s.options.opacity)
  const quality = useStore((s) => s.options.quality)
  const drawn = useRef<Drawn | null>(null)

  // Owns the quad for as long as the style is shown. The trace writes the depth of the first surface it meets and
  // tests against what's drawn before it, so the surfaces and anything else in the scene hide one another where each
  // is nearer; it's hidden until a volume gives it its textures
  useEffect(() => {
    const { scene } = get()
    const tracer = raytrace()
    const material = new NodeMaterial()
    material.colorNode = tracer.colorNode
    material.depthNode = tracer.depthNode
    material.depthTest = true
    material.depthWrite = true
    material.fog = false
    const quad = createRayQuad(material)
    quad.renderOrder = quadRenderOrder
    quad.visible = false
    scene.add(quad)
    drawn.current = { quad, material, tracer }
    return () => {
      scene.remove(quad)
      quad.geometry.dispose()
      material.dispose()
      tracer.dispose()
      drawn.current = null
    }
  }, [get])

  // The volume's textures, held while the volume is shown and let go when it changes or this unmounts
  useEffect(() => {
    const current = drawn.current
    if (!current || !volume || !bounds) return undefined
    const colour = acquireVolumeTexture(volume)
    const coverage = acquireCoverageTexture(volume)
    current.tracer.show(colour, coverage, volume, bounds.center)
    current.quad.visible = true
    return () => {
      current.quad.visible = false
      releaseCoverageTexture(volume)
      releaseVolumeTexture(volume)
    }
  }, [volume, bounds])

  // The box the cuts leave of the bounds clips every ray and bounds its steps
  useEffect(() => {
    const current = drawn.current
    if (!current || !bounds) return
    const box = cutBox(bounds.half, cuts)
    current.tracer.setCuts(box.min, box.max)
  }, [bounds, cuts])

  // The step, by Quality and, for the automatic step, by the backend drawing
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    const webgpu = 'isWebGPUBackend' in asWebGPU(get().gl).backend
    current.tracer.setStep(stepShare(quality, webgpu))
  }, [get, quality])

  // At full Opacity the skin is solid and the quad is drawn as an opaque thing, writing its depth and blending
  // nothing. Below it the quad is drawn with the transparent things and lays its premultiplied colour, the layers
  // already composited, over what's behind, still writing the depth of the first surface
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    current.tracer.opacity.value = opacity
    const { material } = current
    const translucent = opacity < 1
    material.transparent = translucent
    material.blending = translucent ? CustomBlending : NoBlending
    material.blendSrc = OneFactor
    material.blendDst = OneMinusSrcAlphaFactor
    material.needsUpdate = true
  }, [opacity])

  // The rest of the panel's settings go straight to the trace's uniforms
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    const { tracer } = current
    tracer.trace.value = traceIndex[trace]
    tracer.layers.value = layers
    tracer.shadows.value = shadows
    tracer.setLight(lightAzimuth, lightElevation)
    tracer.boneThreshold.value = boneThreshold / 255
    tracer.rim.value = rim
  }, [trace, layers, shadows, lightAzimuth, lightElevation, boneThreshold, rim])

  return null
}
