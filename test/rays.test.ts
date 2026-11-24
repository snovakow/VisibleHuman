import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  bisect,
  bisectionSteps,
  boneCover,
  boneCovering,
  cameraRay,
  layersLeft,
  leastLayer,
  sceneToTexture,
  slab,
  textureBox,
  textureCoordinate,
  type Mapped,
} from '../src/render/rays.ts'
import { axesFromBytes, type Triple } from '../src/volume/format.ts'
import { bodyBounds } from '../src/volume/levels.ts'

// The camera rays and the scene-to-texture mapping, on the CPU, which the quad's TSL mirrors

const close = (actual: number, expected: number, within = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < within, `${actual} is not ${expected}`)

const closeVector = (actual: Vector3, expected: Triple, within = 1e-6) => {
  close(actual.x, expected[0], within)
  close(actual.y, expected[1], within)
  close(actual.z, expected[2], within)
}

// A camera as the page's, looking down −z from 2,600 mm, with its matrices brought up to date
function cameraAt(position: Triple, lookAt: Triple = [0, 0, 0]) {
  const camera = new PerspectiveCamera(50, 1280 / 800, 1, 20000)
  camera.position.set(...position)
  camera.lookAt(new Vector3(...lookAt))
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

void test('the centre pixel\'s ray is the camera\'s forward, from its position', () => {
  const camera = cameraAt([0, 0, 2600])
  const ray = cameraRay([0, 0], camera.projectionMatrixInverse, camera.matrixWorld)
  closeVector(ray.origin, [0, 0, 2600])
  closeVector(ray.direction, [0, 0, -1])
  closeVector(ray.viewDir, [0, 0, -1])
  // From an oblique place, the forward is still towards the target
  const oblique = cameraAt([1000, 500, 2000])
  const forward = new Vector3(-1000, -500, -2000).normalize()
  closeVector(cameraRay([0, 0], oblique.projectionMatrixInverse, oblique.matrixWorld).direction, [forward.x, forward.y, forward.z])
  // The top-right corner's ray rises and goes right by the tangents of the half fields of view
  const corner = cameraRay([1, 1], camera.projectionMatrixInverse, camera.matrixWorld)
  const tanHalf = Math.tan((50 / 2) * (Math.PI / 180))
  close(corner.viewDir.y / -corner.viewDir.z, tanHalf)
  close(corner.viewDir.x / -corner.viewDir.z, tanHalf * (1280 / 800))
  assert.ok(corner.direction.x > 0 && corner.direction.y > 0 && corner.direction.z < 0)
})

void test('the slab test gives the entry and exit of a unit box, from outside and from inside, and a miss', () => {
  const min: Triple = [-1, -1, -1]
  const max: Triple = [1, 1, 1]
  // Straight at the box from 5 away: in at 4, out at 6
  const head = slab(new Vector3(0, 0, 5), new Vector3(0, 0, -1), min, max)
  close(head.tEnter, 4)
  close(head.tExit, 6)
  // Along the diagonal from a corner
  const direction = new Vector3(-1, -1, -1).normalize()
  const diagonal = slab(new Vector3(3, 3, 3), direction, min, max)
  close(diagonal.tEnter, Math.sqrt(3) * 2)
  close(diagonal.tExit, Math.sqrt(3) * 4)
  // From inside, the entry is behind the origin and the exit ahead
  const inside = slab(new Vector3(0.5, 0, 0), new Vector3(1, 0, 0), min, max)
  close(inside.tEnter, -1.5)
  close(inside.tExit, 0.5)
  // A ray that passes beside the box leaves before it enters
  const miss = slab(new Vector3(0, 3, 5), new Vector3(0, 0, -1), min, max)
  assert.ok(miss.tExit < miss.tEnter)
  // A direction with a zero component is nudged rather than divided by
  const flat = slab(new Vector3(0.5, 0.5, 5), new Vector3(0, 0, -1), min, max)
  close(flat.tEnter, 4)
  close(flat.tExit, 6)
})

// A volume like the male's, in the male's axes: x = i, y = −k, z = j, on a grid of 4 × 3 × 5 voxels
const grid: Mapped = { size: [4, 3, 5], spacing: [3.96, 3.96, 4], axes: axesFromBytes([0x00, 0x82, 0x01]) }

// The centre of the voxel at a grid place, in the scene, centred on a bounds centre
function sceneCentre([i, j, k]: Triple, center: Triple): Vector3 {
  return new Vector3(i * 3.96 - center[0], -k * 4 - center[1], j * 3.96 - center[2])
}

void test('the scene-to-texture mapping sends the body\'s left-top-front corner to the texel it belongs to', () => {
  // The body's bounds, as the levels centre on them: every voxel of the grid is body here
  const voxels = grid.size[0] * grid.size[1] * grid.size[2]
  const volume = {
    ...grid,
    origin: [0, 0, 0] satisfies Triple,
    firstSlice: 1001,
    lastSlice: 1020,
    body: 'male',
    red: new Uint8Array(voxels),
    green: new Uint8Array(voxels),
    blue: new Uint8Array(voxels),
    coverage: new Uint8Array(voxels).fill(255),
  }
  const { center } = bodyBounds(volume)
  // The body's left is +x, its top +y and its front +z: the voxel at the highest i, lowest k and highest j
  const corner: Triple = [3, 2, 0]
  const uvw = textureCoordinate(grid, center, sceneCentre(corner, center))
  // The texel's centre: half a texel in from the edge along each axis
  closeVector(uvw, [3.5 / 4, 2.5 / 3, 0.5 / 5])
  // Its opposite corner, the body's right, bottom and back
  closeVector(textureCoordinate(grid, center, sceneCentre([0, 0, 4], center)), [0.5 / 4, 0.5 / 3, 4.5 / 5])
  // Every voxel centre lands on its texel centre
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 5; k++) {
        closeVector(textureCoordinate(grid, center, sceneCentre([i, j, k], center)), [(i + 0.5) / 4, (j + 0.5) / 3, (k + 0.5) / 5])
      }
    }
  }
  // The matrix form is the same mapping
  const matrix: Matrix4 = sceneToTexture(grid, center)
  closeVector(sceneCentre(corner, center).applyMatrix4(matrix), [3.5 / 4, 2.5 / 3, 0.5 / 5])
})

