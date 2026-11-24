import { Color, Vector4 } from 'three'
import type BloomNode from 'three/addons/tsl/display/BloomNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { pass, uniform } from 'three/tsl'
import { RenderPipeline, type Camera, type Node, type PassNode, type Scene, type WebGPURenderer } from 'three/webgpu'
import type { DepthCue } from '../depthCue.ts'
import { summedLayers } from './layers.ts'
import { isDirect, type FramePlan } from './plan.ts'
import { weightedBlend } from './weighted.ts'

// The compositor: the one place a frame is drawn from. A plan that adds nothing to the scene is drawn straight to the
// canvas. Any other is drawn through a pipeline of passes: the weighted blend sums the splats into two targets and
// composites them, order-independent transparency does the same for the surface's see-through layers over its opaque
// ones, FXAA smooths the edges the ray quad's styles find a ray to a pixel, and bloom spreads a glow around the frame's
// bright parts. The pipeline is built when a plan first needs it, rebuilt only when a plan changes which passes run,
// and freed, with its targets, once a plan needs none

// The pipeline and the pass that draws the scene into it
interface Passes {
  pipeline: RenderPipeline
  scenePass: PassNode
}

// The passes a plan runs, which a new plan is checked against, with the nodes they were built from and the glow whose
// settings later plans move
interface Chain {
  plan: FramePlan
  nodes: Node[]
  glow: BloomNode | null
}

export interface Compositor {
  // The plan the frames to come are drawn to
  set(plan: FramePlan): void
  // Draws a frame
  render(): void
  dispose(): void
}

// Whether a node is a vec4 by the type it was built as: @types/three leaves fxaa()'s node untyped, where three builds
// it as a vec4. A later three that built it otherwise would leave the edges unsmoothed rather than break the pipeline
function isVec4(node: Node): node is Node<'vec4'> {
  return node.nodeType === 'vec4'
}

// Whether two plans run the same passes, whatever the glow's settings, which are uniforms
function samePasses(a: FramePlan, b: FramePlan) {
  return a.transparency === b.transparency && a.smoothed === b.smoothed && (a.bloom === null) === (b.bloom === null)
}

export function createCompositor(renderer: WebGPURenderer, scene: Scene, camera: Camera, cue: DepthCue): Compositor {
  let passes: Passes | null = null
  let chain: Chain | null = null

  const unchain = () => {
    if (!chain) return
    for (const node of chain.nodes) node.dispose()
    chain = null
  }

  // The pipeline frees only its own quad, so the pass it runs is freed first
  const strike = () => {
    unchain()
    if (!passes) return
    passes.scenePass.dispose()
    passes.pipeline.dispose()
    passes = null
  }

  // The passes a plan asks for, joined into the pipeline's output
  const build = ({ pipeline, scenePass }: Passes, plan: FramePlan): Chain => {
    const nodes: Node[] = []
    let sceneColor: Node<'vec4'> = scenePass.getTextureNode('output')

    if (plan.transparency === 'weighted') {
      // A pass of its own sums the splats into two targets, which the composite resolves, and the scene pass draws
      // nothing meanwhile. The targets take no multisampling, as the soft splats don't alias, and the renderer's
      // half-float output type, which holds the sums without clipping. The composite lays the sum over the renderer's
      // clear colour, which the sorted blend lays its splats over, taken as it is when the blend turns on
      const sumPass = pass(scene, camera, { samples: 0 })
      const clear = renderer.getClearColor(new Color())
      const background = uniform(new Vector4(clear.r, clear.g, clear.b, renderer.getClearAlpha()))
      const { targets, composite } = weightedBlend(sumPass, background, cue)
      sceneColor = composite
      nodes.push(sumPass, background, targets, composite)
    } else if (plan.transparency === 'oit') {
      // A pass of its own draws what's opaque and sums the see-through layers over it, and the scene pass draws
      // nothing meanwhile
      const layers = summedLayers(scene, camera, cue)
      sceneColor = layers.color
      nodes.push(...layers.nodes)
    }

    if (plan.smoothed) {
      // FXAA finds the edges by their contrast and blends across them, colour and alpha together, which the
      // premultiplied colour over the page's black takes as it should. It goes ahead of the bloom, so that the glow
      // spreads from the smoothed edges
      const edges = fxaa(sceneColor)
      nodes.push(edges)
      if (isVec4(edges)) sceneColor = edges
    }

    let result = sceneColor
    let glow: BloomNode | null = null
    if (plan.bloom) {
      // Bloom's settings are uniforms, which a later plan sets without building the passes again
      glow = bloom(sceneColor, plan.bloom.strength, plan.bloom.radius, plan.bloom.threshold)
      result = sceneColor.add(glow)
      nodes.push(glow)
    }

    pipeline.outputNode = result
    pipeline.needsUpdate = true
    return { plan, nodes, glow }
  }

  return {
    set(plan) {
      if (isDirect(plan)) {
        strike()
        return
      }
      if (!passes) {
        const scenePass = pass(scene, camera)
        passes = { pipeline: new RenderPipeline(renderer, scenePass.getTextureNode('output')), scenePass }
      }
      if (!chain || !samePasses(chain.plan, plan)) {
        unchain()
        chain = build(passes, plan)
      }
      chain.plan = plan
      if (chain.glow && plan.bloom) {
        chain.glow.strength.value = plan.bloom.strength
        chain.glow.radius.value = plan.bloom.radius
        chain.glow.threshold.value = plan.bloom.threshold
      }
    },
    render() {
      if (passes) passes.pipeline.render()
      else renderer.render(scene, camera)
    },
    dispose: strike,
  }
}
