import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { lookOf } from '../look.ts'
import { rotationsOfAngles } from '../motion/angles.ts'
import { asWebGPU } from '../render/backend.ts'
import { createStage, type Motion, type Stage } from '../render/stage.ts'
import { scanRotations } from '../rig/pose.ts'
import { noMotion, scanMotion, styleMoves, useStore } from '../store.ts'

type StoreState = ReturnType<typeof useStore.getState>

// The motion the stage draws the body in, as the store has it: none until the body's rig is in, and, for a motion of
// the library's, its pose. While a pose picked is still on its way the body holds the one it was drawn in, so that
// going from one pose to the next never lets it go between, which would mesh it unposed and then posed again. The same
// object comes back while nothing it's made from changes, so a store change that doesn't touch it turns no bones
let lastMotion: { from: readonly unknown[]; motion: Motion | null } | null = null
function motionOf({ motion, rig, motionPose, volume, showJoints }: StoreState): Motion | null {
  const from = [motion, rig, motionPose, volume?.axes, showJoints]
  if (lastMotion && lastMotion.from.every((value, n) => value === from[n])) return lastMotion.motion
  let made: Motion | null = null
  if (motion !== noMotion && rig && volume) {
    const held = lastMotion?.from[1] === rig ? lastMotion.motion : null
    if (motion === scanMotion) made = { rotations: scanRotations(rig.rig, volume.axes), joints: showJoints }
    else if (motionPose) made = { rotations: rotationsOfAngles(motionPose), joints: showJoints }
    else if (held) made = held.joints === showJoints ? held : { ...held, joints: showJoints }
  }
  lastMotion = { from, motion: made }
  return made
}

// Above R3F's own render, which a frame callback at a higher priority takes over for as long as it's mounted
const renderPriority = 1

// The stage in the Canvas: made for the Canvas's renderer, scene and camera, which last as long as the Canvas does,
// handed the store's body and look as they change, asked for each frame, and disposed of with the Canvas, which a
// switch of backend mounts anew. The store is read straight from its subscription rather than through React, so a
// slider's drag reaches the stage as it moves and renders no component on the way; the stage takes whatever it was
// handed since the last frame into the scene as it draws the next. It writes back to the store only what it reports,
// the first draw and the meshes' counts
export function StageHost() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const stage = useRef<Stage | null>(null)

  useEffect(() => {
    const { drawn, setTriangles } = useStore.getState()
    const made = createStage(asWebGPU(gl), scene, camera, { drawn, meshed: setTriangles })
    const feed = (state: StoreState) => {
      const { volume, bounds, levels, options, rig, posedLevels } = state
      made.setBody(volume && bounds && levels ? { volume, bounds, levels, rig, posedLevels } : null)
      made.setLook(lookOf(options))
      made.setMotion(styleMoves(options.style) ? motionOf(state) : null)
    }
    feed(useStore.getState())
    const unsubscribe = useStore.subscribe(feed)
    stage.current = made
    return () => {
      unsubscribe()
      stage.current = null
      made.dispose()
    }
  }, [gl, scene, camera])

  // The frame callback subscribes before the stage is made, so until then it renders the scene as R3F would
  useFrame((state) => {
    if (stage.current) stage.current.render()
    else state.gl.render(state.scene, state.camera)
  }, renderPriority)

  return null
}
