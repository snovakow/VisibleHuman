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
// solid without ever turning it away. It swings about the body's front, as far round toward either side, which keeps a
// cut opened from the front, as the cutaway opens it, facing the camera, where a whole turn would show the uncut back
// for half of every revolution. It sets off from rest wherever the view stands, the presets' opening view a little
// round toward the body's left or wherever the visitor left it, and eases into that same swing
export const swayDegrees = 50
// One swing there and back, slow enough to read the body as it goes
export const swaySeconds = 24
// The swing is eased in over this long from a view within its reach, and longer from one beyond it
const easeSeconds = 3

// The sway's azimuth, in radians, a time in seconds after it set off from the azimuth given, in radians too: about the
// vertical, round from the body's front toward its left, as a view angle's azimuth is. A view within the swing's reach
// joins the swing where it passes there on its way toward the front, and one at the front sets off toward the body's
// left. One beyond it comes round the short way to the swing's nearer end, easing in the longer the farther round it
// stood, so that it comes back no faster than a few times the swing's own pace
export function swayAngle(elapsed: number, start: number): number {
  const reach = (swayDegrees * Math.PI) / 180
  // The start, the short way round from the front
  const from = Math.atan2(Math.sin(start), Math.cos(start))
  const join = Math.min(Math.max(from, -reach), reach)
  const phase = join > 0 ? Math.PI - Math.asin(join / reach) : Math.asin(join / reach)
  const swing = reach * Math.sin((2 * Math.PI * elapsed) / swaySeconds + phase)
  const ramp = Math.min(Math.max(elapsed / (easeSeconds * (1 + Math.abs(from - join) / reach)), 0), 1)
  const ease = ramp * ramp * (3 - 2 * ramp)
  return from + (swing - from) * ease
}
