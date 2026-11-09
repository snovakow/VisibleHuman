import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BackSide, BufferAttribute, BufferGeometry, Mesh, Plane } from 'three'
import { max, normalWorldGeometry, positionWorld, uniform, vec3 } from 'three/tsl'
import { ClippingGroup, MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import { requestSurface, type SurfaceKind } from '../surface/surfaceWorker.ts'
import { bodyCoverage, type Volume } from '../volume/format.ts'
import type { Bounds } from '../volume/levels.ts'
import { cutPlanes, type Cuts } from './cuts.ts'
import { isBackShell } from './styles.ts'
import { createBodySampler, rimAt, type BodySampler } from './surfaceShading.ts'
import { acquireCoverageTexture, acquireVolumeTexture, releaseCoverageTexture, releaseVolumeTexture } from './volumeTexture.ts'

// The Surface style: the skin and the bone meshed by marching cubes in a worker, the skin from the coverage at the
// body decision and the bone from the density at the Bone threshold, each coloured from the body's 3D texture just
// inside the surface, lit by the scene's lights, cut by the three planes through one clipping group, and the skin
// see-through below full Opacity by a depth pass ahead of its colour, with its far side under it as a choice

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

// A drawn surface, which the skin draws four ways and the bone one
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
}

interface Owned {
  materials: Materials
  group: ClippingGroup
  planes: [Plane, Plane, Plane]
  sampler: BodySampler
  opacity: UniformNode<'float'>
  rim: UniformNode<'float'>
  skin: Drawn | null
  bone: Drawn | null
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
  const boneThreshold = useStore((s) => s.options.boneThreshold)
  const opacity = useStore((s) => s.options.opacity)
  const backShell = useStore((s) => isBackShell(s.options))
  const rim = useStore((s) => s.options.rim)
  const setTriangles = useStore((s) => s.setTriangles)
  const owned = useRef<Owned | null>(null)

