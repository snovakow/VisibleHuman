import { OrbitControls, Stats } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef, type RefObject } from 'react'
import { MathUtils, PerspectiveCamera } from 'three'
import { useStore } from '../store.ts'
import { BodySplats } from './BodySplats.tsx'

// Room around the body when it's framed
const frameMargin = 1.1
// How far back zooming out can go, and where the far plane sits, as multiples of the framing distance
const maxZoomOut = 3
const farPerDistance = 4

interface FramingProps {
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>
}

// Once the body has loaded, it's framed whole from the front, head up, with the orbit target on its centre, which sits
// at the origin. The camera backs off until the body's height, or its width in a narrow window, fits the view, and its
// front half is added, since the front is nearer the camera than the centre
function Framing({ controlsRef }: FramingProps) {
  const get = useThree((s) => s.get)
  const bounds = useStore((s) => s.bounds)

  useEffect(() => {
    const controls = controlsRef.current
    const { camera } = get()
    if (!bounds || !controls || !(camera instanceof PerspectiveCamera)) return
    const [halfWidth, halfHeight, halfDepth] = bounds.half
    const tanHalfFov = Math.tan(MathUtils.degToRad(camera.fov) / 2)
    const fit = Math.max(halfHeight / tanHalfFov, halfWidth / (tanHalfFov * camera.aspect))
    const distance = fit * frameMargin + halfDepth

    camera.position.set(0, 0, distance)
    camera.up.set(0, 1, 0)
    camera.far = distance * farPerDistance
    camera.updateProjectionMatrix()
    controls.maxDistance = distance * maxZoomOut
    controls.target.set(0, 0, 0)
    controls.update()
  }, [get, controlsRef, bounds])

  return null
}

export function Viewer() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} />
      <BodySplats />
    </>
  )
}
