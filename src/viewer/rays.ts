import { Matrix4, Vector3, Vector4 } from 'three'
import type { SceneAxes, Triple, Volume } from '../volume/format.ts'

// The camera rays the quad styles march, and the mapping from the scene to the body's 3D texture, on the CPU: the
// TSL in rayQuad.ts mirrors the ray and the slab test, and the march reads the mapping as the matrix built here, so
// that what the tests prove here is what the shaders do

// A direction's components are kept at least this far from zero, so that a face parallel to the ray is never a
// division by zero
export const leastDirection = 1e-6

interface Ray {
  origin: Vector3
  direction: Vector3
  // The ray's direction in view space, whose z is negative in front of the camera, so that a distance t along the ray
  // has the view depth −t × viewDir.z
  viewDir: Vector3
}

// The ray from a perspective camera through a point of its view, given in clip space from −1 to 1 across and up,
// from the inverse of its projection matrix and its world matrix
export function cameraRay(ndc: readonly [number, number], projectionInverse: Matrix4, world: Matrix4): Ray {
  const far = new Vector4(ndc[0], ndc[1], 1, 1).applyMatrix4(projectionInverse)
  const viewDir = new Vector3(far.x, far.y, far.z).divideScalar(far.w).normalize()
  const direction = new Vector4(viewDir.x, viewDir.y, viewDir.z, 0).applyMatrix4(world)
  return {
    origin: new Vector3().setFromMatrixPosition(world),
    direction: new Vector3(direction.x, direction.y, direction.z).normalize(),
    viewDir,
  }
}

// The distances along a ray at which it enters and leaves a box, by the slab test: along each axis the nearer and
// the farther of its two faces' crossings, the entry the latest of the nearer and the exit the earliest of the
// farther. The ray misses where the exit comes before the entry; a ray starting inside enters at a negative distance
export function slab(origin: Vector3, direction: Vector3, min: Triple, max: Triple) {
  let tEnter = -Infinity
  let tExit = Infinity
  const o = [origin.x, origin.y, origin.z]
  const d = [direction.x, direction.y, direction.z]
  for (let axis = 0; axis < 3; axis++) {
    const nudged = (d[axis] < 0 ? -1 : 1) * Math.max(Math.abs(d[axis]), leastDirection)
    const toLow = (min[axis] - o[axis]) / nudged
    const toHigh = (max[axis] - o[axis]) / nudged
    tEnter = Math.max(tEnter, Math.min(toLow, toHigh))
    tExit = Math.min(tExit, Math.max(toLow, toHigh))
  }
  return { tEnter, tExit }
}

// What the mapping reads of a volume: its grid and the axes it's drawn along
export type Mapped = Pick<Volume, 'size' | 'spacing' | 'axes'>

// The scene's axes in the order x, y, z, each with the grid axis it follows and its sign, for the two mappings below
function sceneAxes({ x, y, z }: SceneAxes) {
  return [x, y, z]
}

// The affine mapping from a point in the scene, in millimetres and centred on the body's bounds as the splats are, to
// the texture's coordinates, which run from 0 to 1 along i, j and k with the voxels' centres half a voxel in from the
// edges. A scene coordinate along an axis is that axis's grid coordinate times its sign and spacing, less the bounds'
// centre, so the grid coordinate is the sign times the centred coordinate plus the centre over the spacing
export function sceneToTexture(volume: Mapped, center: Triple): Matrix4 {
  const { size, spacing } = volume
  const matrix = new Matrix4().makeScale(0, 0, 0)
  const elements = matrix.elements
  sceneAxes(volume.axes).forEach((axis, scene) => {
    const grid = axis.source
    const perMm = axis.sign / (spacing[grid] * size[grid])
    // Column-major: the element in row `grid`, column `scene`, and the translation in column 3
    elements[scene * 4 + grid] = perMm
    elements[12 + grid] = perMm * center[scene] + 0.5 / size[grid]
  })
  return matrix
}

// The texture's coordinates of a point in the scene
export function textureCoordinate(volume: Mapped, center: Triple, point: Vector3): Vector3 {
  return point.clone().applyMatrix4(sceneToTexture(volume, center))
}

// The box the whole grid fills in the scene, centred on the body's bounds: from the outer face of the first voxel
// along each grid axis to the outer face of the last
export function textureBox(volume: Mapped, center: Triple): { min: Triple; max: Triple } {
  const { size, spacing } = volume
  const min: number[] = []
  const max: number[] = []
  sceneAxes(volume.axes).forEach((axis, scene) => {
    const grid = axis.source
    const a = axis.sign * -0.5 * spacing[grid] - center[scene]
    const b = axis.sign * (size[grid] - 0.5) * spacing[grid] - center[scene]
    min[scene] = Math.min(a, b)
    max[scene] = Math.max(a, b)
  })
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
}

// How many times the tracer halves the span between the last sample outside a surface and the first inside it, which
// finds the crossing within the step over 2⁶
export const bisectionSteps = 5

// The distance along a ray at which a field crosses zero, between a distance before the crossing and one after it, by
// halving the span: each halving keeps the half whose ends lie on opposite sides, judged by whether the field is at
// or above zero as it was at the near end. The crossing is the last span's midpoint. The TSL tracer does the same
// with the field read from the texture
export function bisect(field: (t: number) => number, before: number, after: number, steps = bisectionSteps): number {
  let low = before
  let high = after
  const insideAtLow = field(low) >= 0
  for (let n = 0; n < steps; n++) {
    const mid = (low + high) / 2
    if ((field(mid) >= 0) === insideAtLow) low = mid
    else high = mid
  }
  return (low + high) / 2
}
