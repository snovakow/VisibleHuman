import { DoubleSide, Group, Mesh, PlaneGeometry } from 'three'
import { Discard, float, Fn, If, positionWorld, select, uniform, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { boneDensity } from '../../../volume/density.ts'
import { bodyCoverage } from '../../../volume/format.ts'
import type { Bounds } from '../../../volume/levels.ts'
import type { BodySampler } from '../../body/sampler.ts'
import { cutLimits, type Cuts } from '../../cuts.ts'

// The caps on the surface's cuts: a quad in each active cut's plane, sized to the box the cuts leave, showing the
// section through the body in the photographs' colours, read from the 3D texture at each pixel's place. Outside the
// skin the cap is see-through: it ends where the loaded grid's coverage crosses the skin's isolevel, which at the
// loaded grid's Detail is the line the skin mesh is cut along, so the section is flush with the mesh's edge. At a
// coarser Detail the skin is meshed from the blocks' coverage, so its edge strays from the cap's, by more the coarser
// the blocks are. The density's own edge, which is 0 outside the body, would end half a voxel out in steps along the
// grid. The section of what the Inner choice names is solid while the rest of the tissue's takes the skin's Opacity,
// so a see-through skin shows a see-through section around the solid one of the mesh inside it: the bone's, where the
// density reaches the Bone threshold, or the brain's, where the MRI reaches the MRI threshold. The caps stay outside
// the clipping group, since their size already keeps them within the other cuts

// Drawn ahead of the skin's see-through passes, so that a see-through section is laid over the bone inside before the
// skin is laid over it; among the opaque things the order doesn't matter, since each tests its depth
const capRenderOrder = -4

// The skin's isolevel on the coverage's scale of 0 to 1
const skinIso = bodyCoverage / 255

// Pulls the caps a little toward the eye, so that where a mesh runs along its cut plane the cap wins rather than
// fighting it
const polygonOffsetFactor = -1
const polygonOffsetUnits = -1

// How the caps are drawn
interface CapsLook {
  // Whether the caps are on at all; each then shows while its own cut is open
  shown: boolean
  // How opaque the tissue's part of a section is
  opacity: number
  // The value, from 0 to 1 of the file's scale, from which the section is solid
  solidFrom: number
}

export interface Caps {
  // The three quads, for the surface to draw outside its clipping group
  readonly object: Group
  // Sets each cap on its cut's plane, over the face of the box the cuts leave of the bounds, shown only while its cut
  // is open; with no bounds, between two bodies, there's no section to show
  update(bounds: Bounds | null, cuts: Cuts, look: CapsLook): void
  dispose(): void
}

// The caps of the body a sampler reads, which must read the coverage too
export function createCaps(sampler: BodySampler): Caps {
  const opacity = uniform(1)
  const solidFrom = uniform(boneDensity / 255)
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor, polygonOffsetUnits })
  material.colorNode = Fn(() => {
    If(sampler.coverageAt(positionWorld).lessThan(skinIso), () => {
      Discard()
    })
    const texel = sampler.texelAt(positionWorld)
    const solid = texel.a.greaterThanEqual(solidFrom)
    return vec4(sampler.colourOf(texel), select(solid, float(1), opacity))
  })()

  // Each is a unit square turned into its cut's plane and scaled to the box's face there. The square faces +z: the
  // Axial cap turns to face +y and the Sagittal to face +x
  const geometry = new PlaneGeometry(1, 1)
  const cap = () => {
    const quad = new Mesh(geometry, material)
    quad.renderOrder = capRenderOrder
    quad.visible = false
    return quad
  }
  const axial = cap()
  const coronal = cap()
  const sagittal = cap()
  axial.rotation.x = -Math.PI / 2
  sagittal.rotation.y = Math.PI / 2
  const group = new Group()
  group.add(axial, coronal, sagittal)

  return {
    object: group,
    update(bounds, cuts, look) {
      // The tissue's section takes the skin's Opacity, so the cap is drawn with the see-through things below 1
      opacity.value = look.opacity
      solidFrom.value = look.solidFrom
      const transparent = look.opacity < 1
      if (material.transparent !== transparent) {
        material.transparent = transparent
        material.needsUpdate = true
      }

      axial.visible = bounds !== null && look.shown && cuts.axial > 0
      coronal.visible = bounds !== null && look.shown && cuts.coronal > 0
      sagittal.visible = bounds !== null && look.shown && cuts.sagittal > 0
      if (!bounds) return
      const [hx, hy, hz] = bounds.half
      const { top, front, right } = cutLimits(bounds.half, cuts)
      axial.position.set((right + hx) / 2, top, (front - hz) / 2)
      axial.scale.set(hx - right, front + hz, 1)
      coronal.position.set((right + hx) / 2, (top - hy) / 2, front)
      coronal.scale.set(hx - right, top + hy, 1)
      sagittal.position.set(right, (top - hy) / 2, (front - hz) / 2)
      sagittal.scale.set(front + hz, top + hy, 1)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
