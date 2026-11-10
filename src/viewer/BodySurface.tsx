import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BackSide, BufferAttribute, BufferGeometry, Mesh, Plane, SRGBColorSpace, Uint8BufferAttribute } from 'three'
import { colorSpaceToWorking, max, normalWorldGeometry, positionWorld, uniform, vec3, vec4, vertexColor } from 'three/tsl'
import { ClippingGroup, MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { requestSurface, type SurfaceKind, type SurfaceRequest } from '../surface/surfaceWorker.ts'
import { blockGrid, type BlockGrid } from '../volume/blockGrid.ts'
import { bodyCoverage, scenePosition, type Triple, type Volume } from '../volume/format.ts'
import { labelOf, type Bounds } from '../volume/levels.ts'
import { cutPlanes, type Cuts } from './cuts.ts'
import { isBackShell, isOit } from './styles.ts'
import { createBodySampler, rimAt, type BodySampler } from './surfaceShading.ts'
import { acquireCoverageTexture, acquireVolumeTexture, releaseCoverageTexture, releaseVolumeTexture } from './volumeTexture.ts'

// The Surface style: the skin and the bone meshed by marching cubes in a worker, the skin from the coverage of the
// Detail's blocks at the body decision, so that it lies where the splats do at that Detail, and the bone from the
// loaded grid's density at the Bone threshold; with a Depth, the closed shell that far under the skin, meshed on the
// skin's grid. Each is coloured from the body's 3D texture just inside the surface, or by the colour of the cells
// either side of each vertex, lit by the scene's lights, darkened with depth by the scene's fog, and cut by the three
// planes through one clipping group; the skin is see-through below full Opacity by a depth pass ahead of its colour,
// with its far side under it as a choice, or, with OIT on, by the effects' sum of every layer, which needs no depth pass

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

// The surfaces drawn: the skin, the bone and the shell under the skin
type Drawable = 'skin' | 'bone' | 'shell'

// A drawn surface, which the skin draws four ways and the bone and the shell one each
interface Drawn {
  geometry: BufferGeometry
  meshes: Mesh[]
}

// The materials, which serve every mesh while the style is on
interface Materials {
  skin: MeshStandardNodeMaterial
  skinDepth: MeshBasicNodeMaterial
  back: MeshStandardNodeMaterial
  backDepth: MeshBasicNodeMaterial
  bone: MeshStandardNodeMaterial
  shell: MeshStandardNodeMaterial
}

// The lit materials' colour, by each source the Colour option offers
interface Colourings {
  texture: Node<'vec3'>
  cells: Node<'vec4'>
}

interface Owned {
  materials: Materials
  group: ClippingGroup
  planes: [Plane, Plane, Plane]
  sampler: BodySampler
  opacity: UniformNode<'float'>
  rim: UniformNode<'float'>
  colourings: Colourings
  skin: Drawn | null
  bone: Drawn | null
  shell: Drawn | null
  // Set when the style goes, so that a mesh still on its way then is dropped when it arrives
  gone: boolean
}

export function BodySurface() {
  const get = useThree((s) => s.get)
  const volume = useStore((s) => s.volume)
  const bounds = useStore((s) => s.bounds)
  const cuts = useStore(
    useShallow((s): Cuts => ({ axial: s.options.axial, coronal: s.options.coronal, sagittal: s.options.sagittal })),
  )
  const skinOn = useStore((s) => s.options.skin)
  const boneOn = useStore((s) => s.options.bone)
  const detail = useStore((s) => s.options.detail)
  const colourSource = useStore((s) => s.options.colour)
  const shellDepth = useStore((s) => s.options.depth)
  const boneThreshold = useStore((s) => s.options.boneThreshold)
  const inner = useStore((s) => s.options.inner)
  const mriThreshold = useStore((s) => s.options.mriThreshold)
  const opacity = useStore((s) => s.options.opacity)
  const backShell = useStore((s) => isBackShell(s.options))
  const oit = useStore((s) => isOit(s.options))
  const rim = useStore((s) => s.options.rim)
  const setTriangles = useStore((s) => s.setTriangles)
  const owned = useRef<Owned | null>(null)

  // Owns the materials, the clipping group and its three planes for as long as the style is shown. Each surface's
  // colour is the texture's half a voxel in from the surface along its own outward normal, so a face seen from
  // inside still reads the tissue under it, or its vertices' own, held as sRGB bytes, which the material decodes
  // itself: left to three's vertex colours, they'd be multiplied into the colour node's a second time. The rim is
  // added as light, and, below full Opacity, as cover. The depth-only materials are transparent, though they write no
  // colour, so that they list with the colour materials and draw in their order
  useEffect(() => {
    const { scene } = get()
    const sampler = createBodySampler()
    const opacityUniform = uniform(1)
    const rimUniform = uniform(0)
    const edge = rimAt(rimUniform)
    const fromTexture = sampler.colourAt(positionInside(sampler.halfVoxel))
    const fromCells = colorSpaceToWorking(vec4(vertexColor().xyz, 1), SRGBColorSpace)
    const lit = (roughness: number, side?: typeof BackSide) => {
      const material = new MeshStandardNodeMaterial({ roughness, metalness: 0, ...(side === undefined ? {} : { side }) })
      material.colorNode = fromTexture
      material.emissiveNode = vec3(edge)
      return material
    }
    const materials: Materials = {
      skin: lit(skinRoughness),
      skinDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true }),
      back: lit(skinRoughness, BackSide),
      backDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true, side: BackSide }),
      bone: lit(boneRoughness),
      // The shell is the tissue under the skin, as matte as the skin, and opaque, drawn with the bone inside it
      shell: lit(skinRoughness),
    }
    for (const material of [materials.skin, materials.back]) material.opacityNode = max(opacityUniform, edge)
    const planes: [Plane, Plane, Plane] = [new Plane(), new Plane(), new Plane()]
    const group = new ClippingGroup()
    group.clippingPlanes = planes
    scene.add(group)
    owned.current = {
      materials,
      group,
      planes,
      sampler,
      opacity: opacityUniform,
      rim: rimUniform,
      colourings: { texture: fromTexture, cells: fromCells },
      skin: null,
      bone: null,
      shell: null,
      gone: false,
    }
    return () => {
      const current = owned.current
      if (current) {
        current.gone = true
        discard(current, 'skin')
        discard(current, 'bone')
        discard(current, 'shell')
      }
      scene.remove(group)
      for (const material of Object.values(materials)) material.dispose()
      sampler.dispose()
      owned.current = null
    }
  }, [get])

  // The volume's textures, held while the volume is shown and let go when it changes or this unmounts. The meshes
  // read the colour alone; the sampler takes the coverage too, since the caps' sampler is the same and edges their
  // sections by it
  useEffect(() => {
    const current = owned.current
    if (!current || !volume || !bounds) return undefined
    const colour = acquireVolumeTexture(volume)
    const coverage = acquireCoverageTexture(volume)
    current.sampler.show(colour, coverage, volume, bounds.center)
    return () => {
      releaseCoverageTexture(volume)
      releaseVolumeTexture(volume)
    }
  }, [volume, bounds])

  // The skin, meshed again when the volume or the Detail changes and dropped while its switch is off
  useEffect(() => {
    const current = owned.current
    if (!current) return undefined
    if (!volume || !bounds || !skinOn) {
      discard(current, 'skin')
      setTriangles('skin', undefined)
      return undefined
    }
    const grid = blockGridOf(volume, detail)
    const request = { kind: 'skin', field: grid.coverage, isolevel: bodyCoverage, ...gridOf(volume, grid, bounds) } satisfies SurfaceRequest
    const about = `at ${labelOf(volume, grid.block)}, isolevel ${bodyCoverage}`
    return mesh(current, request, volume, about, setTriangles, (geometry, materials) => {
      const front = new Mesh(geometry, materials.skin)
      const depth = new Mesh(geometry, materials.skinDepth)
      const back = new Mesh(geometry, materials.back)
      const backDepth = new Mesh(geometry, materials.backDepth)
      depth.renderOrder = frontDepthOrder
      back.renderOrder = backOrder
      backDepth.renderOrder = backDepthOrder
      return [backDepth, back, depth, front]
    })
  }, [volume, bounds, skinOn, detail, setTriangles])

  // The bone, meshed again when the volume or the Bone threshold changes, from the density, which a file without
  // one has none of; or, where the Inner surface is the brain, the same mesh from the MRI at the MRI threshold. Only
  // the threshold in use meshes it again
  const isolevel = inner === 'brain' ? mriThreshold : boneThreshold
  useEffect(() => {
    const current = owned.current
    if (!current) return undefined
    const field = inner === 'brain' ? volume?.mri : volume?.density
    if (!volume || !bounds || !boneOn || !field) {
      discard(current, 'bone')
      setTriangles('bone', undefined)
      return undefined
    }
    // On the loaded grid, coloured by its voxels where the colour is the cells'
    const grid = blockGridOf(volume, 1)
    const request = { kind: 'bone', field, isolevel, ...gridOf(volume, grid, bounds) } satisfies SurfaceRequest
    return mesh(current, request, volume, `${inner === 'brain' ? 'from the MRI ' : ''}at isolevel ${isolevel}`, setTriangles, (geometry, materials) => [
      new Mesh(geometry, materials.bone),
    ])
  }, [volume, bounds, boneOn, inner, isolevel, setTriangles])

  // The shell under the skin, on the skin's grid, present while there's a Depth: meshed again when the volume, the
  // Detail or the Depth changes, the worker keeping the grid's distance field from one Depth to the next. The Depth is
  // in millimetres and the field in the grid's voxels, taken as cubes of their mean spacing
  useEffect(() => {
    const current = owned.current
    if (!current) return undefined
    if (!volume || !bounds || !(shellDepth > 0)) {
      discard(current, 'shell')
      setTriangles('shell', undefined)
      return undefined
    }
    const grid = blockGridOf(volume, detail)
    const voxel = (grid.spacing[0] + grid.spacing[1] + grid.spacing[2]) / 3
    const request = {
      kind: 'shell',
      coverage: grid.coverage,
      key: `${volume.body}/${grid.block}/${grid.coverage.byteLength}`,
      depth: shellDepth / voxel,
      ...gridOf(volume, grid, bounds),
    } satisfies SurfaceRequest
    const about =
      `${shellDepth} mm under the skin at ${labelOf(volume, grid.block)} ` +
      `(${(shellDepth / voxel).toFixed(2)} voxels of ${voxel.toFixed(2)} mm)`
    return mesh(current, request, volume, about, setTriangles, (geometry, materials) => [new Mesh(geometry, materials.shell)])
  }, [volume, bounds, detail, shellDepth, setTriangles])

  // The Colour swaps each lit material's colour node, which compiles it again; nothing is meshed again, since every
  // mesh carries its vertices' colours whichever is shown
  useEffect(() => {
    const current = owned.current
    if (!current) return
    const { materials, colourings } = current
    const node = colourSource === 'cells' ? colourings.cells : colourings.texture
    for (const lit of [materials.skin, materials.back, materials.bone, materials.shell]) {
      if (lit.colorNode === node) continue
      lit.colorNode = node
      lit.needsUpdate = true
    }
  }, [colourSource])

  // The cuts move the group's planes in place, so the materials keep their three planes and never recompile
  useEffect(() => {
    const current = owned.current
    if (!current || !bounds) return
    cutPlanes(bounds.half, cuts).forEach(({ normal, constant }, n) => {
      current.planes[n].normal.set(...normal)
      current.planes[n].constant = constant
    })
  }, [bounds, cuts])

  // Below full opacity, the near side's depth pass draws ahead of its colour and hides every layer but the nearest; with
  // the back shell on as well, the far side's two passes draw ahead of both, so that its nearest face shows under the
  // near side's. With OIT on, the effects sum every see-through layer whatever its order, so neither depth pass
  // draws: each would hide the layers the sum is there to show, and, being see-through itself, would join the sum. At
  // full Opacity the skin is opaque and hides its far side, so the back shell draws nothing. The bone stays opaque
  // whatever the Opacity. None of this meshes anything again
  useEffect(() => {
    const current = owned.current
    if (!current) return
    const { materials } = current
    current.opacity.value = opacity
    const transparent = opacity < 1
    for (const colour of [materials.skin, materials.back]) {
      if (colour.transparent !== transparent) {
        colour.transparent = transparent
        colour.needsUpdate = true
      }
    }
    materials.skinDepth.visible = transparent && !oit
    materials.back.visible = backShell
    materials.backDepth.visible = backShell && !oit
  }, [opacity, backShell, oit])

  useEffect(() => {
    const current = owned.current
    if (current) current.rim.value = rim
  }, [rim])

  return null
}

