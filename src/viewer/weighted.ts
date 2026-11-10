import { exp, log, max, min, mix, mrt, output, positionView, smoothstep, vec4 } from 'three/tsl'
import { BlendMode, MaterialBlending, type Node, type PassNode } from 'three/webgpu'
import { cueFar, cueNear } from './shading.ts'

// The weighted-sum blend, as PDBSplat has it. Each splat adds its colour into one target, weighted by its alpha and by
// how near it is, and what it lets through into a second. A composite divides the sum out and lays it over the
// background by how much the splats together let through. No order is needed, so nothing flips as the view turns, and
// the body reads more like an X-ray than like layered tissue

// The floor the weight falls to at the body's farthest point, from 1 at its nearest, and the power it's then raised
// to, which bends the fall between them, so that a splat at the farthest point weighs the floor to that power. Nearer
// splats then count for more of a pixel's colour, which stands in for the order the sorted blend draws them in.
// PDBSplat chose both by eye beside its sorted render
const weightFloor = 0.1
const weightPower = 3

// The most of a pixel one splat may cover in the sum. A splat covering all of it would let nothing through, which is
// an infinite transmittance, so it's held just short of that and still outweighs every splat behind it
const coverageLimit = 0.999

// A weight below which a pixel is taken as reached by no splat, so that the division never meets 0
const leastWeight = 1e-6

// The pass's targets: its own output texture takes the accumulation, and a second the transmittance
const accumulationTarget = 'output'
const transmittanceTarget = 'transmittance'

// Sets a scene pass to sum its splats into two targets, and returns the targets and the composite that resolves them
// over the background, the colour the sorted blend lays its splats over, as a premultiplied colour
export function weightedBlend(scenePass: PassNode, background: Node<'vec4'>) {
  // The weight falls with view depth across the body, between the depth cue's near and far. Every pixel of a splat has
  // its centre's view depth, as three rebuilds the fragment's position from a clip position whose depth all four
  // corners share
  const weight = mix(1, weightFloor, smoothstep(cueNear, cueFar, positionView.z.negate())).pow(weightPower)
  // The splat's colour comes premultiplied by its alpha, so with the weight on it the accumulation sums colour × alpha
  // × weight beside alpha × weight. The transmittance sums −log(1 − alpha), which turns the product of what each splat
  // lets through into a sum. Both targets take the splat's additive blending, as the second would otherwise be
  // overwritten, and both are cleared to 0 here, so that the sums start empty whatever colour the renderer clears to
  const targets = mrt({
    [accumulationTarget]: output.mul(weight),
    [transmittanceTarget]: vec4(log(min(output.a, coverageLimit).oneMinus()).negate()),
  })
  targets.setBlendMode(transmittanceTarget, new BlendMode(MaterialBlending))
  targets.setClearColor(accumulationTarget, 0, 0)
  targets.setClearColor(transmittanceTarget, 0, 0)
  scenePass.setMRT(targets)

  // The sum's colour divided by its weight is the splats' weighted mean colour, and what they let through together is
  // the exponential of minus the summed transmittance. The mean covers the pixel by the rest, over the background. With
  // one splat this is exactly the sorted blend's result, its colour times its alpha over the background times the rest
  const sum = scenePass.getTextureNode(accumulationTarget)
  const transmittance = scenePass.getTextureNode(transmittanceTarget)
  const mean = sum.rgb.div(max(sum.a, leastWeight))
  const through = exp(transmittance.r.negate())
  const covered = through.oneMinus()
  const composite = vec4(
    mean.mul(covered).add(background.rgb.mul(through)),
    covered.add(background.a.mul(through)),
  )
  return { targets, composite }
}
