import type { Quaternion } from 'three'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import type { JointName } from '../rig/rig.ts'
import { isWebGPU } from './backend.ts'
import type { Body, BodySource } from './body/body.ts'
import { createBodyTextures } from './body/textures.ts'
import { createDepthCue } from './depthCue.ts'
import { createCompositor } from './frame/compositor.ts'
import { framePlan } from './frame/plan.ts'
import type { Look, Style } from './look.ts'
import { createJointsOverlay } from './overlay.ts'
import { bindPosed, posePosed, type Posed } from './posed.ts'
import { createStyle } from './styles/create.ts'
import type { StyleDrawing, StyleEvents } from './styles/style.ts'

// The stage: everything drawn in a scene, kept true to the two things it's given, a body and a look. It holds the
// body's textures, the one style the look names, the depth cue the styles share and the compositor that draws each
// frame, and it is the only thing that puts any of them in the scene or takes them out. Nothing here knows of React,
// the panel or the page's store: whoever owns the canvas makes a stage, hands it each new body and look, asks it for
// each frame, and disposes of it with the canvas.
//
// A body or a look handed over is only noted. The scene is brought up to date with them once, ahead of the next frame
// drawn, so however many changes arrive between two frames, the styles see one, and nothing is built for a state no
// frame would have shown.
//
// A style is made when the look first names it and disposed of when the look names another, so only the style drawn
// holds anything on the GPU, and the body's textures go with the last style that reads them.
//
// A body with a rig is drawn posed while a pose is set: its rig is bound to the body as drawn, the styles that can are
// handed it, and each frame turns its bones to the pose last set. With no pose, nothing of the rig is made, and every
// style draws the body as scanned, as it always has

// The pose to draw a rigged body in: each joint's rotation from the neutral pose, and whether its joints are drawn
export interface Motion {
  rotations: Record<JointName, Quaternion>
  joints: boolean
}

export interface Stage {
  // The body to draw from the next frame on, or none between two bodies
  setBody(source: BodySource | null): void
  // The look to draw it with from the next frame on
  setLook(look: Look): void
  // The pose to draw it in from the next frame on, or none, to draw it as scanned. A new pose for the same body turns
  // its bones and rebuilds nothing
  setMotion(motion: Motion | null): void
  // Brings the scene up to date with the body and the look, and draws a frame
  render(): void
  // Frees everything the stage made and leaves the scene as it found it
  dispose(): void
}

// Whether two bodies, or two of what a body is made from, are of the same volume, bounds, levels and rig
function isSame(a: BodySource | null, b: BodySource | null) {
  return a?.volume === b?.volume && a?.bounds === b?.bounds && a?.levels === b?.levels && a?.rig === b?.rig
}

export function createStage(renderer: WebGPURenderer, scene: Scene, camera: Camera, events: StyleEvents): Stage {
  const cue = createDepthCue()
  const compositor = createCompositor(renderer, scene, camera, cue)
  const context = { renderer, camera, webgpu: isWebGPU(renderer), cue, events }
  // The materials that take fog, the surface's, take the depth cue as the scene's
  scene.fogNode = cue.fog

  // What was last handed over, and whether the scene has yet to catch up with it
  let source: BodySource | null = null
  let look: Look | null = null
  let motion: Motion | null = null
  let stale = false
  let turned = false
  // What the scene holds: the body, with its textures and its posed rig, and the style drawing it
  let body: Body | null = null
  let drawn: { style: Style; drawing: StyleDrawing } | null = null
  const overlay = createJointsOverlay()
  scene.add(overlay.object)

  const strike = (last: { drawing: StyleDrawing }) => {
    scene.remove(last.drawing.object)
    last.drawing.dispose()
  }

  // Brings the scene up to date with the body and the look as they stand. A look is needed before anything is
  // drawn, since it names the style
  const update = () => {
    if (!look) return
    // More levels of the volume shown keep its textures, and a new volume takes its own. A posed body keeps its bound
    // rig while its volume, its bounds and its rig stay
    const lastBody = body
    const kept = lastBody && lastBody.volume === source?.volume ? lastBody.textures : null
    const posing = source?.rig && motion ? source : null
    const lastPosed = lastBody?.posed ?? null
    const posed: Posed | null =
      posing && posing.rig
        ? lastPosed && lastBody?.volume === posing.volume && lastBody.bounds === posing.bounds && lastPosed.file === posing.rig
          ? lastPosed
          : bindPosed(posing.volume, posing.bounds, posing.rig)
        : null
    if (!isSame(lastBody, source) || lastPosed !== posed) {
      body = source ? { ...source, textures: kept ?? createBodyTextures(source.volume), posed } : null
      turned = true
    }

    // A new style is made and given the body before the one it replaces is disposed of, so that a texture both read
    // is handed from one to the other rather than freed and built again
    const lastDrawn = drawn && drawn.style !== look.style ? drawn : null
    if (!drawn || lastDrawn) {
      drawn = { style: look.style, drawing: createStyle[look.style](context) }
      scene.add(drawn.drawing.object)
    }
    cue.set(look.depthCue, body ? body.bounds.half : null)
    drawn.drawing.update(body, look)
    if (lastDrawn) strike(lastDrawn)
    compositor.set(framePlan(look))

    // The last volume's textures go once the styles have let go of them
    if (lastBody && !kept) lastBody.textures.dispose()
  }

  return {
    setBody(next) {
      if (isSame(source, next)) return
      source = next
      stale = true
    },
    setLook(next) {
      if (next === look) return
      look = next
      stale = true
    },
    setMotion(next) {
      if (next === motion) return
      // Posing a body or letting it go remakes it; a new pose for it only turns its bones
      if ((next === null) !== (motion === null)) stale = true
      motion = next
      turned = true
    },
    render() {
      if (stale) {
        // Cleared first, so that an update that fails isn't tried again on every frame
        stale = false
        update()
      }
      // The bones turn, and the joints drawn over them follow, only when the pose or the body has changed
      if (turned) {
        turned = false
        const posed = body?.posed ?? null
        if (posed && motion) posePosed(posed, motion.rotations)
        overlay.update(posed, motion?.joints ?? false)
      }
      drawn?.drawing.beforeFrame?.(camera)
      compositor.render()
    },
    dispose() {
      if (drawn) strike(drawn)
      drawn = null
      scene.remove(overlay.object)
      overlay.dispose()
      compositor.dispose()
      body?.textures.dispose()
      body = null
      scene.fogNode = null
    },
  }
}
