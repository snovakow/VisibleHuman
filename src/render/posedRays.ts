import { Matrix3, Matrix4, Vector3 } from 'three'
import { ownerJoint, type SceneBox } from '../rig/owners.ts'
import { jointNames } from '../rig/rig.ts'
import type { Triple } from '../volume/format.ts'
import type { CutBox } from './cuts.ts'
import { slab } from './rays.ts'

// The posed read on the CPU: how the per-pixel styles read a posed body, point by point along each pixel's ray, in
// the posed scene. A point of the scan moves with the joint that owns its cell, rigidly, so a posed point came from
// where one of the joints' matrices takes it back; that joint's candidate is the point it gives back, kept where it
// lies in the joint's box and its cell is the joint's own. Each joint's frame is set once a frame, for the bones as
// they stand and the cuts as they are; then, once a pixel, the ray is taken back into every joint's frame and tested
// against its box, which leaves a mask of the joints it can meet and where the first enters and the last leaves; and
// then each read along the ray tries the masked joints alone. src/render/body/posedRead.ts holds the same in TSL, so
// that what the tests prove here is what the shaders do

export const jointCount = jointNames.length

// A box that changes from frame to frame, as its lowest and highest corners along x, y and z
export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

// The joints' frames for a pose: each joint's skinning matrix's inverse, which takes a point of the posed scene back
// to where the scan holds it as the joint alone would move it; each joint's box, in the scan, where the joint owns
// cells at all; and the posed bounds, the body's bounds grown to hold every joint's box as the pose moves it, which no
// posed point of the body lies outside
export interface JointFrames {
  inverses: Matrix4[]
  boxes: Box[]
  // Bit n set where joint n owns cells
  present: number
  bounds: Box
}

export function createJointFrames(): JointFrames {
  const box = (): Box => ({ min: [0, 0, 0], max: [0, 0, 0] })
  return { inverses: jointNames.map(() => new Matrix4()), boxes: jointNames.map(box), present: 0, bounds: box() }
}

const corner = new Vector3()

// Sets the frames for a pose, from each joint's skinning matrix, which takes a point of the scan to where the pose
// moves it, each joint's box of the cells it owns and the body's bounds as their half extents about the scene's
// origin. It makes nothing, since it runs every frame a motion moves
export function settleFrames(frames: JointFrames, skinning: readonly Matrix4[], boxes: readonly (SceneBox | null)[], half: Triple) {
  const { bounds } = frames
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = -half[axis]
    bounds.max[axis] = half[axis]
  }
  frames.present = 0
  for (let joint = 0; joint < jointCount; joint++) {
    frames.inverses[joint].copy(skinning[joint]).invert()
    const box = boxes[joint]
    if (!box) continue
    // The box's corners as the pose moves them grow the bounds
    for (let n = 0; n < 8; n++) {
      corner.set(n & 1 ? box.max[0] : box.min[0], n & 2 ? box.max[1] : box.min[1], n & 4 ? box.max[2] : box.min[2]).applyMatrix4(skinning[joint])
      for (let axis = 0; axis < 3; axis++) {
        const value = corner.getComponent(axis)
        if (value < bounds.min[axis]) bounds.min[axis] = value
        if (value > bounds.max[axis]) bounds.max[axis] = value
      }
    }
    const kept = frames.boxes[joint]
    for (let axis = 0; axis < 3; axis++) {
      kept.min[axis] = box.min[axis]
      kept.max[axis] = box.max[axis]
    }
    frames.present |= 1 << joint
  }
}

// A joint's box as a ray tests it: where it's cut, the part of it the cuts leave, since a cut acts where the scan holds
// each point; false where nothing is left. A shadow is thrown by all of the body, cut or not, so its ray takes the
// whole box
const tested: Box = { min: [0, 0, 0], max: [0, 0, 0] }
function testedBox(frames: JointFrames, joint: number, cut: CutBox | undefined): boolean {
  const { min, max } = frames.boxes[joint]
  for (let axis = 0; axis < 3; axis++) {
    tested.min[axis] = cut ? Math.max(min[axis], cut.min[axis]) : min[axis]
    tested.max[axis] = cut ? Math.min(max[axis], cut.max[axis]) : max[axis]
    if (tested.min[axis] > tested.max[axis]) return false
  }
  return true
}

