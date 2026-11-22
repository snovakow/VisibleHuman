import type { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import { useStore } from '../store.ts'
import { swayAngle } from './viewAngle.ts'

// Ahead of the controls' own update, at −1, which then turns the camera to its target from where the sway left it
const swayPriority = -2
// The most a frame moves the sway on, in seconds, so that the first frame after a hidden tab doesn't jump the view
const longestStep = 0.1
const vertical = new Vector3(0, 1, 0)
// The camera's place relative to the target, worked in place each frame
const offset = new Vector3()

interface SwayProps {
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>
}

// Sways the view to and fro about the vertical through the orbit target while the store says to. Each frame turns the
// camera by the change in the sway's angle since the last, so the sway swings about wherever the view stood when it
// started, at the distance and the height the visitor left it at; it starts again from rest when it's switched on and
// when a body arrives where none was shown, about the framing the body opens at. The visitor's first drag, scroll or
// pinch stops it, as the controls start to move the view, and the panel's switch shows it stopped
export function Sway({ controlsRef }: SwayProps) {
  const swaying = useStore((s) => s.swaying)
  const bounds = useStore((s) => s.bounds)
  const elapsed = useRef(0)
  const angle = useRef(0)
  // Whether no body has been shown since the last was dropped, as a change of body drops it
  const unframed = useRef(true)

  useEffect(() => {
    if (!swaying) return
    elapsed.current = 0
    angle.current = 0
  }, [swaying])

  useEffect(() => {
    if (!bounds) {
      unframed.current = true
      return
    }
    if (!unframed.current) return
    unframed.current = false
    elapsed.current = 0
    angle.current = 0
  }, [bounds])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return undefined
    const stop = () => useStore.getState().setSwaying(false)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controlsRef])

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current
    if (!swaying || !bounds || !controls) return
    elapsed.current += Math.min(delta, longestStep)
    const next = swayAngle(elapsed.current)
    const { target } = controls
    offset.copy(camera.position).sub(target).applyAxisAngle(vertical, next - angle.current)
    camera.position.copy(target).add(offset)
    angle.current = next
  }, swayPriority)

  return null
}
