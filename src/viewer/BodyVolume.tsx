import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { NodeMaterial, type Mesh } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { cutBox, type Cuts } from './cuts.ts'
import { reportFirstDraw } from './firstDraw.ts'
import { stepShare } from './quality.ts'
import { createRayQuad } from './rayQuad.ts'
import { asWebGPU } from './renderer.ts'
import { modeIndex, sourceIndex, volumeMarch, windowEnds, type VolumeMarch } from './volumeMarch.ts'
import { acquireMriTexture, acquireVolumeTexture, releaseMriTexture, releaseVolumeTexture } from './volumeTexture.ts'

// The Volume style: the body's 3D texture marched from the ray quad, in the mode, window and quality the panel sets

// The quad is drawn after everything else, so that what the march lays over is all there
const quadRenderOrder = 1000

// The quad, its material and the march its material draws
interface Drawn {
  quad: Mesh
  material: NodeMaterial
  march: VolumeMarch
}

export function BodyVolume() {
  const get = useThree((s) => s.get)
  const volume = useStore((s) => s.volume)
  const bounds = useStore((s) => s.bounds)
  const cuts = useStore(
    useShallow((s): Cuts => ({ axial: s.options.axial, coronal: s.options.coronal, sagittal: s.options.sagittal })),
  )
  const mode = useStore((s) => s.options.mode)
  const density = useStore((s) => s.options.density)
  const opacity = useStore((s) => s.options.opacity)
  const windowLow = useStore((s) => s.options.windowLow)
  const windowHigh = useStore((s) => s.options.windowHigh)
  const quality = useStore((s) => s.options.quality)
  const shading = useStore((s) => s.options.shading)
  const grey = useStore((s) => s.options.grey)
  const drawn = useRef<Drawn | null>(null)

  // Owns the quad for as long as the style is shown. The march lays what it gathers over what's behind, with its
  // colour already multiplied by what it covers, so it tests and writes no depth and is drawn last, and it's hidden
  // until a volume gives it a texture
  useEffect(() => {
    const { scene } = get()
    const march = volumeMarch()
    const material = new NodeMaterial()
    material.colorNode = march.colorNode
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    material.fog = false
    const quad = createRayQuad(material)
    quad.renderOrder = quadRenderOrder
    quad.visible = false
    scene.add(quad)
    drawn.current = { quad, material, march }
    return () => {
      scene.remove(quad)
      quad.geometry.dispose()
      material.dispose()
      march.dispose()
      drawn.current = null
    }
  }, [get])

  // The volume's texture, held while the volume is shown and let go when it changes or this unmounts: the colour
  // with the density, or with the MRI in the density's place while the Density is the MRI
  const readsMri = density === 'mri' && volume?.mri !== undefined
  useEffect(() => {
    const current = drawn.current
    if (!current || !volume || !bounds) return undefined
    const texture = readsMri ? acquireMriTexture(volume) : acquireVolumeTexture(volume)
    current.march.show(texture, volume, bounds.center)
    current.quad.visible = true
    reportFirstDraw(current.quad, volume)
    return () => {
      current.quad.visible = false
      if (readsMri) releaseMriTexture(volume)
      else releaseVolumeTexture(volume)
    }
  }, [volume, bounds, readsMri])

  // The box the cuts leave of the bounds clips every ray and bounds its steps
  useEffect(() => {
    const current = drawn.current
    if (!current || !bounds) return
    const box = cutBox(bounds.half, cuts)
    current.march.setCuts(box.min, box.max)
  }, [bounds, cuts])

  // The step, by Quality and, for the automatic step, by the backend drawing
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    const webgpu = 'isWebGPUBackend' in asWebGPU(get().gl).backend
    current.march.setStep(stepShare(quality, webgpu))
  }, [get, quality])

  // The mode, and the blending it needs: over, x-ray and MIP lay a premultiplied colour over what's behind, and the
  // glow is added to it whole. three's additive blending would scale the glow by its alpha first, so the factors are
  // given outright
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    current.march.mode.value = modeIndex[mode]
    const { material } = current
    material.blending = CustomBlending
    material.blendSrc = OneFactor
    material.blendDst = mode === 'glow' ? OneFactor : OneMinusSrcAlphaFactor
    material.needsUpdate = true
  }, [mode])

  // The rest of the panel's settings go straight to the march's uniforms
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    const { march } = current
    march.densitySource.value = sourceIndex[density]
    march.opacity.value = opacity
    const [low, high] = windowEnds(windowLow, windowHigh)
    march.windowLow.value = low
    march.windowHigh.value = high
    march.shading.value = shading
    march.grey.value = grey
  }, [density, opacity, windowLow, windowHigh, shading, grey])

  return null
}
