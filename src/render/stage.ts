import type { AnimationClip } from 'three'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { createAnimator, type Animator, type Layer } from '../motion/animator.ts'
import { isWebGPU } from './backend.ts'
import type { Body, BodySource } from './body/body.ts'
import { createBodyTextures } from './body/textures.ts'
import { createDepthCue } from './depthCue.ts'
import { createCompositor } from './frame/compositor.ts'
import { framePlan } from './frame/plan.ts'
import type { Look, Style } from './look.ts'
import { createJointsOverlay } from './overlay.ts'
import { bindPosed, settlePosed, type Posed } from './posed.ts'
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
// A body with a rig is drawn posed while a motion is set: its rig is bound to the body as drawn, the styles that can
// are handed it, and an animator plays the motion on its bones. Ahead of each frame in which the motion moves, and
// only then, the animator advances, the bones' matrices and the skeleton's follow, the count the styles watch goes up,
// the joints drawn over the body follow, and then the style readies its frame, in that order, so no style reads
// matrices a frame old. With no motion, nothing of the rig is made, and every style draws the body as scanned, as it
// always has

// The motion to draw a rigged body in: the clip it plays, a pose's or one over time, the layers mixed over it, how
// fast its clips run and whether they do, how many single steps have been asked for since the page opened, each new
// one stepping the clips once, and whether its joints are drawn
export interface Motion {
  clip: AnimationClip
  layers: readonly Layer[]
  speed: number
  playing: boolean
  steps: number
  joints: boolean
}

// The most a frame moves a motion on, in seconds, so that the first frame after a hidden tab doesn't jump it
const longestStep = 0.1

export interface Stage {
  // The body to draw from the next frame on, or none between two bodies
  setBody(source: BodySource | null): void
  // The look to draw it with from the next frame on
  setLook(look: Look): void
  // The motion to draw it in from the next frame on, or none, to draw it as scanned. A new motion for the same body
  // fades into it from what the body shows and rebuilds nothing
  setMotion(motion: Motion | null): void
  // Brings the scene up to date with the body, the look and the motion, the motion moved on by the seconds since the
  // last frame, and draws a frame
  render(seconds: number): void
  // Frees everything the stage made and leaves the scene as it found it
  dispose(): void
}

// Whether two bodies, or two of what a body is made from, are of the same volume, bounds, levels, rig and posed levels
function isSame(a: BodySource | null, b: BodySource | null) {
  return (
    a?.volume === b?.volume &&
    a?.bounds === b?.bounds &&
    a?.levels === b?.levels &&
    a?.rig === b?.rig &&
    a?.posedLevels === b?.posedLevels
  )
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
  // The animator playing on the posed body's bones, made with its binding and let go with it, and the motion it was
  // last handed, with the steps it has taken
  let animated: { posed: Posed; animator: Animator; motion: Motion | null; steps: number } | null = null

  // Hands the animator what changed in the motion since it was last handed one: a new clip fades in, or, for a newly
  // bound body, shows at once; the steps asked for since are taken
  const animate = (posed: Posed, next: Motion) => {
    if (animated?.posed !== posed) {
      animated?.animator.dispose()
      animated = { posed, animator: createAnimator(posed.skeleton.root), motion: null, steps: next.steps }
    }
    const last = animated.motion
    if (last === next) return animated.animator
    const { animator } = animated
    if (last?.clip !== next.clip) animator.play(next.clip, !last)
    if (last?.layers !== next.layers) animator.setLayers(next.layers)
    animator.setSpeed(next.speed)
    animator.setPlaying(next.playing)
    for (; animated.steps < next.steps; animated.steps++) animator.step()
    if (last?.joints !== next.joints) turned = true
    animated.motion = next
    return animator
  }

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
      // Posing a body or letting it go remakes it; a new motion for it only plays on its bones
      if ((next === null) !== (motion === null)) stale = true
      motion = next
    },
    render(seconds) {
      if (stale) {
        // Cleared first, so that an update that fails isn't tried again on every frame
        stale = false
        update()
      }
      const posed = body?.posed ?? null
      if (posed && motion) {
        // The bones turn, and the joints drawn over them follow, only while the motion moves or when the body has
        // changed, so a pose held draws as it did and costs nothing
        const animator = animate(posed, motion)
        if (turned || animator.moving) {
          turned = false
          animator.update(Math.min(seconds, longestStep))
          settlePosed(posed)
          overlay.update(posed, motion.joints)
        }
      } else {
        if (animated) {
          animated.animator.dispose()
          animated = null
        }
        if (turned) {
          turned = false
          overlay.update(null, false)
        }
      }
      drawn?.drawing.beforeFrame?.(camera)
      compositor.render()
    },
    dispose() {
      animated?.animator.dispose()
      animated = null
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
