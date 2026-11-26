import { BackSide, BufferAttribute, BufferGeometry, Group, HemisphereLight, Mesh, Plane, PointLight, SRGBColorSpace, Uint8BufferAttribute, type Material } from 'three'
import { colorSpaceToWorking, context, max, uniform, vec3, vec4, vertexColor } from 'three/tsl'
import { ClippingGroup, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { installRig, requestSurface, type RigRequest, type SurfaceRequest } from '../../../surface/surfaceWorker.ts'
import type { MeshSkinning, SkinningMode } from '../../../surface/rigSkin.ts'
import { bodyCoverage, type Triple, type Volume } from '../../../volume/format.ts'
import { labelOf } from '../../../volume/levels.ts'
import { hasClipDistances } from '../../backend.ts'
import type { Body } from '../../body/body.ts'
import { createBodySampler, type Channel } from '../../body/sampler.ts'
import { cutPlanes } from '../../cuts.ts'
import type { SurfaceLook } from '../../look.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import type { Posed } from '../../posed.ts'
import { createCaps, createPosedCaps } from './caps.ts'
import { blockGridOf, gridOf } from './grids.ts'
import { createCutTest, createSkinMatrices, restNormal, restPosition, setSkinning, skinnedMesh, wallShown } from './posed.ts'
import { clipAtRest } from './restClipping.ts'
import { isBackShell, isOit } from './rules.ts'
import { positionInside, rimAt } from './shading.ts'

// The Surface style: the skin and the bone meshed by marching cubes in a worker, the skin from the coverage of the
// Detail's blocks at the body decision, so that it lies where the splats do at that Detail, and the bone from the
// loaded grid's density at the Bone threshold; with a Depth, the closed shell that far under the skin, meshed on the
// skin's grid. Each is coloured from the body's 3D texture just inside the surface, or by the colour of the cells
// either side of each vertex, lit by the style's own lights, darkened with depth by the scene's fog, and cut by the
// three planes through one clipping group, with a cap on each open cut; a posed body is cut where the scan holds each
// point, so its cuts stay with the anatomy, and its caps and shell are skinned with it. The skin is see-through below
// full Opacity by a depth pass ahead of its colour, with its far side under it as a choice, or, with OIT on, by the
// frame's sum of every layer, which needs no depth pass

// A see-through skin's draws, in the order they go, each ahead of the colour's at three's default of 0: the far
// side's depth alone, then its colour, then the near side's depth alone, then its colour. All four list with the
// transparent objects, which are drawn in this order after everything opaque, so that each side's depth pass hides the
// layers behind that side's nearest face and leaves the other side's alone
const backDepthOrder = -3
const backOrder = -2
const frontDepthOrder = -1

// How matte each surface is: the skin duller than the bone
const skinRoughness = 0.6
const boneRoughness = 0.4

// The light the meshes are lit by: the sky's and the ground's from above and below, and a headlight that follows the
// camera, so the side in view is always lit
const skyColour = '#ffffff'
const groundColour = '#404040'
const skyIntensity = 1
const headlightIntensity = 2.2

// The surfaces drawn: the skin, the bone and the shell under the skin
const drawables = ['skin', 'bone', 'shell'] as const
type Drawable = (typeof drawables)[number]

// A drawn surface, which the skin draws four ways and the bone and the shell one each, and the volume it's of
interface Drawn {
  geometry: BufferGeometry
  meshes: Mesh[]
  volume: Volume
}

// A surface asked of the worker: what it was asked from, so that the same look asks once, and how to call it off
interface Asked {
  from: readonly unknown[]
  cancel: () => void
}

const sameValues = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, n) => value === b[n])

