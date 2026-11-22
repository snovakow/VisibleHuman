import type { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef, type RefObject } from 'react'
import { MathUtils, PerspectiveCamera } from 'three'
import { useStore } from '../store.ts'
import { frameFrom, type ViewAngle } from './viewAngle.ts'

// Room around the body when it's framed
const frameMargin = 1.1
// How far back zooming out can go, and where the far plane sits, as multiples of the framing distance
const maxZoomOut = 3
const farPerDistance = 4

interface FramingProps {
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>
  // The angle each body is framed from
  view: ViewAngle
}

// Once the body has loaded, it's framed whole from the view angle, head up, with the orbit target on its centre, which
// sits at the origin. The camera backs off along the angle until every corner of the body's bounds fits the view, by
// its height or, in a narrow window, its width, each corner at its own depth, so that the near side, which is nearer
// the camera than the centre, fits too.
// That happens when a body arrives where none was shown: on the first load, and on each change of body, which drops
// the bounds of the body before while the next loads. Another level of the same body replaces the bounds with no gap
// between, the same body a little finer or coarser, so the camera stays where it was left
export function Framing({ controlsRef, view }: FramingProps) {
  const get = useThree((s) => s.get)
  const bounds = useStore((s) => s.bounds)
  const framed = useRef(false)

  useEffect(() => {
    if (!bounds) {
      framed.current = false
      return
    }
    const controls = controlsRef.current
    const { camera } = get()
    if (framed.current || !controls || !(camera instanceof PerspectiveCamera)) return
    const tanHalfFov = Math.tan(MathUtils.degToRad(camera.fov) / 2)
    const { toward, distance } = frameFrom(bounds.half, view, tanHalfFov, camera.aspect, frameMargin)

    camera.position.fromArray(toward).multiplyScalar(distance)
    camera.up.set(0, 1, 0)
    camera.far = distance * farPerDistance
    camera.updateProjectionMatrix()
    controls.maxDistance = distance * maxZoomOut
    controls.target.set(0, 0, 0)
    controls.update()
    framed.current = true
  }, [get, controlsRef, bounds, view])

  return null
}
