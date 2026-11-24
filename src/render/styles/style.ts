import type { Camera, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { SurfaceKind } from '../../surface/surfaceWorker.ts'
import type { Volume } from '../../volume/format.ts'
import type { Body } from '../body/body.ts'
import type { DepthCue } from '../depthCue.ts'
import type { Look } from '../look.ts'

// What every style is to the stage: one object to put in the scene, brought up to date with the body and the look
// whenever either changes, and disposed of when another style takes its place. A style owns everything it draws with,
// its meshes, materials and textures' bindings, and reads nothing but what it's handed here, so the stage can swap
// one for another without knowing what any of them is made of

// What a style tells the page as it draws
export interface StyleEvents {
  // A body's volume has first been drawn
  drawn(volume: Volume): void
  // A surface has been meshed, with this many triangles, or is no longer drawn
  meshed(kind: SurfaceKind, triangles: number | undefined): void
}

// What the stage hands a style as it's made
export interface StyleContext {
  renderer: WebGPURenderer
  camera: Camera
  // Whether WebGPU is drawing, rather than the WebGL 2 fallback
  webgpu: boolean
  cue: DepthCue
  events: StyleEvents
}

export interface StyleDrawing {
  // Everything the style draws, for the stage to add to the scene and take out again
  readonly object: Object3D
  // Brings what's drawn up to date with the body, or with none between two bodies, and with the look. It's called
  // whenever either changes, and costs little where what it's given is what it was given before: a uniform is set
  // again, and only what a change really touches is rebuilt
  update(body: Body | null, look: Look): void
  // Called ahead of each frame, by a style with something to move with the camera
  beforeFrame?(camera: Camera): void
  // Frees everything the style made
  dispose(): void
}

// Calls back the first time an object is drawn from now on, from three's call after it draws the object, which a
// hidden object never gets
export function whenFirstDrawn(object: Object3D, drawn: () => void) {
  let told = false
  object.onAfterRender = () => {
    if (told) return
    told = true
    drawn()
  }
}
