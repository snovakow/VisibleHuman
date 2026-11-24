import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { lookOf } from '../look.ts'
import { asWebGPU } from '../render/backend.ts'
import { createStage, type Stage } from '../render/stage.ts'
import { useStore } from '../store.ts'

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
    const feed = ({ volume, bounds, levels, options }: ReturnType<typeof useStore.getState>) => {
      made.setBody(volume && bounds && levels ? { volume, bounds, levels } : null)
      made.setLook(lookOf(options))
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