void test('the texture box is the grid\'s outer faces in the scene, centred on the bounds', () => {
  // Centred on the grid's own centre, the box is symmetric
  const center: Triple = [1.5 * 3.96, -2 * 4, 1 * 3.96]
  const box = textureBox(grid, center)
  // Along x: four voxels of 3.96 mm; along y: five of 4 mm, running downwards; along z: three of 3.96 mm
  closeVector(new Vector3(...box.min), [-2 * 3.96, -2.5 * 4, -1.5 * 3.96])
  closeVector(new Vector3(...box.max), [2 * 3.96, 2.5 * 4, 1.5 * 3.96])
  // The texture coordinates of the box's corners are 0 and 1
  closeVector(textureCoordinate(grid, center, new Vector3(...box.min)), [0, 0, 1])
  closeVector(textureCoordinate(grid, center, new Vector3(...box.max)), [1, 1, 0])
})

void test('the bisection finds a field\'s crossing within a thirty-second of the step in five steps, rising or falling', () => {
  assert.equal(bisectionSteps, 5)
  // A field that rises through zero at 3.3 along a ray sampled every millimetre: the samples at 3 and 4 bracket it
  const crossingAt = 3.3
  const rising = bisect((t) => t - crossingAt, 3, 4)
  assert.ok(Math.abs(rising - crossingAt) <= 1 / 32, `${rising}`)
  // A field that falls through zero, as a ray leaving a surface sees, is found the same way
  const falling = bisect((t) => crossingAt - t, 3, 4)
  assert.ok(Math.abs(falling - crossingAt) <= 1 / 32, `${falling}`)
  // Five halvings leave a span of a thirty-second, whose midpoint is within a sixty-fourth of any crossing in the step
  for (let n = 1; n <= 100; n++) {
    const at = 3 + n / 100
    const found = bisect((t) => t - at, 3, 4)
    assert.ok(Math.abs(found - at) <= 1 / 64 + 1e-12, `${at} found at ${found}`)
  }
  // A coarser step is halved to the same share of itself
  const coarse = bisect((t) => t - 10.9, 8, 12)
  assert.ok(Math.abs(coarse - 10.9) <= 4 / 64)
  // More steps come nearer
  assert.ok(Math.abs(bisect((t) => t - crossingAt, 3, 4, 10) - crossingAt) <= 1 / 1024)
})

void test('a step through bone covers by its depth, so however the steps divide the bone they cover the same', () => {
  // Nothing at or under the threshold, and more the farther the density stands over it and the longer the step
  assert.equal(boneCovering(0, 1), 0)
  assert.equal(boneCovering(-0.1, 1), 0)
  assert.ok(boneCovering(0.02, 1) < boneCovering(0.04, 1))
  assert.ok(boneCovering(0.02, 0.5) < boneCovering(0.02, 1))
  // Laid one over the other, two half steps, or four quarters, cover what the one whole step does
  const whole = boneCovering(0.03, 1)
  const laid = (cover: number, times: number) => 1 - (1 - cover) ** times
  close(laid(boneCovering(0.03, 0.5), 2), whole)
  close(laid(boneCovering(0.03, 0.25), 4), whole)
  // Bone five levels over the threshold shows through a voxel's depth of it; bone a fifth of the scale over is solid
  // within half a voxel
  assert.equal(boneCover, 60)
  assert.ok(boneCovering(5 / 255, 1) > 0.5 && boneCovering(5 / 255, 1) < 0.8)
  assert.ok(boneCovering(0.2, 0.5) > 0.99)
})

void test('a hit counts by what is left of the layers: in full while a whole layer is left, then by the share left of the last', () => {
  assert.equal(layersLeft(2, 0), 1)
  assert.equal(layersLeft(2, 1), 1)
  close(layersLeft(2, 1.25), 0.75)
  close(layersLeft(2, 1.99), 0.01)
  assert.equal(layersLeft(2, 2), 0)
  assert.equal(layersLeft(2, 2.6), 0)
  // It falls steadily as layers are laid, with no step where a layer just falls short of standing in full
  for (let laid = 0; laid < 3; laid += 0.05) assert.ok(layersLeft(2, laid + 0.05) <= layersLeft(2, laid))
  // A last layer laid in shares never quite uses the count up, so the tracer ends the ray once this little is left
  assert.equal(leastLayer, 0.01)
})
