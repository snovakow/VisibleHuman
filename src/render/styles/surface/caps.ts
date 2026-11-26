import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, PlaneGeometry, type Plane, type SkinnedMesh } from 'three'
import { attribute, Discard, float, Fn, If, positionWorld, select, uniform, vec4 } from 'three/tsl'
import { ClippingGroup, MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { capMiddle } from '../../../surface/capGrid.ts'
import { capKinds, requestSurface } from '../../../surface/surfaceWorker.ts'
import { boneDensity } from '../../../volume/density.ts'
import { bodyCoverage } from '../../../volume/format.ts'
import type { Bounds } from '../../../volume/levels.ts'
import type { BodySampler } from '../../body/sampler.ts'
import { cutAxes, cutLevels, cutLimits, type Cuts } from '../../cuts.ts'
import type { Posed } from '../../posed.ts'
import { restPosition, setSkinning, skinnedMesh, type CutTest } from './posed.ts'
import { clipAtRest } from './restClipping.ts'

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

// A cap's colour: the section's at a point, see-through outside the skin and, where another test is given, outside
// it too
function sectionColour(sampler: BodySampler, at: Node<'vec3'>, opacity: Node<'float'>, solidFrom: Node<'float'>, outside?: Node<'bool'>) {
  return Fn(() => {
    const beyond = sampler.coverageAt(at).lessThan(skinIso)
    If(outside ? beyond.or(outside) : beyond, () => {
      Discard()
    })
    const texel = sampler.texelAt(at)
    const solid = texel.a.greaterThanEqual(solidFrom)
    return vec4(sampler.colourOf(texel), select(solid, float(1), opacity))
  })()
}

// The caps of the body a sampler reads, which must read the coverage too
export function createCaps(sampler: BodySampler): Caps {
  const opacity = uniform(1)
  const solidFrom = uniform(boneDensity / 255)
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor, polygonOffsetUnits })
  material.colorNode = sectionColour(sampler, positionWorld, opacity, solidFrom)

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

// The caps on a posed body's cuts, which the pose carries with the anatomy: each the section through the body where the
// scan holds it, a grid in its cut's plane at rest with one part for each chain the plane meets, skinned as each
// chain's flesh, coloured and ended at the skin as the unposed caps are, at the rest position, and ended where one
// chain's flesh meets another's across a wall by that chain's side of the walls' measure. A cap is cut by the other
// two cuts at the rest position, as the posed meshes are: by the same clip distances where the backend has them, in a
// clipping group of the two other planes, or else by its material's own test. Each is made again by the mesh worker
// whenever its cut moves, the last one shown until the next arrives, so that dragging a cut never holds the page
// up
export interface PosedCaps {
  readonly object: Group
  update(posed: Posed | null, bounds: Bounds | null, cuts: Cuts, look: CapsLook): void
  dispose(): void
}

// A posed body's cap on one cut: its material, the group it's drawn in, what was last asked of the worker for it, and
// what's drawn
interface PosedCap {
  name: keyof Cuts
  material: MeshBasicNodeMaterial
  holder: Group
  asked: { posed: Posed; level: number; order: number; cancel: () => void } | null
  drawn: { posed: Posed; level: number; order: number; mesh: SkinnedMesh } | null
  // The posed body it's wanted for while shown
  wanted: Posed | null
}

// The cuts in the order cutPlanes gives their planes, each with its plane's place among them
const cutOrder = [
  ['axial', 0],
  ['coronal', 1],
  ['sagittal', 2],
] as const

