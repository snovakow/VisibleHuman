import { oitPass } from 'three/addons/tsl/display/OITPassNode.js'
import { float, mix, output, positionView, smoothstep, texture, vec4 } from 'three/tsl'
import { RenderTarget, type Camera, type Node, type PassNode, type Scene } from 'three/webgpu'
import type { DepthCue } from '../depthCue.ts'

// Order-independent transparency for the surface: a pass that draws what's opaque, then sums the see-through layers
// over it into two targets of its own and resolves them, so that every layer shows whatever order its triangles are
// drawn in. three's pass does the summing; this sets the weight each layer is summed by and mends the alpha it hands on

// The weight a see-through layer is summed by, beside its alpha: 1 at the body's nearest point, falling to this floor
// at its farthest, raised to this power, as the splats' weighted sum has it, so that a nearer layer counts for more of
// a pixel's colour, which stands in for the order a sorted blend lays them in. three's own weight falls with depth
// over a scene a few hundred units from the camera, and is flat across a body two metres from it
const weightFloor = 0.1
const weightPower = 3
// The sum is held in half floats and divided out against a floor of 1e-5, which the faintest layers at the far side
// would fall under, so every weight is scaled up by this, and the division takes it out again
const weightGain = 100

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

// The pass, and the scene's colour as it resolves it. The pass's colour comes laid over the opaque things, but with
// their alpha alone, which would leave a layer with nothing opaque behind it at no alpha, and the output, which takes
// the colour as multiplied by its alpha, would drop it. So the alpha takes in what the layers cover as well, as the
// sorted blend's does. The returned nodes are the caller's to dispose of
export function summedLayers(scene: Scene, camera: Camera, cue: DepthCue) {
  const layers = oitPass(scene, camera)
  layers.weightNode = output.a
    .mul(mix(1, weightFloor, smoothstep(cue.near, cue.far, positionView.z.negate())).pow(weightPower))
    .mul(weightGain)
  const uncovered = uncoveredBy(layers)
  const color: Node<'vec4'> = vec4(layers.rgb, layers.a.oneMinus().mul(uncovered).oneMinus())
  return { color, nodes: [layers, uncovered, color] }
}
