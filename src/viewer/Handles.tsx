import type { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, type ComponentRef, type RefObject } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { handleNames, type HandleName } from '../motion/ik.ts'
import { handlePixels } from '../render/overlay.ts'
import type { Stage } from '../render/stage.ts'
import { useStore } from '../store.ts'

// How far from a handle's centre a press still takes it, in the page's pixels: its own radius and a little more, as a
// press lands a few pixels off what it aims at
const pressReach = handlePixels / 2 + 4

interface HandlesProps {
  stage: RefObject<Stage | null>
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>
}

// Drags the handles the stage draws at the posed body's wrists and ankles. The stage draws them in its own overlay,
// which React's ray casting never sees, so the pointer is read here: a press finds the handle under it from where each
// stands on the canvas, and a drag moves that handle's target across the plane through it that faces the camera, so
// the handle stays under the pointer while the limb can reach it. The orbit controls listen on the canvas's parent, so
// listening on the canvas itself hears a press first, and the controls are held before they see it: they start no
// orbit and send no start event, which is what stops the sway, so the sway is stopped here. Letting go hands the
// store what the drag left, and gives the controls back
export function Handles({ stage, controlsRef }: HandlesProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const canvas = gl.domElement
    const ray = new Raycaster()
    const pointer = new Vector2()
    const plane = new Plane()
    const facing = new Vector3()
    const onPlane = new Vector3()
    // From where the pointer meets the plane to the handle's centre, kept so that a press off centre doesn't jump it
    const grip = new Vector3()
    const onScreen = new Vector3()
    // The pointer dragging a handle, or none
    let held: number | null = null

    // The handle nearest the pointer, within a press's reach of its centre, or none
    const under = (event: PointerEvent): HandleName | null => {
      const drawn = stage.current
      if (!drawn) return null
      const rect = canvas.getBoundingClientRect()
      let found: HandleName | null = null
      let nearest = pressReach
      for (const handle of handleNames) {
        const place = drawn.handlePlace(handle)
        if (!place) continue
        onScreen.copy(place).project(camera)
        // Beyond the far plane or behind the camera
        if (Math.abs(onScreen.z) > 1) continue
        const x = rect.left + ((onScreen.x + 1) / 2) * rect.width
        const y = rect.top + ((1 - onScreen.y) / 2) * rect.height
        const distance = Math.hypot(event.clientX - x, event.clientY - y)
        if (distance <= nearest) {
          nearest = distance
          found = handle
        }
      }
      return found
    }

    // Where the pointer's ray meets the drag's plane, or none where it runs parallel to it
    const meet = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2)
      ray.setFromCamera(pointer, camera)
      return ray.ray.intersectPlane(plane, onPlane)
    }

    const end = () => {
      if (held === null) return
      held = null
      const offsets = stage.current?.release()
      if (offsets) useStore.getState().setOffsets(offsets)
      const controls = controlsRef.current
      if (controls) controls.enabled = true
      canvas.style.cursor = ''
    }

    const press = (event: PointerEvent) => {
      if (held !== null || event.button !== 0 || !event.isPrimary) return
      const drawn = stage.current
      const handle = under(event)
      const place = handle ? drawn?.handlePlace(handle) : null
      if (!drawn || !handle || !place) return
      camera.getWorldDirection(facing)
      plane.setFromNormalAndCoplanarPoint(facing, place)
      if (!meet(event) || !drawn.grab(handle)) return
      grip.copy(place).sub(onPlane)
      const controls = controlsRef.current
      if (controls) controls.enabled = false
      useStore.getState().setSwaying(false)
      held = event.pointerId
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }

    const move = (event: PointerEvent) => {
      if (held === null) {
        // A handle under a pointer that isn't pressed says it can be taken
        if (event.buttons === 0) canvas.style.cursor = under(event) ? 'grab' : ''
        return
      }
      if (event.pointerId !== held || !meet(event)) return
      stage.current?.drag(onPlane.add(grip))
    }

    const release = (event: PointerEvent) => {
      if (event.pointerId === held) end()
    }

    canvas.addEventListener('pointerdown', press)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('lostpointercapture', release)
    return () => {
      canvas.removeEventListener('pointerdown', press)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', release)
      canvas.removeEventListener('pointercancel', release)
      canvas.removeEventListener('lostpointercapture', release)
      end()
    }
  }, [gl, camera, stage, controlsRef])

  return null
}