export function createPosedCaps(sampler: BodySampler, clip: { planes: readonly [Plane, Plane, Plane]; byDistance: boolean; test: CutTest }): PosedCaps {
  const object = new Group()
  const opacity = uniform(1)
  const solidFrom = uniform(boneDensity / 255)
  // The measure, carried from the grid's vertices as a fraction, ends a chain's section below the middle
  const ended = attribute('capMeasure', 'float').lessThan(capMiddle / 255)
  const caps = cutOrder.map(([name, n]) => {
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor, polygonOffsetUnits })
    material.colorNode = sectionColour(sampler, restPosition, opacity, solidFrom, ended)
    let holder: Group = object
    if (clip.byDistance) {
      clipAtRest(material)
      const others = new ClippingGroup()
      others.clippingPlanes = clip.planes.filter((_, m) => m !== n)
      object.add(others)
      holder = others
    } else {
      material.maskNode = clip.test.kept(n)
    }
    const cap: PosedCap = { name, material, holder, asked: null, drawn: null, wanted: null }
    return cap
  })

  // A cap's mesh taken off and disposed of, which frees the uniforms the renderer keeps for it until then, and its
  // geometry freed too
  const forget = (holder: Group, mesh: SkinnedMesh) => {
    holder.remove(mesh)
    mesh.dispose()
    mesh.geometry.dispose()
  }

  const drop = (cap: PosedCap) => {
    cap.asked?.cancel()
    cap.asked = null
    if (!cap.drawn) return
    forget(cap.holder, cap.drawn.mesh)
    cap.drawn = null
  }

  // Asks the worker for a cap's sections at its cut's level, and shows them when they arrive, in place of the last,
  // while the cap is still wanted for that posed body. A newer ask replaces one still waiting in the worker's queue, and
  // leaves one under way to finish and show, rather than cut the worker off, which would cost it the rig and the
  // shell's distances it holds; so a cap dragged without a pause follows it
  let gone = false
  let asks = 0
  const ask = (cap: PosedCap, posed: Posed, level: number) => {
    const pending = requestSurface({ kind: capKinds[cap.name], axis: cutAxes[cap.name], level, rig: { key: posed.key, placement: posed.placement } })
    const asked = { posed, level, order: ++asks, cancel: () => pending.cancel() }
    cap.asked = asked
    pending.result.then(
      ({ mesh: built, skinning, cap: sections, milliseconds }) => {
        if (cap.asked === asked) cap.asked = null
        if (gone || cap.wanted !== posed || (cap.drawn && cap.drawn.order > asked.order) || !skinning || !sections) return
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
        geometry.setAttribute('normal', new BufferAttribute(built.normals, 3))
        geometry.setAttribute('capMeasure', new BufferAttribute(sections.measures.map((measure) => measure / 255), 1))
        geometry.setIndex(new BufferAttribute(built.indices, 1))
        setSkinning(geometry, skinning)
        const mesh = skinnedMesh(geometry, cap.material, posed)
        mesh.renderOrder = capRenderOrder
        if (cap.drawn) {
          forget(cap.holder, cap.drawn.mesh)
        }
        cap.holder.add(mesh)
        cap.drawn = { posed, level, order: asked.order, mesh }
        console.info(
          `VisibleHuman: the posed ${cap.name} cap, ${(built.positions.length / 3).toLocaleString('en')} vertices in ${sections.chains} ` +
            `chains' sections, built in ${Math.round(milliseconds)} ms`,
        )
      },
      (error: unknown) => console.warn(`VisibleHuman: the ${cap.name} cap couldn't be built: ${String(error)}`),
    )
  }

  return {
    object,
    update(posed, bounds, cuts, look) {
      opacity.value = look.opacity
      solidFrom.value = look.solidFrom
      const transparent = look.opacity < 1
      const levels = bounds ? cutLevels(bounds.half, cuts) : null
      for (const cap of caps) {
        if (cap.material.transparent !== transparent) {
          cap.material.transparent = transparent
          cap.material.needsUpdate = true
        }
        const shown = posed !== null && levels !== null && look.shown && cuts[cap.name] > 0
        cap.wanted = shown ? posed : null
        if (!shown) {
          drop(cap)
          continue
        }
        const level = levels[cap.name]
        const wanted = cap.asked ?? cap.drawn
        if (wanted && wanted.posed === posed && wanted.level === level) continue
        // A cap of another posed body goes at once; one of this body stays until the next arrives
        if (cap.drawn && cap.drawn.posed !== posed) drop(cap)
        ask(cap, posed, level)
      }
    },
    dispose() {
      gone = true
      for (const cap of caps) {
        drop(cap)
        cap.material.dispose()
      }
    },
  }
}
