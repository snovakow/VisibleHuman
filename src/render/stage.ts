import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { isWebGPU } from './backend.ts'
import type { Body, BodySource } from './body/body.ts'
import { createBodyTextures } from './body/textures.ts'
import { createDepthCue } from './depthCue.ts'
import { createCompositor } from './frame/compositor.ts'
import { framePlan } from './frame/plan.ts'
import type { Look, Style } from './look.ts'
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
// holds anything on the GPU, and the body's textures go with the last style that reads them

export interface Stage {
  // The body to draw from the next frame on, or none between two bodies
  setBody(source: BodySource | null): void
  // The look to draw it with from the next frame on
  setLook(look: Look): void
  // Brings the scene up to date with the body and the look, and draws a frame
  render(): void
  // Frees everything the stage made and leaves the scene as it found it
  dispose(): void
}

// Whether two bodies, or two of what a body is made from, are of the same volume, bounds and levels
function isSame(a: BodySource | null, b: BodySource | null) {
  return a?.volume === b?.volume && a?.bounds === b?.bounds && a?.levels === b?.levels
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
  let stale = false
  // What the scene holds: the body, with its textures, and the style drawing it
  let body: Body | null = null
  let drawn: { style: Style; drawing: StyleDrawing } | null = null

  const strike = (last: { drawing: StyleDrawing }) => {
    scene.remove(last.drawing.object)
    last.drawing.dispose()
  }

  // Brings the scene up to date with the body and the look as they stand. A look is needed before anything is
  // drawn, since it names the style
  const update = () => {
    if (!look) return
    // More levels of the volume shown keep its textures, and a new volume takes its own
    const lastBody = body
    const kept = lastBody && lastBody.volume === source?.volume ? lastBody.textures : null
    if (!isSame(lastBody, source)) body = source ? { ...source, textures: kept ?? createBodyTextures(source.volume) } : null

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
    render() {
      if (stale) {
        // Cleared first, so that an update that fails isn't tried again on every frame
        stale = false
        update()
      }
      drawn?.drawing.beforeFrame?.(camera)
      compositor.render()
    },
    dispose() {
      if (drawn) strike(drawn)
      drawn = null
      compositor.dispose()
      body?.textures.dispose()
      body = null
      scene.fogNode = null
    },
  }
}
