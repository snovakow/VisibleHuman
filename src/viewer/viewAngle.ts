import type { Triple } from '../volume/format.ts'

// The angle a body is framed from, in degrees: around it from its front toward its left, which is the scene's +x, and
// up from level. Framing keeps the camera's up the scene's, so the elevation stays short of straight up or down
export interface ViewAngle {
  azimuth: number
  elevation: number
}

// Straight on from the front, level, as each body was framed before the presets
export const frontView: ViewAngle = { azimuth: 0, elevation: 0 }

const dot = (a: Triple, b: Triple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// The camera's axes when it looks at the origin from a view angle: its right, its up, and the way toward it from the
// origin, each of unit length
function axesOf({ azimuth, elevation }: ViewAngle) {
  const around = (azimuth * Math.PI) / 180
  const up = (elevation * Math.PI) / 180
  const toward: Triple = [Math.sin(around) * Math.cos(up), Math.sin(up), Math.cos(around) * Math.cos(up)]
  const right: Triple = [Math.cos(around), 0, -Math.sin(around)]
  const above: Triple = [-Math.sin(around) * Math.sin(up), Math.cos(up), -Math.cos(around) * Math.sin(up)]
  return { right, above, toward }
}

// Where the camera frames a box centred on the origin, of the half extents given, from a view angle: the way toward it
// from the origin, and how far along that way the whole box fits a view of the given half-angle tangent and aspect,
// with the margin's room around it. Each corner of the box is held inside the view at its own depth, the box being
// convex, so that from the front, level, the near face fits exactly as the framing has always fitted it
export function frameFrom(half: Triple, view: ViewAngle, tanHalfFov: number, aspect: number, margin: number) {
  const { right, above, toward } = axesOf(view)
  let distance = 0
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner: Triple = [sx * half[0], sy * half[1], sz * half[2]]
        const depth = dot(corner, toward)
        const tall = (Math.abs(dot(corner, above)) * margin) / tanHalfFov
        const wide = (Math.abs(dot(corner, right)) * margin) / (tanHalfFov * aspect)
        distance = Math.max(distance, depth + tall, depth + wide)
      }
    }
  }
  return { toward, distance }
}

// The sway: the view swung slowly to and fro about the vertical through the orbit target, which shows the body is
// solid without ever turning it away. It swings as far each way as keeps a cut opened from the front, as the cutaway
// opens it, facing the camera: from the front view the presets open on, well round toward either side, where a whole
// turn would show the uncut back for half of every revolution
export const swayDegrees = 50
// One swing there and back, slow enough to read the body as it goes
export const swaySeconds = 24
// The swing is eased in over this long, so that the view starts from rest wherever it stood
const easeSeconds = 3

// The sway's angle about the vertical, in radians, a time in seconds after it started: positive turns the camera toward
// the body's left, as a view angle's azimuth does
export function swayAngle(elapsed: number): number {
  const ramp = Math.min(Math.max(elapsed / easeSeconds, 0), 1)
  const ease = ramp * ramp * (3 - 2 * ramp)
  return ((swayDegrees * Math.PI) / 180) * Math.sin((2 * Math.PI * elapsed) / swaySeconds) * ease
}