export function createSurface({ events, renderer }: StyleContext): StyleDrawing {
  const root = new Group()
  const headlight = new PointLight()
  headlight.decay = 0
  headlight.intensity = headlightIntensity
  root.add(new HemisphereLight(skyColour, groundColour, skyIntensity), headlight)

  // Each surface's colour is the texture's half a voxel in from the surface along its own outward normal, so a face
  // seen from inside still reads the tissue under it, or its vertices' own, held as sRGB bytes, which the material
  // decodes itself: left to three's vertex colours, they'd be multiplied into the colour node's a second time. The rim
  // is added as light, and, below full Opacity, as cover. The depth-only materials are transparent, though they write
  // no colour, so that they list with the colour materials and draw in their order
  const sampler = createBodySampler({ coverage: true })
  const opacity = uniform(1)
  const rim = uniform(0)
  const edge = rimAt(rim)
  const colourings = {
    texture: sampler.colourOf(sampler.texelAt(positionInside(sampler.leastVoxel.mul(0.5)))),
    cells: colorSpaceToWorking(vec4(vertexColor().xyz, 1), SRGBColorSpace),
  }
  const lit = (roughness: number, side?: typeof BackSide) => {
    const material = new MeshStandardNodeMaterial({ roughness, metalness: 0, ...(side === undefined ? {} : { side }) })
    material.colorNode = colourings.texture
    material.emissiveNode = vec3(edge)
    return material
  }
  const materials = {
    skin: lit(skinRoughness),
    skinDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true }),
    back: lit(skinRoughness, BackSide),
    backDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true, side: BackSide }),
    bone: lit(boneRoughness),
    // The shell is the tissue under the skin, as matte as the skin, and opaque, drawn with the bone inside it
    shell: lit(skinRoughness),
  }
  for (const material of [materials.skin, materials.back]) material.opacityNode = max(opacity, edge)
  // A see-through face's colour is kept only where its depth equals what its depth-only pass wrote, and the two
  // passes are different shaders, which may round the same vertex's position differently: WebGPU did, leaving
  // scattered pixels, more of them nearer the camera, that showed what's behind and moved as the view turned. Marked
  // invariant in both, the position is computed the same way in each
  const samePosition = context({ invariant: true })
  for (const material of [materials.skin, materials.skinDepth, materials.back, materials.backDepth]) {
    material.contextNode = samePosition
  }

  // A posed body is cut at the rest position, where the scan holds each point, so that a cut stays the same section of
  // the anatomy whatever the pose. Where the backend clips by distance, as the unposed meshes are cut, the posed
  // meshes share their clipping group and their materials clip at the rest position by the same distances, so the two
  // cuts' edges are alike; elsewhere they stand outside the group and each material tests the planes itself, the
  // discard three itself falls back to there
  const byDistance = hasClipDistances(renderer)
  const cutTest = createCutTest()

  // The same, for a posed body: each colour read where the scan holds the point rather than where the pose has moved it,
  // and the skin's passes and the shell's, a wall's faces drawn only once the pose has parted it. Made the first time
  // the body is posed
  const posedColourings = {
    texture: sampler.colourOf(sampler.texelAt(restPosition.sub(restNormal.normalize().mul(sampler.leastVoxel.mul(0.5))))),
    cells: colourings.cells,
  }
  let posedMaterials: typeof materials | null = null
  const skinMatrices = createSkinMatrices()
  const posedMaterialsOf = () => {
    if (posedMaterials) return posedMaterials
    const shown = wallShown(skinMatrices)
    const made = {
      skin: lit(skinRoughness),
      skinDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true }),
      back: lit(skinRoughness, BackSide),
      backDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true, side: BackSide }),
      bone: lit(boneRoughness),
      shell: lit(skinRoughness),
    }
    for (const material of [made.skin, made.back, made.bone, made.shell]) material.colorNode = posedColourings.texture
    for (const material of [made.skin, made.back]) material.opacityNode = max(opacity, edge)
    const kept = byDistance ? null : cutTest.kept()
    for (const material of [made.skin, made.skinDepth, made.back, made.backDepth]) material.contextNode = samePosition
    for (const material of [made.skin, made.skinDepth, made.back, made.backDepth, made.shell]) {
      material.maskNode = kept ? shown.and(kept) : shown
    }
    made.bone.maskNode = kept
    if (byDistance) for (const material of Object.values(made)) clipAtRest(material)
    posedMaterials = made
    return made
  }
  const materialsOf = (posed: Posed | null) => (posed ? posedMaterialsOf() : materials)

  // The meshes sit in one clipping group, whose three planes the cuts move in place, so the materials keep their
  // three planes and never recompile; the caps sit outside it. A posed body's meshes sit in the group where they clip
  // by distance, and otherwise in a group of their own, and its caps in theirs
  const planes: [Plane, Plane, Plane] = [new Plane(), new Plane(), new Plane()]
  const group = new ClippingGroup()
  group.clippingPlanes = planes
  const posedGroup = byDistance ? group : new Group()
  const caps = createCaps(sampler)
  const posedCaps = createPosedCaps(sampler, { planes, byDistance, test: cutTest })
  root.add(group, caps.object, posedCaps.object)
  if (posedGroup !== group) root.add(posedGroup)

  const drawn: Record<Drawable, Drawn | null> = { skin: null, bone: null, shell: null }
  const asked: Record<Drawable, Asked | null> = { skin: null, bone: null, shell: null }
  // The body and the look last given, which a mesh is checked against when it arrives; the volume whose textures
  // the sampler reads, with what the colour's fourth channel holds; and whether the style has gone, so that a mesh
  // still on its way then is dropped when it arrives
  let body: Body | null = null
  let surface: SurfaceLook | null = null
  let bound: { volume: Volume; channel: Channel } | null = null
  let gone = false
  // The posed body whose rig the worker was last given
  let lastPosed: Posed | null = null

  // Whether a surface is still wanted when its mesh arrives: its switch on, or, for the shell, a Depth
  const wanted = (kind: Drawable) => surface !== null && (kind === 'shell' ? surface.depth > 0 : surface[kind])

  const discard = (kind: Drawable) => {
    const last = drawn[kind]
    if (!last) return
    // The renderer keeps a mesh's uniforms until the mesh itself is disposed of, a geometry's dispose freeing only its
    // buffers, so a posed mesh's skinning would otherwise stay with each pose shown and taken off
    for (const each of last.meshes) {
      each.removeFromParent()
      each.dispose()
    }
    last.geometry.dispose()
    drawn[kind] = null
  }

  // Asks the worker for a surface and, when it arrives for the volume still shown, draws it in place of the last one,
  // which stays until then. The returned call cancels it: a mesh already under way still arrives within its grace,
  // and shows, unless by then the volume has changed, the surface's switch has gone off or the style has gone
  const mesh = (
    request: SurfaceRequest & { kind: Drawable },
    volume: Volume,
    about: string,
    build: (geometry: BufferGeometry, skinning: MeshSkinning | undefined) => Mesh[],
  ) => {
    const { kind } = request
    // A new volume's old surface goes at once, since it belongs to another grid
    if (drawn[kind] && drawn[kind].volume !== volume) discard(kind)
    const posedAsked = body?.posed ?? null
    const pending = requestSurface(request)
    pending.result.then(
      ({ mesh: built, milliseconds, distance, skinning }) => {
        // A mesh asked for posed, or not, belongs to that body alone
        if (gone || body?.volume !== volume || !wanted(kind) || (body?.posed ?? null) !== posedAsked) return
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
        geometry.setAttribute('normal', new BufferAttribute(built.normals, 3))
        if (built.colors) geometry.setAttribute('color', new Uint8BufferAttribute(built.colors, 3, true))
        geometry.setIndex(new BufferAttribute(built.indices, 1))
        geometry.computeBoundingSphere()
        if (skinning) setSkinning(geometry, skinning)
        const meshes = build(geometry, skinning)
        discard(kind)
        for (const each of meshes) whenFirstDrawn(each, () => events.drawn(volume))
        ;(posedAsked ? posedGroup : group).add(...meshes)
        drawn[kind] = { geometry, meshes, volume }
        const triangles = built.indices.length / 3
        events.meshed(kind, triangles)
        const field = distance
          ? distance.reused
            ? '; its distance field kept from the shell before'
            : `; its distance field computed in ${Math.round(distance.milliseconds)} ms`
          : ''
        console.info(
          `VisibleHuman: the ${kind} ${about}: ${(built.positions.length / 3).toLocaleString('en')} vertices, ` +
            `${triangles.toLocaleString('en')} triangles, meshed in ${Math.round(milliseconds)} ms${field}`,
        )
      },
      (error: unknown) => console.warn(`VisibleHuman: the ${kind} couldn't be meshed: ${String(error)}`),
    )
    return () => pending.cancel()
  }

  // Keeps a surface meshed from what it's made from: asked for again only when that changes, with the request before
  // called off
  const keep = (kind: Drawable, from: readonly unknown[], ask: () => () => void) => {
    const last = asked[kind]
    if (last && sameValues(last.from, from)) return
    last?.cancel()
    asked[kind] = { from, cancel: ask() }
  }

  // Drops a surface, with its count, while there's nothing to make it from
  const drop = (kind: Drawable) => {
    if (!asked[kind] && !drawn[kind]) return
    asked[kind]?.cancel()
    asked[kind] = null
    discard(kind)
    events.meshed(kind, undefined)
  }

  return {
    object: root,
    update(shown, look) {
      body = shown
      surface = look.surface
      const { skin, bone, inner, colour, depth, detail, boneThreshold, mriThreshold } = look.surface

      // The colour with the density, or with the MRI in the density's place while the Inner surface is the brain, so
      // that a cap's section is solid where that mesh is; the meshes read the colour alone, which is the same in both
      const innerIsBrain = inner === 'brain' && shown?.volume.mri !== undefined
      const channel: Channel = innerIsBrain ? 'mri' : 'density'
      if (bound?.volume !== shown?.volume || (bound && bound.channel !== channel)) {
        sampler.bind(shown, channel)
        bound = shown ? { volume: shown.volume, channel } : null
      }

      // A posed body's meshes are skinned to its rig, which the worker is given once for the body, and are meshed again
      // when it's posed or let go
      const posed = shown?.posed ?? null
      if (posed !== lastPosed) {
        installRig(posed?.key ?? null, posed?.file ?? null)
        lastPosed = posed
      }
      const rigOf = (grid: { size: Triple; spacing: Triple; origin: Triple }, mode: SkinningMode): { rig?: RigRequest } =>
        posed ? { rig: { key: posed.key, grid: { size: grid.size, spacing: grid.spacing, origin: grid.origin }, placement: posed.placement, mode } } : {}
      const used = materialsOf(posed)
      const meshOf = (geometry: BufferGeometry, material: Material, skinning: MeshSkinning | undefined) =>
        posed && skinning ? skinnedMesh(geometry, material, posed) : new Mesh(geometry, material)

      // The skin, meshed again when the volume or the Detail changes and dropped while its switch is off
      if (shown && skin) {
        const { volume, bounds } = shown
        keep('skin', [volume, detail, posed], () => {
          const grid = blockGridOf(volume, detail)
          const request = {
            kind: 'skin',
            field: grid.coverage,
            isolevel: bodyCoverage,
            ...gridOf(volume, grid, bounds),
            ...rigOf(grid, 'blended'),
          } satisfies SurfaceRequest
          return mesh(request, volume, `at ${labelOf(volume, grid.block)}, isolevel ${bodyCoverage}`, (geometry, skinning) => {
            const front = meshOf(geometry, used.skin, skinning)
            const frontDepth = meshOf(geometry, used.skinDepth, skinning)
            const back = meshOf(geometry, used.back, skinning)
            const backDepth = meshOf(geometry, used.backDepth, skinning)
            frontDepth.renderOrder = frontDepthOrder
            back.renderOrder = backOrder
            backDepth.renderOrder = backDepthOrder
            return [backDepth, back, frontDepth, front]
          })
        })
      } else drop('skin')

      // The bone, meshed again when the volume or the Bone threshold changes, from the density, which a file without
      // one has none of; or, where the Inner surface is the brain, the same mesh from the MRI at the MRI threshold.
      // Only the threshold in use meshes it again
      const isolevel = inner === 'brain' ? mriThreshold : boneThreshold
      const field = inner === 'brain' ? shown?.volume.mri : shown?.volume.density
      if (shown && bone && field) {
        const { volume, bounds } = shown
        keep('bone', [volume, inner, isolevel, posed], () => {
          // On the loaded grid, coloured by its voxels where the colour is the cells'
          const grid = blockGridOf(volume, 1)
          const request = { kind: 'bone', field, isolevel, ...gridOf(volume, grid, bounds), ...rigOf(grid, 'rigid') } satisfies SurfaceRequest
          const about = `${inner === 'brain' ? 'from the MRI ' : ''}at isolevel ${isolevel}`
          return mesh(request, volume, about, (geometry, skinning) => [meshOf(geometry, used.bone, skinning)])
        })
      } else drop('bone')

      // The shell under the skin, on the skin's grid, present while there's a Depth: meshed again when the volume,
      // the Detail or the Depth changes, the worker keeping the grid's distance field from one Depth to the next. The
      // Depth is in millimetres and the field in the grid's voxels, taken as cubes of their mean spacing. A posed
      // body's shell is measured for each chain from its own side of the walls, and skinned as the skin is
      if (shown && depth > 0) {
        const { volume, bounds } = shown
        keep('shell', [volume, detail, depth, posed], () => {
          const grid = blockGridOf(volume, detail)
          const voxel = (grid.spacing[0] + grid.spacing[1] + grid.spacing[2]) / 3
          const request = {
            kind: 'shell',
            coverage: grid.coverage,
            key: `${volume.body}/${grid.block}/${grid.coverage.byteLength}`,
            depth: depth / voxel,
            ...gridOf(volume, grid, bounds),
            ...rigOf(grid, 'blended'),
          } satisfies SurfaceRequest
          const about =
            `${depth} mm under the skin at ${labelOf(volume, grid.block)} ` +
            `(${(depth / voxel).toFixed(2)} voxels of ${voxel.toFixed(2)} mm)`
          return mesh(request, volume, about, (geometry, skinning) => [meshOf(geometry, used.shell, skinning)])
        })
      } else drop('shell')

      // The Colour swaps each lit material's colour node, which compiles it again; nothing is meshed again, since
      // every mesh carries its vertices' colours whichever is shown
      const colouring = (posed ? posedColourings : colourings)[colour]
      for (const material of [used.skin, used.back, used.bone, used.shell]) {
        if (material.colorNode === colouring) continue
        material.colorNode = colouring
        material.needsUpdate = true
      }

      if (shown) {
        const cut = cutPlanes(shown.bounds.half, look.cuts)
        cut.forEach(({ normal, constant }, n) => {
          planes[n].normal.set(...normal)
          planes[n].constant = constant
        })
        cutTest.set(cut)
      }

      // Below full opacity, the near side's depth pass draws ahead of its colour and hides every layer but the
      // nearest; with the back shell on as well, the far side's two passes draw ahead of both, so that its nearest
      // face shows under the near side's. With OIT on, the frame sums every see-through layer whatever its order, so
      // neither depth pass draws: each would hide the layers the sum is there to show, and, being see-through itself,
      // would join the sum. At full Opacity the skin is opaque and hides its far side, so the back shell draws
      // nothing. The bone stays opaque whatever the Opacity. None of this meshes anything again
      opacity.value = look.surface.opacity
      rim.value = look.surface.rim
      const transparent = look.surface.opacity < 1
      for (const material of [used.skin, used.back]) {
        if (material.transparent === transparent) continue
        material.transparent = transparent
        material.needsUpdate = true
      }
      const oit = isOit(look.surface, look.cuts)
      const backShell = isBackShell(look.surface)
      used.skinDepth.visible = transparent && !oit
      used.back.visible = backShell
      used.backDepth.visible = backShell && !oit

      // A cap's solid part starts at the threshold of the Inner surface. A posed body's caps are its own
      const capsLook = { opacity: look.surface.opacity, solidFrom: (innerIsBrain ? mriThreshold : boneThreshold) / 255 }
      caps.update(shown?.bounds ?? null, look.cuts, { shown: look.surface.caps && !posed, ...capsLook })
      posedCaps.update(posed, shown?.bounds ?? null, look.cuts, { shown: look.surface.caps, ...capsLook })
    },
    beforeFrame(camera) {
      headlight.position.copy(camera.position)
      if (lastPosed) skinMatrices.copyFrom(lastPosed)
    },
    dispose() {
      gone = true
      // The page's counts go with the meshes, so another style, or another body met there, shows none of them
      for (const kind of drawables) drop(kind)
      for (const material of Object.values(materials)) material.dispose()
      if (posedMaterials) for (const material of Object.values(posedMaterials)) material.dispose()
      caps.dispose()
      posedCaps.dispose()
      sampler.dispose()
    },
  }
}
