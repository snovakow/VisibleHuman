import { AlwaysDepth, BufferAttribute, BufferGeometry, Color, Group, LineSegments, Matrix4, NoBlending, Points, Sprite, Vector3 } from 'three'
import { float, length, mix, step, uniform, uv } from 'three/tsl'
import { LineBasicNodeMaterial, PointsNodeMaterial, SpriteNodeMaterial, type Camera } from 'three/webgpu'
import { handleNames, type HandleName } from '../motion/ik.ts'
import { boneEnd, byJoint, jointNames, scenePoint, skeletonShape, type JointName } from '../rig/rig.ts'
import { jointPlaces } from '../rig/skeleton.ts'
import type { Posed } from './posed.ts'

// What's drawn over a posed body: its joints, each bone a line from its joint to the next and each joint a dot, and the
// handles a drag poses it by, a disc at each wrist and each ankle, over everything else, in colours that read against
// the body's own. A last bone runs to where its end lies in the scan, turned with its joint. A motion moves them every
// frame it plays, so the places are worked out in vectors kept for the purpose, and each last bone's end at rest once
// for each binding

// Drawn after the styles' see-through layers and the ray quad, which draw nothing behind them. The handles come just
// ahead of the joints, so that the joints' lines and dots cross them in every view and every blend, rather than as
// the two sort by depth, which a turn of the view changes
const overlayOrder = 2000
const handleOrder = overlayOrder - 1

const lineColour = 0xffb000
const jointColour = 0xff3df0
// A handle's fill and the rim round it, which keeps it apart from a bright skin or a cap
const handleColour = 0x21dcff
const handleRim = 0x06202a
// A handle's width across, in the page's pixels, whatever its distance: wide enough to grab, as a mouse or a finger
// takes it, and narrow enough to leave the wrist or the ankle under it in view
export const handlePixels = 16
// How much of a handle's width is its fill, inside the rim
const fillShare = 0.64

export interface BodyOverlay {
  readonly object: Group
  // Draws the joints and the handles where the posed body's bones stand now, each only where it's asked for
  update(posed: Posed | null, joints: boolean, handles: boolean): void
  // Sizes the handles for the canvas as drawn: its height in the drawing buffer's pixels and how many of those a
  // page's pixel holds. It's called every frame they show, and does nothing while neither changes
  fit(camera: Camera, height: number, pixelRatio: number): void
  // Where a handle stands, as last drawn, or none while the handles aren't
  handlePlace(handle: HandleName): Vector3 | null
  dispose(): void
}

