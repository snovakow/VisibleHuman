import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { AnimationClip } from 'three'
import { lookOf } from '../look.ts'
import type { Layer } from '../motion/animator.ts'
import { clipOf, layerClip, poseClip, type MotionFile } from '../motion/clip.ts'
import { asWebGPU } from '../render/backend.ts'
import { createStage, type Motion, type Stage } from '../render/stage.ts'
import { scanRotations } from '../rig/pose.ts'
import type { RigFile } from '../rig/rigFile.ts'
import type { SceneAxes } from '../volume/format.ts'
import { noMotion, scanMotion, styleMoves, useStore } from '../store.ts'

type StoreState = ReturnType<typeof useStore.getState>

// Each motion file's clip, and its clip as a layer, made once, so that the animator meets the same clip again and
// goes on with the action it made for it
const clips = new WeakMap<MotionFile, AnimationClip>()
const layerClips = new WeakMap<MotionFile, AnimationClip>()
const clipFor = (id: string, file: MotionFile) => {
  let clip = clips.get(file)
  if (!clip) clips.set(file, (clip = clipOf(id, file)))
  return clip
}
const layerFor = (id: string, file: MotionFile) => {
  let clip = layerClips.get(file)
  if (!clip) layerClips.set(file, (clip = layerClip(clipFor(id, file))))
  return clip
}
// The scan's pose as a clip, for the rig and the axes it was made for
let scanned: { rig: RigFile; axes: SceneAxes; clip: AnimationClip } | null = null
const scanClipFor = (rig: RigFile, axes: SceneAxes) => {
  if (scanned?.rig !== rig || scanned.axes !== axes) scanned = { rig, axes, clip: poseClip(scanMotion, scanRotations(rig.rig, axes)) }
  return scanned.clip
}

// The layers mixed over the motion, those with a weight whose file is in, the same list while they're the same, so a
// file arriving for the motion itself hands the animator no layers afresh
let lastLayers: { weights: StoreState['layers']; files: StoreState['motionFiles']; layers: readonly Layer[] } | null = null
function layersOf({ layers: weights, motionFiles: files }: StoreState): readonly Layer[] {
  if (lastLayers?.weights === weights && lastLayers.files === files) return lastLayers.layers
  const made = Object.entries(weights).flatMap(([id, weight]) => {
    const file = files[id]
    return file && weight > 0 ? [{ clip: layerFor(id, file), weight }] : []
  })
  const last = lastLayers?.layers
  const same = last?.length === made.length && made.every((layer, n) => layer.clip === last[n].clip && layer.weight === last[n].weight)
  const layers = same && last ? last : made
  lastLayers = { weights, files, layers }
  return layers
}

// The motion the stage draws the body in, as the store has it: none until the body's rig is in, and, for a motion of
// the library's, its clip once its file is. While a motion picked is still on its way the body holds the one it was
// drawn in, so that going from one motion to the next never lets it go between, which would mesh it unposed and then
// posed again. The same object comes back while nothing it's made from changes, so a store change that doesn't touch
// it hands the animator nothing
let lastMotion: { from: readonly unknown[]; motion: Motion | null } | null = null
function motionOf(state: StoreState): Motion | null {
  const { motion, rig, motionFiles, volume, showJoints, speed, playing, steps } = state
  const layers = layersOf(state)
  const from = [motion, rig, motionFiles, volume?.axes, showJoints, layers, speed, playing, steps]
  if (lastMotion && lastMotion.from.every((value, n) => value === from[n])) return lastMotion.motion
  let clip: AnimationClip | null = null
  if (motion !== noMotion && rig && volume) {
    const file = motionFiles[motion]
    if (motion === scanMotion) clip = scanClipFor(rig, volume.axes)
    else if (file) clip = clipFor(motion, file)
    else if (lastMotion?.from[1] === rig) clip = lastMotion.motion?.clip ?? null
  }
  const made = clip ? { clip, layers, speed, playing, steps, joints: showJoints } : null
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
  useFrame((state, delta) => {
    if (stage.current) stage.current.render(delta)
    else state.gl.render(state.scene, state.camera)
  }, renderPriority)

  return null
}
