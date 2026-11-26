import { modelViewMatrix, modelWorldMatrix, positionGeometry, vec4 } from 'three/tsl'
import { ClippingNode, type Node, type NodeBuilder, type NodeMaterial } from 'three/webgpu'

// A posed mesh's materials clipped by a clipping group's planes at the rest position, where the scan holds each point,
// rather than where the pose has moved it, so that a cut stays the same section of the anatomy as the body moves, and,
// on a backend with clip distances, lies across each pixel's samples as the unposed meshes' cut does. three's node
// materials clip at the view position, which skinning has already moved, and offer no other; so each posed material is
// given copies of three's two methods that set its clipping up, the same but for the clipping node they make, whose
// position is the rest position in view space whatever three's setup assigns it.
//
// setupClipping and setupHardwareClipping below are copied from three.js r187 (src/materials/nodes/NodeMaterial.js),
// © 2010-2026 three.js authors, under the MIT licence, with three's clipping(), clippingAlpha() and hardwareClipping()
// swapped for RestClippingNode; the builder's fields they read are three's, read through guards. Check both on a three
// upgrade, against NodeMaterial's and ClippingNode's own

// The rest position in the space three's clipping planes are given in: the view's, or the world's for an array camera
const restView = modelViewMatrix.mul(vec4(positionGeometry, 1)).xyz
const restWorld = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz

// three's clipping node, clipping at the rest position. Its setup assigns the view position to this.position, which the
// setter ignores, and then reads this.position, which the getter answers with the rest position
class RestClippingNode extends ClippingNode {
  private world = false

  get position(): Node<'vec3'> {
    return this.world ? restWorld : restView
  }

  set position(_assigned: Node<'vec3'>) {
    // What setup assigns is the posed position, which this node never clips at
  }

  setup(builder: NodeBuilder) {
    this.world = Reflect.get(builder.camera ?? {}, 'isArrayCamera') === true
    return super.setup(builder)
  }
}

// The node that writes the clip distances, which three's types don't let the constructor name
function hardwareNode() {
  const node = new RestClippingNode()
  Reflect.set(node, 'scope', ClippingNode.HARDWARE)
  return node
}

// The planes the builder clips the object by, as three's clipping context holds them, or null with none
interface ClippingPlanes {
  unionPlanes: unknown[]
  intersectionPlanes: unknown[]
}

const isPlanes = (value: unknown): value is ClippingPlanes =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'unionPlanes')) && Array.isArray(Reflect.get(value, 'intersectionPlanes'))

// The builder's fields and methods the copies use, which three's types don't declare, or null where a three upgrade has
// moved them
interface ClippingBuilder {
  planes: ClippingPlanes | null
  samples: number
  addToStack(node: Node): void
  hasClipDistances(): boolean
  setHardwareClipping(on: boolean): void
}

function clippingBuilderOf(builder: NodeBuilder): ClippingBuilder | null {
  const context: unknown = Reflect.get(builder, 'clippingContext')
  const stack: unknown = Reflect.get(builder, 'stack')
  const isAvailable: unknown = Reflect.get(builder, 'isAvailable')
  const addToStack: unknown = typeof stack === 'object' && stack !== null ? Reflect.get(stack, 'addToStack') : undefined
  if ((context !== null && !isPlanes(context)) || typeof addToStack !== 'function' || typeof isAvailable !== 'function') return null
  if (typeof Reflect.get(builder, 'hardwareClipping') !== 'boolean') return null
  return {
    planes: context,
    samples: builder.renderer.currentSamples,
    addToStack: (node) => Reflect.apply(addToStack, stack, [node]),
    hasClipDistances: () => Reflect.apply(isAvailable, builder, ['clipDistance']) === true,
    setHardwareClipping: (on) => Reflect.set(builder, 'hardwareClipping', on),
  }
}

// Gives a material the copies of three's clipping setup, clipping at the rest position. Where three has moved what they
// read, the material keeps three's own, which clips at the posed position, and says so once
let warned = false
export function clipAtRest(material: NodeMaterial) {
  const ownClipping = material.setupClipping.bind(material)
  const ownHardwareClipping = material.setupHardwareClipping.bind(material)
  const fellBack = () => {
    if (warned) return
    warned = true
    console.warn('VisibleHuman: three has changed how it sets clipping up, so a posed body is cut where the pose moves it')
  }

  // A copy of NodeMaterial.setupClipping
  const setupClipping = (builder: NodeBuilder) => {
    const at = clippingBuilderOf(builder)
    if (!at) {
      fellBack()
      return ownClipping(builder)
    }
    if (at.planes === null) return null
    const { unionPlanes, intersectionPlanes } = at.planes
    let result: ClippingNode | null = null
    if (unionPlanes.length > 0 || intersectionPlanes.length > 0) {
      const samples = at.samples
      if (material.alphaToCoverage && samples > 1) {
        // to be added to flow when the color/alpha value has been determined
        result = new RestClippingNode(ClippingNode.ALPHA_TO_COVERAGE)
      } else {
        at.addToStack(new RestClippingNode())
      }
    }
    return result
  }

  // A copy of NodeMaterial.setupHardwareClipping
  const setupHardwareClipping = (builder: NodeBuilder) => {
    const at = clippingBuilderOf(builder)
    if (!at) {
      fellBack()
      ownHardwareClipping(builder)
      return
    }
    at.setHardwareClipping(false)
    if (at.planes === null) return
    const candidateCount = at.planes.unionPlanes.length
    // 8 planes supported by WebGL ANGLE_clip_cull_distance and WebGPU clip-distances
    if (candidateCount > 0 && candidateCount <= 8 && at.hasClipDistances()) {
      at.addToStack(hardwareNode())
      at.setHardwareClipping(true)
    }
  }

  Reflect.set(material, 'setupClipping', setupClipping)
  Reflect.set(material, 'setupHardwareClipping', setupHardwareClipping)
}