  // Owns the materials, the clipping group and its three planes for as long as the style is shown. Each surface's
  // colour is the texture's half a voxel in from the surface along its own outward normal, so a face seen from
  // inside still reads the tissue under it; the rim is added as light, and, below full Opacity, as cover. The
  // depth-only materials are transparent, though they write no colour, so that they list with the colour materials
  // and draw in their order
  useEffect(() => {
    const { scene } = get()
    const sampler = createBodySampler()
    const opacityUniform = uniform(1)
    const rimUniform = uniform(0)
    const edge = rimAt(rimUniform)
    const lit = (roughness: number, side?: typeof BackSide) => {
      const material = new MeshStandardNodeMaterial({ roughness, metalness: 0, ...(side === undefined ? {} : { side }) })
      material.colorNode = sampler.colourAt(positionInside(sampler.halfVoxel))
      material.emissiveNode = vec3(edge)
      return material
    }
    const materials: Materials = {
      skin: lit(skinRoughness),
      skinDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true }),
      back: lit(skinRoughness, BackSide),
      backDepth: new MeshBasicNodeMaterial({ colorWrite: false, transparent: true, side: BackSide }),
      bone: lit(boneRoughness),
    }
    for (const material of [materials.skin, materials.back]) material.opacityNode = max(opacityUniform, edge)
    const planes: [Plane, Plane, Plane] = [new Plane(), new Plane(), new Plane()]
    const group = new ClippingGroup()
    group.clippingPlanes = planes
    scene.add(group)
    owned.current = { materials, group, planes, sampler, opacity: opacityUniform, rim: rimUniform, skin: null, bone: null, gone: false }
    return () => {
      const current = owned.current
      if (current) {
        current.gone = true
        discard(current, 'skin')
        discard(current, 'bone')
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

  // The skin, meshed again when the volume changes and dropped while its switch is off
  useEffect(() => {
    const current = owned.current
    if (!current) return undefined
    if (!volume || !bounds || !skinOn) {
      discard(current, 'skin')
      setTriangles('skin', undefined)
      return undefined
    }
    return mesh(current, 'skin', volume, bounds, volume.coverage, bodyCoverage, setTriangles, (geometry, materials) => {
      const front = new Mesh(geometry, materials.skin)
      const depth = new Mesh(geometry, materials.skinDepth)
      const back = new Mesh(geometry, materials.back)
      const backDepth = new Mesh(geometry, materials.backDepth)
      depth.renderOrder = frontDepthOrder
      back.renderOrder = backOrder
      backDepth.renderOrder = backDepthOrder
      return [backDepth, back, depth, front]
    })
  }, [volume, bounds, skinOn, setTriangles])

  // The bone, meshed again when the volume or the Bone threshold changes, from the density, which a file without
  // one has none of
  useEffect(() => {
    const current = owned.current
    if (!current) return undefined
    if (!volume || !bounds || !boneOn || !volume.density) {
      discard(current, 'bone')
      setTriangles('bone', undefined)
      return undefined
    }
    return mesh(current, 'bone', volume, bounds, volume.density, boneThreshold, setTriangles, (geometry, materials) => [
      new Mesh(geometry, materials.bone),
    ])
  }, [volume, bounds, boneOn, boneThreshold, setTriangles])

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
  // near side's. At full Opacity the skin is opaque and hides its far side, so the back shell draws nothing. The bone
  // stays opaque whatever the Opacity. None of this meshes anything again
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
    materials.skinDepth.visible = transparent
    materials.back.visible = backShell
    materials.backDepth.visible = backShell
  }, [opacity, backShell])

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

// Asks the worker for a surface and, when it arrives for the volume still shown, draws it in place of the last one,
// which stays until then. Cancelled on cleanup: a mesh already under way still arrives within its grace, and shows,
// unless by then the volume has changed, the surface's switch has gone off or the style has gone
function mesh(
  owned: Owned,
  kind: 'skin' | 'bone',
  volume: Volume,
  bounds: Bounds,
  field: Uint8Array,
  isolevel: number,
  setTriangles: (kind: SurfaceKind, count: number | undefined) => void,
  build: (geometry: BufferGeometry, materials: Materials) => Mesh[],
) {
  // A new volume's old surface goes at once, since it belongs to another grid
  if (owned[kind] && owned[kind].geometry.userData.volume !== volume) discard(owned, kind)
  const [cx, cy, cz] = bounds.center
  const request = requestSurface({
    kind,
    field,
    size: volume.size,
    spacing: volume.spacing,
    origin: [-cx, -cy, -cz],
    axes: volume.axes,
    isolevel,
  })
  request.result.then(
    ({ mesh: built, milliseconds }) => {
      const { volume: shown, options } = useStore.getState()
      if (owned.gone || shown !== volume || !options[kind]) return
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
      geometry.setAttribute('normal', new BufferAttribute(built.normals, 3))
      geometry.setIndex(new BufferAttribute(built.indices, 1))
      geometry.computeBoundingSphere()
      geometry.userData.volume = volume
      const meshes = build(geometry, owned.materials)
      discard(owned, kind)
      owned.group.add(...meshes)
      owned[kind] = { geometry, meshes }
      const triangles = built.indices.length / 3
      setTriangles(kind, triangles)
      console.info(
        `VisibleHuman: the ${kind} at isolevel ${isolevel}: ${(built.positions.length / 3).toLocaleString('en')} vertices, ` +
          `${triangles.toLocaleString('en')} triangles, meshed in ${Math.round(milliseconds)} ms`,
      )
    },
    (error: unknown) => console.warn(`VisibleHuman: the ${kind} couldn't be meshed: ${String(error)}`),
  )
  return () => request.cancel()
}

function discard(owned: Owned, kind: 'skin' | 'bone') {
  const drawn = owned[kind]
  if (!drawn) return
  owned.group.remove(...drawn.meshes)
  drawn.geometry.dispose()
  owned[kind] = null
}
