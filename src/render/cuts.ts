import type { Triple } from '../volume/format.ts'

// The three cuts as the box they leave of the body's bounds and as planes, in the scene's millimetres, centred on the
// bounds as the splats' centres are. Each cut's plane runs across the bounds from the side it starts on at 0 to the
// opposite side at 1: Axial cuts down from the head, keeping y at or below its plane; Coronal back from the front,
// keeping z at or below its plane; Sagittal across from the body's right, keeping x at or above its plane. Every style
// cuts by these: the ray quad's styles by the box, the surface by the planes and its caps by the limits, and the
// splats' cell table by the limits too

export interface Cuts {
  axial: number
  coronal: number
  sagittal: number
}

// Whether any of the three cuts is open
export const isCut = (cuts: Cuts) => cuts.axial > 0 || cuts.coronal > 0 || cuts.sagittal > 0

// The box the cuts leave, as its lowest and highest corners along x, y and z
export interface CutBox {
  min: Triple
  max: Triple
}

// A plane as the node renderer takes one: a point p is kept where dot(normal, p) + constant is at least 0
export interface CutPlane {
  normal: Triple
  constant: number
}

// A plane whose cut is at 0 is parked this many of the bounds' largest half extents past the face it would start on, so
// that it cuts nothing while the planes stay three, since a changed count of planes recompiles the material that clips
// by them. Four is two of the body's lengths: a posed body's points stay within one length of its hips, which keep
// their place in the scan, so no pose carries a hand or a foot past it, as two of each axis's own half extents let
// arms held forward, a knee raised or a seated body's feet do
const parkedHalfExtents = 4

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
  const far = parkedHalfExtents * Math.max(...half)
  const parked = (cut: number) => (cut === 0 ? far : 0)
  return [
    { normal: [0, -1, 0], constant: top + parked(cuts.axial) },
    { normal: [0, 0, -1], constant: front + parked(cuts.coronal) },
    { normal: [1, 0, 0], constant: -(right - parked(cuts.sagittal)) },
  ]
}

// How far inside each of the three planes a point lies, Axial, Coronal and Sagittal: dot(normal, point) + constant,
// which keeps the point where it's at least 0. The posed surface's materials measure this at a vertex's rest
// position, where the scan holds it, so that a cut stays the same section of the anatomy whatever the pose
export function cutDistances(planes: readonly [CutPlane, CutPlane, CutPlane], point: Triple): [number, number, number] {
  const inside = ({ normal, constant }: CutPlane) => normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + constant
  return [inside(planes[0]), inside(planes[1]), inside(planes[2])]
}