// The point half a voxel inside a surface from a fragment, along the surface's own outward normal, whichever side is
// seen, so that the colour is the tissue's just under the skin or the bone
function positionInside(halfVoxel: Node<'float'>) {
  return positionWorld.sub(normalWorldGeometry.mul(halfVoxel))
}

// The block grids of each volume shown, by block, built on the first ask: the skin, the shell and the bone's colours
// share them, and a Detail shown before is ready at once
const blockGrids = new WeakMap<Volume, Map<number, BlockGrid>>()

function blockGridOf(volume: Volume, block: number) {
  let grids = blockGrids.get(volume)
  if (!grids) {
    grids = new Map()
    blockGrids.set(volume, grids)
  }
  let grid = grids.get(block)
  if (!grid) {
    const start = performance.now()
    grid = blockGrid(volume, block)
    grids.set(block, grid)
    console.info(
      `VisibleHuman: the block grid at ${labelOf(volume, block)}, ${grid.size.join(' × ')} blocks, built in ` +
        `${Math.round(performance.now() - start)} ms`,
    )
  }
  return grid
}

// Where a block grid sits in the scene, for the worker: its blocks' size and spacing, the scene's position of block
// (0, 0, 0), which is its centre's place in the volume's voxels carried through the volume's axes and centred on the
// body's bounds, the axes, and the blocks' colours
function gridOf(volume: Volume, grid: BlockGrid, bounds: Bounds) {
  const at = scenePosition(volume, ...grid.first)
  const origin: Triple = [at[0] - bounds.center[0], at[1] - bounds.center[1], at[2] - bounds.center[2]]
  return { size: grid.size, spacing: grid.spacing, origin, axes: volume.axes, colors: grid.colors }
}

