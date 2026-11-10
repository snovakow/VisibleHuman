import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, Vector4 } from 'three'
import type BloomNode from 'three/addons/tsl/display/BloomNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { oitPass } from 'three/addons/tsl/display/OITPassNode.js'
import { float, mix, output, pass, positionView, smoothstep, texture, uniform, vec4 } from 'three/tsl'
import { RenderPipeline, RenderTarget, type Node, type PassNode } from 'three/webgpu'
import { useStore } from '../store.ts'
import { asWebGPU } from './renderer.ts'
import { cueFar, cueNear } from './shading.ts'
import { isOit, isWeighted } from './styles.ts'
import { weightedBlend } from './weighted.ts'

// Above R3F's own render, which a frame callback at a higher priority takes over until it unmounts
const renderPriority = 1

// The weight a see-through layer of the surface is summed by, beside its alpha: 1 at the body's nearest point, falling
// to this floor at its farthest, raised to this power, as the splats' weighted sum has it, so that a nearer layer
// counts for more of a pixel's colour, which stands in for the order a sorted blend lays them in. three's own weight
// falls with depth over a scene a few hundred units from the camera, and is flat across a body two metres from it
const layerWeightFloor = 0.1
const layerWeightPower = 3
// The sum is held in half floats and divided out against a floor of 1e-5, which the faintest layers at the far side
// would fall under, so every weight is scaled up by this, and the division takes it out again
const layerWeightGain = 100
const layerWeight = output.a
  .mul(mix(1, layerWeightFloor, smoothstep(cueNear, cueFar, positionView.z.negate())).pow(layerWeightPower))
  .mul(layerWeightGain)

// The field in which three's pass keeps the target its see-through layers are summed into, which its types leave out
const layerSumsField = '_oitRenderTarget'

// What the see-through layers leave uncovered of a pixel, from 1 where there are none: the second of the two textures
// three's pass sums them into. The pass keeps that target to itself and hands on the opaque things' alpha alone, so
// it's read here from the pass's own field, and taken as nothing uncovered if a later three keeps it elsewhere, which
// draws the canvas opaque over the page's black rather than dropping the layers
function uncoveredBy(layers: PassNode): Node<'float'> {
  const sums: unknown = Reflect.get(layers, layerSumsField)
  return sums instanceof RenderTarget && sums.textures.length > 1 ? texture(sums.textures[1]).r : float(0)
}

// The pipeline and the pass that draws the scene into it, which last while the effects are mounted
interface Stage {
  pipeline: RenderPipeline
  scenePass: PassNode
}

// The scene drawn through a pipeline of passes, in place of R3F's own render: the weighted blend sums the splats into
// two targets and composites them, order-independent transparency does the same for the surface's see-through layers
// over its opaque ones, and bloom spreads a glow around the scene's bright parts. It renders only while it's mounted,
// so the scene renders directly whenever there's no effect to apply
export function Effects() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const weighted = useStore((s) => isWeighted(s.options))
  const oit = useStore((s) => isOit(s.options))
  const bloomOn = useStore((s) => s.options.bloom > 0)
  const strength = useStore((s) => s.options.bloom)
  const radius = useStore((s) => s.options.bloomRadius)
  const threshold = useStore((s) => s.options.bloomThreshold)
  const stage = useRef<Stage | null>(null)
  const glow = useRef<BloomNode | null>(null)

  useEffect(() => {
    const scenePass = pass(scene, camera)
    const pipeline = new RenderPipeline(asWebGPU(gl), scenePass.getTextureNode('output'))
    stage.current = { pipeline, scenePass }
    // The pipeline frees only its own quad, so the pass it runs is freed first
    return () => {
      stage.current = null
      scenePass.dispose()
      pipeline.dispose()
    }
  }, [gl, scene, camera])

  // The effects that are on join the pipeline's output, and leave it as they turn off, each taking its passes with it
  useEffect(() => {
    if (!stage.current) return undefined
    const { pipeline, scenePass } = stage.current
    const { options } = useStore.getState()
    const made: Node[] = []
    let sceneColor: Node<'vec4'> = scenePass.getTextureNode('output')

    if (weighted) {
      // A pass of its own sums the splats into two targets, which the composite resolves, and the scene pass draws
      // nothing meanwhile. The targets take no multisampling, as the soft splats don't alias, and the renderer's
      // half-float output type, which holds the sums without clipping. The composite lays the sum over the renderer's
      // clear colour, which the sorted blend lays its splats over, taken as it is when the blend turns on
      const renderer = asWebGPU(gl)
      const sumPass = pass(scene, camera, { samples: 0 })
      const clear = renderer.getClearColor(new Color())
      const background = uniform(new Vector4(clear.r, clear.g, clear.b, renderer.getClearAlpha()))
      const { targets, composite } = weightedBlend(sumPass, background)
      sceneColor = composite
      made.push(sumPass, background, targets, composite)
    } else if (oit) {
      // A pass of its own draws what's opaque, then sums the see-through layers over it into two targets of its own
      // and resolves them, and the scene pass draws nothing meanwhile. Its colour comes laid over the opaque things,
      // but with their alpha alone, which would leave a layer with nothing opaque behind it at no alpha, and the
      // output, which takes the colour as multiplied by its alpha, would drop it. So the alpha takes in what the
      // layers cover as well, as the sorted blend's does
      const layers = oitPass(scene, camera)
      layers.weightNode = layerWeight
      const uncovered = uncoveredBy(layers)
      sceneColor = vec4(layers.rgb, layers.a.oneMinus().mul(uncovered).oneMinus())
      made.push(layers, uncovered, sceneColor)
    }

    let result: Node<'vec4'> = sceneColor

    if (bloomOn) {
      // Bloom's settings are uniforms, which the effects below set without building the pipeline again
      const bloomNode = bloom(sceneColor, options.bloom, options.bloomRadius, options.bloomThreshold)
      result = sceneColor.add(bloomNode)
      glow.current = bloomNode
      made.push(bloomNode)
    }

    pipeline.outputNode = result
    pipeline.needsUpdate = true
    return () => {
      glow.current = null
      for (const node of made) node.dispose()
    }
  }, [gl, scene, camera, weighted, oit, bloomOn])

  useEffect(() => {
    if (glow.current) glow.current.strength.value = strength
  }, [strength])
  useEffect(() => {
    if (glow.current) glow.current.radius.value = radius
  }, [radius])
  useEffect(() => {
    if (glow.current) glow.current.threshold.value = threshold
  }, [threshold])

  // The frame callback subscribes before the pipeline is built, so until then it renders the scene as R3F would
  useFrame((state) => {
    if (stage.current) stage.current.pipeline.render()
    else state.gl.render(state.scene, state.camera)
  }, renderPriority)

  return null
}
