import type { Triple } from '../volume/format.ts'

// The three cuts as the box they leave of the body's bounds and as planes, in the scene's millimetres, centred on the
// bounds as the splats' centres are. Each cut's plane runs across the bounds from the side it starts on at 0 to the
// opposite side at 1: Axial cuts down from the head, keeping y at or below its plane; Coronal back from the front,
// keeping z at or below its plane; Sagittal across from the body's right, keeping x at or above its plane. The splats'
// cell table cuts its cells by the same rule, which this module must agree with

export interface Cuts {
  axial: number
  coronal: number
  sagittal: number
}

// The box the cuts leave, as its lowest and highest corners along x, y and z
interface CutBox {
  min: Triple
  max: Triple
}

// A plane as the node renderer takes one: a point p is kept where dot(normal, p) + constant is at least 0
export interface CutPlane {
  normal: Triple
  constant: number
}

// A plane whose cut is at 0 is parked this many half extents past the face it would start on, so that it cuts nothing
// while the planes stay three, since a changed count of planes recompiles the material that clips by them
const parkedHalfExtents = 2

// Where each cut's plane lies: the height Axial keeps below, the depth Coronal keeps behind, and the x Sagittal keeps
// to the left of. The bounds' half extents along x, y and z give the sides the cuts run between
export function cutLimits(half: Triple, cuts: Cuts) {
  return {
    top: half[1] - cuts.axial * 2 * half[1],
    front: half[2] - cuts.coronal * 2 * half[2],
    right: cuts.sagittal * 2 * half[0] - half[0],
  }
}

export function cutBox(half: Triple, cuts: Cuts): CutBox {
  const { top, front, right } = cutLimits(half, cuts)
  return { min: [right, -half[1], -half[2]], max: [half[0], top, front] }
}

// The three planes, Axial, Coronal and Sagittal, each keeping the half-space its cut leaves, and parked past the
// bounds while its cut is 0
export function cutPlanes(half: Triple, cuts: Cuts): [CutPlane, CutPlane, CutPlane] {
  const { top, front, right } = cutLimits(half, cuts)
  const parked = (cut: number, extent: number) => (cut === 0 ? parkedHalfExtents * extent : 0)
  return [
    { normal: [0, -1, 0], constant: top + parked(cuts.axial, half[1]) },
    { normal: [0, 0, -1], constant: front + parked(cuts.coronal, half[2]) },
    { normal: [1, 0, 0], constant: -(right - parked(cuts.sagittal, half[0])) },
  ]
}