export function createBodyOverlay(): BodyOverlay {
  const bones = jointNames.length
  const linePositions = new Float32Array(bones * 2 * 3)
  const pointPositions = new Float32Array(bones * 3)
  const lineGeometry = new BufferGeometry()
  lineGeometry.setAttribute('position', new BufferAttribute(linePositions, 3))
  const pointGeometry = new BufferGeometry()
  pointGeometry.setAttribute('position', new BufferAttribute(pointPositions, 3))
  const lineMaterial = new LineBasicNodeMaterial({ color: lineColour, depthTest: false, depthWrite: false, transparent: true })
  const pointMaterial = new PointsNodeMaterial({ color: jointColour, size: 6, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true })
  const lines = new LineSegments(lineGeometry, lineMaterial)
  const points = new Points(pointGeometry, pointMaterial)

  // A handle is a disc facing the camera, a fill inside a rim, drawn over the body in every style. It's opaque and
  // writes the nearest depth there is: under the order-independent pass, the see-through layers summed over the opaque
  // things are depth-tested against what the opaque things wrote, so none is summed over a handle, and a handle's
  // colour is its own, where an ordinary transparent overlay would be summed in with the skin. Its blending isn't
  // three's normal blending, which keeps it out of that sum, and it replaces what's behind it, which in the splats'
  // weighted sum makes it the pixel's one colour. Being sorted with the transparent things keeps it after the
  // see-through skin and splats in the ordered blend
  const handleMaterial = new SpriteNodeMaterial({ transparent: true, blending: NoBlending, depthTest: true, depthWrite: true, depthFunc: AlwaysDepth, fog: false })
  handleMaterial.sizeAttenuation = false
  const fromCentre = length(uv().sub(0.5))
  handleMaterial.colorNode = mix(uniform(new Color(handleColour)), uniform(new Color(handleRim)), step(fillShare / 2, fromCentre))
  handleMaterial.maskNode = fromCentre.lessThan(0.5)
  handleMaterial.depthNode = float(0)
  const sprites = handleNames.map((handle) => {
    const sprite = new Sprite(handleMaterial)
    sprite.name = `${handle} handle`
    return sprite
  })

  for (const each of [lines, points, ...sprites]) {
    each.renderOrder = each instanceof Sprite ? handleOrder : overlayOrder
    each.frustumCulled = false
  }
  const group = new Group()
  group.add(lines, points, ...sprites)
  group.visible = false
  const skinning = new Matrix4()
  const places = byJoint(() => new Vector3())
  const end = new Vector3()
  // Each last bone's end where the scan holds it, for the binding they were found for
  let endsOf: Posed | null = null
  const ends = byJoint(() => new Vector3())
  const lineAttribute = lineGeometry.getAttribute('position')
  const pointAttribute = pointGeometry.getAttribute('position')
  let handlesShown = false
  // The sizing the handles were last given, by the projection's vertical scale and the canvas, so each frame that
  // leaves them alone costs a comparison
  let fittedScale = 0
  let fittedHeight = 0
  let fittedRatio = 0

  return {
    object: group,
    update(posed, joints, handles) {
      group.visible = posed !== null && (joints || handles)
      handlesShown = posed !== null && handles
      if (!posed || !group.visible) return
      lines.visible = joints
      points.visible = joints
      for (let n = 0; n < sprites.length; n++) sprites[n].visible = handles
      if (endsOf !== posed) {
        endsOf = posed
        for (const name of jointNames) {
          if (!skeletonShape[name].child) ends[name].copy(scenePoint(posed.placement, posed.placement.center, boneEnd(posed.file.rig, name)))
        }
      }
      jointPlaces(posed.skeleton, places)
      for (let n = 0; n < sprites.length; n++) sprites[n].position.copy(places[handleNames[n]])
      if (!joints) return
      for (let n = 0; n < jointNames.length; n++) {
        const name: JointName = jointNames[n]
        const from = places[name]
        const { child } = skeletonShape[name]
        // A last bone's end, carried from the scan by its joint's skinning matrix
        const to = child
          ? places[child]
          : end.copy(ends[name]).applyMatrix4(skinning.copy(posed.skeleton.bones[name].matrixWorld).multiply(posed.bound.bindInverse[name]))
        from.toArray(linePositions, n * 6)
        to.toArray(linePositions, n * 6 + 3)
        from.toArray(pointPositions, n * 3)
      }
      lineAttribute.needsUpdate = true
      pointAttribute.needsUpdate = true
    },
    fit(camera, height, pixelRatio) {
      if (!handlesShown) return
      // A sprite that doesn't shrink with distance spans its scale times the projection's vertical scale in clip
      // space, which is half the canvas's height
      const scale = camera.projectionMatrix.elements[5]
      if (fittedScale === scale && fittedHeight === height && fittedRatio === pixelRatio) return
      fittedScale = scale
      fittedHeight = height
      fittedRatio = pixelRatio
      const size = (2 * handlePixels * pixelRatio) / (scale * height)
      for (const sprite of sprites) sprite.scale.set(size, size, 1)
    },
    handlePlace(handle) {
      return handlesShown ? sprites[handleNames.indexOf(handle)].position : null
    },
    dispose() {
      lineGeometry.dispose()
      pointGeometry.dispose()
      lineMaterial.dispose()
      pointMaterial.dispose()
      handleMaterial.dispose()
    },
  }
}
