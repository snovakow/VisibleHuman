import { BufferAttribute, BufferGeometry, Group, LineSegments, Matrix4, Points, Vector3 } from 'three'
import { LineBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu'
import { boneEnd, byJoint, jointNames, scenePoint, skeletonShape, type JointName } from '../rig/rig.ts'
import { jointPlaces } from '../rig/skeleton.ts'
import type { Posed } from './posed.ts'

// The joints drawn over a posed body: each bone a line from its joint to the next, each joint a dot, over everything
// else, in colours that read against the body's own, so that a pose can be seen in its skeleton. A last bone runs to
// where its end lies in the scan, turned with its joint. A motion moves them every frame it plays, so the places are
// worked out in vectors kept for the purpose, and each last bone's end at rest once for each binding

// Drawn after the styles' see-through layers and the ray quad, which draw nothing behind them
const overlayOrder = 2000

const lineColour = 0xffb000
const jointColour = 0xff3df0

export interface JointsOverlay {
  readonly object: Group
  // Draws the joints where the posed body's bones stand now, or nothing
  update(posed: Posed | null, shown: boolean): void
  dispose(): void
}

export function createJointsOverlay(): JointsOverlay {
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
  for (const each of [lines, points]) {
    each.renderOrder = overlayOrder
    each.frustumCulled = false
  }
  const group = new Group()
  group.add(lines, points)
  group.visible = false
  const skinning = new Matrix4()
  const places = byJoint(() => new Vector3())
  const end = new Vector3()
  // Each last bone's end where the scan holds it, for the binding they were found for
  let endsOf: Posed | null = null
  const ends = byJoint(() => new Vector3())
  const lineAttribute = lineGeometry.getAttribute('position')
  const pointAttribute = pointGeometry.getAttribute('position')

  return {
    object: group,
    update(posed, shown) {
      group.visible = shown && posed !== null
      if (!posed || !shown) return
      if (endsOf !== posed) {
        endsOf = posed
        for (const name of jointNames) {
          if (!skeletonShape[name].child) ends[name].copy(scenePoint(posed.placement, posed.placement.center, boneEnd(posed.file.rig, name)))
        }
      }
      jointPlaces(posed.skeleton, places)
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
    dispose() {
      lineGeometry.dispose()
      pointGeometry.dispose()
      lineMaterial.dispose()
      pointMaterial.dispose()
    },
  }
}
