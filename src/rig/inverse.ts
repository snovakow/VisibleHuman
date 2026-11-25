import { Matrix3, Matrix4, Vector3 } from 'three'
import { sourceOfScene, type Placement } from './pose.ts'
import type { RigFile } from './rigFile.ts'
import { skinningAtSource, type Skinning } from './sampling.ts'

// The warp from a posed point back to the scan, on the CPU: the reference for the ray styles' shaders once they draw a
// posed body, since a ray marches through it and must read the scan's textures where each of its points came from. A
// point of the scan moves with the joints of the cells about it, each joint's skinning matrix blended by their shares,
// as the surface's skin is skinned. So a posed point came from about where one of the joints' matrices brings it back;
// where the place's flesh is shared with another joint, that's only near, and a few steps of Newton's method, each
// undoing the residual by the warp's own slope there, close the gap. Pure, so the tests run it

// The skinning at a scene point of a level
export function skinningAt(file: RigFile, placement: Placement, point: Vector3): Skinning | null {
  return skinningAtSource(file, sourceOfScene(placement, point))
}

export type { Skinning }

// A point of the scan where a pose moves it, its joints' matrices blended by their shares
export function skinPoint(matrices: readonly Matrix4[], skinning: Skinning, rest: Vector3): Vector3 {
  const moved = new Vector3()
  skinning.joints.forEach((joint, n) => moved.add(rest.clone().applyMatrix4(matrices[joint]).multiplyScalar(skinning.weights[n])))
  return moved
}

// The forward warp's Jacobian at a place: how the posed point moves as the place does, by a step along each axis. It
// takes in how the shares change from place to place as well as each joint's own turn: in flesh shared between two
// joints turned well apart, the blend of their matrices alone sends Newton's steps back and forth around the point
const jacobianStep = 0.5
function jacobian(file: RigFile, placement: Placement, matrices: readonly Matrix4[], rest: Vector3, at: Vector3): Matrix3 | null {
  const columns: Vector3[] = []
  for (let axis = 0; axis < 3; axis++) {
    const nudged = rest.clone()
    nudged.setComponent(axis, nudged.getComponent(axis) + jacobianStep)
    const skinning = skinningAt(file, placement, nudged)
    if (!skinning) return null
    columns.push(skinPoint(matrices, skinning, nudged).sub(at).divideScalar(jacobianStep))
  }
  const [a, b, c] = columns
  return new Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z)
}

// How close a warped point must come back to the posed one, in millimetres, and how many of Newton's steps it may take
export const warpTolerance = 0.5
const newtonSteps = 12

// Every point of the scan a posed point came from: more than one where the pose has pressed two parts of the body into
// the same place, none where it lies in no posed flesh. Each joint's matrix brought back gives a first guess, which in
// flesh shared between two joints may land a few cells off, in a cell the joint doesn't hold; Newton's steps from
// there, each with the cell it reaches, settle on a point of the scan if there is one, and the point is kept only if
// its own cell's skinning brings it to the posed point
export function unskinPoint(file: RigFile, placement: Placement, matrices: readonly Matrix4[], posed: Vector3, tolerance = warpTolerance): Vector3[] {
  const found: Vector3[] = []
  const inverse = new Matrix4()
  const residual = new Vector3()
  for (let joint = 0; joint < matrices.length; joint++) {
    const rest = posed.clone().applyMatrix4(inverse.copy(matrices[joint]).invert())
    let cell = skinningAt(file, placement, rest)
    for (let step = 0; cell && step < newtonSteps; step++) {
      const at = skinPoint(matrices, cell, rest)
      residual.copy(posed).sub(at)
      const miss = residual.length()
      if (miss < 1e-3) break
      const slope = jacobian(file, placement, matrices, rest, at)
      if (!slope || Math.abs(slope.determinant()) < 1e-9) break
      // A full step can overshoot where the shares change fast; it's halved until it brings the point nearer
      const full = residual.clone().applyMatrix3(slope.invert())
      let taken = false
      for (let halving = 0; halving < 6 && !taken; halving++) {
        const tried = rest.clone().add(full.clone().multiplyScalar(0.5 ** halving))
        const there = skinningAt(file, placement, tried)
        if (there && skinPoint(matrices, there, tried).distanceTo(posed) < miss) {
          rest.copy(tried)
          cell = there
          taken = true
        }
      }
      if (!taken) break
    }
    if (!cell || skinPoint(matrices, cell, rest).distanceTo(posed) > tolerance) continue
    if (!found.some((point) => point.distanceTo(rest) < 1)) found.push(rest)
  }
  return found
}