// The joints a ray may meet between two distances along it: bit n set for joint n where the ray, taken back into the
// joint's frame, crosses its box there, as the cuts leave it where they're given; and where the first of those
// crossings begins and the last ends, from and to, which are infinite and minus infinite where it meets none
export interface JointMask {
  mask: number
  from: number
  to: number
}

const jointOrigin = new Vector3()
const jointDirection = new Vector3()
const jointTurn = new Matrix3()

export function jointMask(frames: JointFrames, origin: Vector3, direction: Vector3, tEnter: number, tExit: number, cut?: CutBox): JointMask {
  let mask = 0
  let from = Infinity
  let to = -Infinity
  for (let joint = 0; joint < jointCount; joint++) {
    if (!((frames.present >> joint) & 1) || !testedBox(frames, joint, cut)) continue
    const inverse = frames.inverses[joint]
    jointOrigin.copy(origin).applyMatrix4(inverse)
    // A direction turns with the matrix but doesn't move with it, and the matrix is rigid, so distances along the ray
    // are the same in every frame
    jointDirection.copy(direction).applyMatrix3(jointTurn.setFromMatrix4(inverse))
    const crossing = slab(jointOrigin, jointDirection, tested.min, tested.max)
    const enter = Math.max(crossing.tEnter, tEnter)
    const exit = Math.min(crossing.tExit, tExit)
    if (exit < enter) continue
    mask |= 1 << joint
    from = Math.min(from, enter)
    to = Math.max(to, exit)
  }
  return { mask, from, to }
}

// The rig file's cells as the read fetches them: the mapping from the scene to the cells, whose floor is the nearest
// cell (sceneToCell in rays.ts), the grid's size and each cell's owner byte (src/rig/owners.ts)
export interface OwnerCells {
  toCell: Matrix4
  size: Triple
  owners: Uint8Array
}

// What a read at a posed point finds: the joint whose candidate it keeps, the point of the scan it reads there, and
// how many joints' candidates passed, more than one where the pose has brought two parts of the body to one place
export interface Claim {
  joint: number
  rest: Vector3
  claims: number
}

const candidate = new Vector3()
const cellPlace = new Vector3()

// The point of the scan a posed point at a distance along a ray is read at, or none where no joint the ray can meet
// owns the cell its candidate falls in, within the cuts where they're given. Where two joints' candidates both pass,
// the one where the body's coverage is the greater wins, the lower joint on a tie, so the choice is a function of the
// point and cannot flicker
export function claimAt(
  frames: JointFrames,
  cells: OwnerCells,
  ray: JointMask,
  t: number,
  point: Vector3,
  coverageAt: (rest: Vector3) => number,
  cut?: CutBox,
): Claim | null {
  if (t < ray.from || t > ray.to) return null
  let found: Claim | null = null
  let best = -1
  const [nx, ny, nz] = cells.size
  for (let joint = 0; joint < jointCount; joint++) {
    if (!((ray.mask >> joint) & 1)) continue
    if (!testedBox(frames, joint, cut)) continue
    candidate.copy(point).applyMatrix4(frames.inverses[joint])
    const { min, max } = tested
    if (candidate.x < min[0] || candidate.y < min[1] || candidate.z < min[2] || candidate.x > max[0] || candidate.y > max[1] || candidate.z > max[2]) continue
    cellPlace.copy(candidate).applyMatrix4(cells.toCell)
    const i = Math.min(Math.max(Math.floor(cellPlace.x), 0), nx - 1)
    const j = Math.min(Math.max(Math.floor(cellPlace.y), 0), ny - 1)
    const k = Math.min(Math.max(Math.floor(cellPlace.z), 0), nz - 1)
    if (ownerJoint(cells.owners[i + nx * (j + ny * k)]) !== joint) continue
    if (!found) {
      found = { joint, rest: candidate.clone(), claims: 1 }
      continue
    }
    found.claims++
    if (best < 0) best = coverageAt(found.rest)
    const coverage = coverageAt(candidate)
    if (coverage > best) {
      best = coverage
      found.joint = joint
      found.rest.copy(candidate)
    }
  }
  return found
}