// Whether a surface is still wanted when its mesh arrives: its switch on, or, for the shell, a Depth
function wanted(kind: Drawable) {
  const { options } = useStore.getState()
  return kind === 'shell' ? options.depth > 0 : options[kind]
}

// Asks the worker for a surface and, when it arrives for the volume still shown, draws it in place of the last one,
// which stays until then. Cancelled on cleanup: a mesh already under way still arrives within its grace, and shows,
// unless by then the volume has changed, the surface's switch has gone off or the style has gone
function mesh(
  owned: Owned,
  request: SurfaceRequest & { kind: Drawable },
  volume: Volume,
  about: string,
  setTriangles: (kind: SurfaceKind, count: number | undefined) => void,
  build: (geometry: BufferGeometry, materials: Materials) => Mesh[],
) {
  const { kind } = request
  // A new volume's old surface goes at once, since it belongs to another grid
  if (owned[kind] && owned[kind].geometry.userData.volume !== volume) discard(owned, kind)
  const pending = requestSurface(request)
  pending.result.then(
    ({ mesh: built, milliseconds, distance }) => {
      if (owned.gone || useStore.getState().volume !== volume || !wanted(kind)) return
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
      geometry.setAttribute('normal', new BufferAttribute(built.normals, 3))
      if (built.colors) geometry.setAttribute('color', new Uint8BufferAttribute(built.colors, 3, true))
      geometry.setIndex(new BufferAttribute(built.indices, 1))
      geometry.computeBoundingSphere()
      geometry.userData.volume = volume
      const meshes = build(geometry, owned.materials)
      discard(owned, kind)
      owned.group.add(...meshes)
      owned[kind] = { geometry, meshes }
      const triangles = built.indices.length / 3
      setTriangles(kind, triangles)
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

function discard(owned: Owned, kind: Drawable) {
  const drawn = owned[kind]
  if (!drawn) return
  owned.group.remove(...drawn.meshes)
  drawn.geometry.dispose()
  owned[kind] = null
}
