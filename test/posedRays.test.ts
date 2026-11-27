import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { cutBox } from '../src/render/cuts.ts'
import { claimAt, createJointFrames, jointMask, settleFrames, type JointFrames, type OwnerCells } from '../src/render/posedRays.ts'
import { sceneToCell, sceneToTexture, slab, textureCoordinate } from '../src/render/rays.ts'
import { jointCellBoxes, jointSceneBoxes, ownerBytes, ownerJoint, ownerOf } from '../src/rig/owners.ts'
import { bindSkeleton, scanPose, skinningMatrices, type Placement, type Pose } from '../src/rig/pose.ts'
import { jointNames, scenePoint, type JointName } from '../src/rig/rig.ts'
import { readRigFile } from '../src/rig/rigFile.ts'
import { axesFromBytes, readVolume, type Triple } from '../src/volume/format.ts'
import { bodyBounds } from '../src/volume/levels.ts'

// The posed read on the CPU (src/render/posedRays.ts), the twin of the per-pixel styles' read, on the male's committed
// 4 mm level and rig file: each read made through a camera ray, so that the joints' mask and their boxes are what
// decide it, as in the shader

const read = (path: string) => new Uint8Array(gunzipSync(readFileSync(new URL(path, import.meta.url))))
const volume = readVolume(read('../public/volume/male-4mm.bin'))
const file = readRigFile(read('../public/volume/male.rig.bin'))
const bounds = bodyBounds(volume)
const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
const bound = bindSkeleton(file.rig, placement)
const boxes = jointSceneBoxes(file, jointCellBoxes(file), placement, bounds.half)
const cells: OwnerCells = { toCell: sceneToCell(placement, file), size: file.size, owners: ownerBytes(file.cells) }
const uncut = cutBox(bounds.half, { axial: 0, coronal: 0, sagittal: 0 })

// The coverage at a scene point of the scan, read between the voxels as the shader's filtered read does, rounded as
// a texture's read is, so that the whole body, which the GPU reads as exactly 1, ties rather than wavering in its last
// digits as the eight weights sum
const toTexture = sceneToTexture(volume, bounds.center)
function coverageAt(rest: Vector3) {
  const uvw = rest.clone().applyMatrix4(toTexture)
  const [nx, ny, nz] = volume.size
  const g = [uvw.x * nx - 0.5, uvw.y * ny - 0.5, uvw.z * nz - 0.5]
  const base = g.map(Math.floor)
  let sum = 0
  for (let corner = 0; corner < 8; corner++) {
    const at = [0, 1, 2].map((axis) => Math.min(Math.max(base[axis] + ((corner >> axis) & 1), 0), volume.size[axis] - 1))
    const near = [0, 1, 2].reduce((product, axis) => product * ((corner >> axis) & 1 ? g[axis] - base[axis] : 1 - (g[axis] - base[axis])), 1)
    sum += near * volume.coverage[at[0] + nx * (at[1] + ny * at[2])]
  }
  return Math.round((sum / 255) * 1e9) / 1e9
}

function framesFor(pose: Pose): { frames: JointFrames; matrices: Matrix4[] } {
  const byName = skinningMatrices(bound, pose)
  const matrices = jointNames.map((name) => byName[name])
  const frames = createJointFrames()
  settleFrames(frames, matrices, boxes, bounds.half)
  return { frames, matrices }
}

// Three cameras the reads are made from in turn, outside any pose's reach: from the front, round to the body's left
// and above, and from behind and below
const cameras = [new Vector3(0, 200, 3000), new Vector3(1800, 900, 1800), new Vector3(-600, -1200, -2600)]

// Every hundredth cell of the body, its centre in the scene where the scan holds it, and its owner
function sampledCells() {
  const [nx, ny] = file.size
  const sampled: { cell: number; rest: Vector3; owner: number }[] = []
  for (let n = 0; n < file.cells.chain.length; n += 100) {
    if (volume.coverage[n] < 128) continue
    const i = n % nx
    const j = Math.floor(n / nx) % ny
    const k = Math.floor(n / (nx * ny))
    const rest = scenePoint(placement, placement.center, [file.origin[0] + i * file.spacing[0], file.origin[1] + j * file.spacing[1], file.origin[2] + k * file.spacing[2]])
    sampled.push({ cell: n, rest, owner: ownerOf(file.cells, n) })
  }
  return sampled
}

// A read of a posed point through the ray to it from a camera: the ray's entry and exit of the posed bounds, its mask,
// the distance to the point, and what the read finds there
function readThrough(frames: JointFrames, camera: Vector3, posed: Vector3) {
  const direction = posed.clone().sub(camera).normalize()
  const { tEnter, tExit } = slab(camera, direction, frames.bounds.min, frames.bounds.max)
  const mask = jointMask(frames, camera, direction, Math.max(tEnter, 0), tExit, uncut)
  const t = posed.distanceTo(camera)
  return { mask, t, claim: claimAt(frames, cells, mask, t, camera.clone().add(direction.multiplyScalar(t)), coverageAt, uncut) }
}

void test("at the scan's pose every sampled cell of the body is read as itself, by its owner alone", () => {
  const { frames } = framesFor(scanPose(bound))
  // At the scan's pose the posed bounds are the body's own
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(frames.bounds.min[axis] + bounds.half[axis]) < 1e-6 && Math.abs(frames.bounds.max[axis] - bounds.half[axis]) < 1e-6)
  }
  const sampled = sampledCells()
  assert.ok(sampled.length > 10000, `only ${sampled.length} cells`)
  sampled.forEach(({ rest, owner }, n) => {
    const { mask, claim } = readThrough(frames, cameras[n % cameras.length], rest)
    assert.ok((mask.mask >> owner) & 1, `the ray misses the ${jointNames[owner]}'s box`)
    assert.ok(claim, 'nothing read')
    assert.equal(claim.joint, owner)
    assert.equal(claim.claims, 1)
    assert.ok(claim.rest.distanceTo(rest) < 1e-3, `read ${claim.rest.distanceTo(rest)} mm away`)
  })
})

// The scan's pose with some joints turned further, as test/inverse.test.ts bends it: an elbow bent, an arm raised to
// the side, a hip and a knee bent, the lower back bent forward and the neck turned
function bentPose(): Pose {
  const pose = scanPose(bound)
  const turn = (joint: JointName, x: number, y: number, z: number) => pose.rotations[joint].multiply(new Quaternion().setFromEuler(new Euler(x, y, z)))
  turn('rightForearm', -0.5, 0, 0)
  turn('leftArm', 0, 0, 0.6)
  turn('rightThigh', -0.5, 0, 0)
  turn('leftShin', 0.6, 0, 0)
  turn('spine1', 0.15, 0, 0)
  turn('neck', 0, 0.4, 0)
  return pose
}

void test("on a bent pose every sampled cell of the body, moved by its owner, is read back as itself by its owner's candidate", (t) => {
  const { frames, matrices } = framesFor(bentPose())
  const sampled = sampledCells()
  let claimedTwice = 0
  let lostToAnother = 0
  let worst = 0
  const lostBy: Record<string, number> = {}
  sampled.forEach(({ rest, owner }, n) => {
    const posed = rest.clone().applyMatrix4(matrices[owner])
    const camera = cameras[n % cameras.length]
    const { mask, t: distance, claim } = readThrough(frames, camera, posed)
    // The owner's box is among those the ray meets, and the point lies where the ray is in one
    assert.ok((mask.mask >> owner) & 1, `the ray misses the ${jointNames[owner]}'s box`)
    assert.ok(distance >= mask.from && distance <= mask.to)
    // The owner's own candidate is the cell's centre, within its box and in a cell it owns: it never fails
    const candidate = posed.clone().applyMatrix4(frames.inverses[owner])
    const error = candidate.distanceTo(rest)
    worst = Math.max(worst, error)
    assert.ok(error < 0.01, `the ${jointNames[owner]}'s candidate lies ${error} mm from the cell`)
    const place = candidate.clone().applyMatrix4(cells.toCell)
    const [nx, ny] = file.size
    assert.equal(ownerJoint(cells.owners[Math.floor(place.x) + nx * (Math.floor(place.y) + ny * Math.floor(place.z))]), owner)
    assert.ok(claim)
    if (claim.claims > 1) claimedTwice++
    if (claim.joint === owner) {
      assert.ok(claim.rest.distanceTo(rest) < 0.01)
      return
    }
    // Another joint's candidate passed too and its coverage was the greater, which only a second claim allows
    assert.ok(claim.claims > 1, `the ${jointNames[claim.joint]} took a point the ${jointNames[owner]} alone claimed`)
    assert.ok(coverageAt(claim.rest) >= coverageAt(rest), `${jointNames[claim.joint]} ${coverageAt(claim.rest)} over ${jointNames[owner]} ${coverageAt(rest)}, ${claim.claims} claims`)
    lostToAnother++
    const pair = `${jointNames[owner]} to ${jointNames[claim.joint]}`
    lostBy[pair] = (lostBy[pair] ?? 0) + 1
  })
  t.diagnostic(`${sampled.length} cells; owner's candidate within ${worst.toExponential(2)} mm; claimed by a second joint too: ${claimedTwice}; read as the other joint's: ${lostToAnother} (${JSON.stringify(lostBy)})`)
  // Moved rigidly, the flesh of two joints overlaps wherever a joint between them bends, so a second joint claims a
  // point there: about one cell in twenty on this pose (774 of 16,004 when it was written), which the blend is to mend
  assert.ok(claimedTwice / sampled.length < 0.1, `${claimedTwice} of ${sampled.length} claimed twice`)
})

// The male's 2 mm level as its file's header and bounds give it, measured from the file, which the repository doesn't
// hold: its grid, and the centre of its bounds, which every point of its scene is placed about
const fine = {
  size: [286, 165, 941] satisfies Triple,
  spacing: [1.98, 1.98, 2] satisfies Triple,
  origin: [52.305, 32.505, -1.5] satisfies Triple,
  axes: axesFromBytes([0x00, 0x82, 0x01]),
  center: [282.15, -940, 162.36] satisfies Triple,
}

void test("on a level finer than the rig's, the mapping from the scene to the rig's grid puts each cell's centre and its whole cube in that cell", () => {
  assert.deepEqual(fine.axes, volume.axes)
  const toCell = sceneToCell(fine, file)
  const [nx, ny, nz] = file.size
  const place = new Vector3()
  let checked = 0
  for (let k = 0; k < nz; k += 7) {
    for (let j = 0; j < ny; j += 3) {
      for (let i = 0; i < nx; i += 3) {
        const centre: Triple = [file.origin[0] + i * file.spacing[0], file.origin[1] + j * file.spacing[1], file.origin[2] + k * file.spacing[2]]
        // Its centre and points nearly half a cell from it each way
        for (let corner = 0; corner < 9; corner++) {
          const offset = [0, 1, 2].map((axis) => (corner === 8 ? 0 : ((corner >> axis) & 1 ? 0.49 : -0.49) * file.spacing[axis]))
          place.copy(scenePoint(fine, fine.center, [centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]])).applyMatrix4(toCell)
          assert.deepEqual([Math.floor(place.x), Math.floor(place.y), Math.floor(place.z)], [i, j, k])
        }
        checked++
      }
    }
  }
  assert.ok(checked > 50000)
  // On the rig's own level the mapping is the texture's coordinates times the grid's size
  const centre = scenePoint(placement, placement.center, [file.origin[0] + 70 * 3.96, file.origin[1] + 40 * 3.96, file.origin[2] + 200 * 4])
  const uvw = textureCoordinate(volume, bounds.center, centre)
  const cell = centre.clone().applyMatrix4(sceneToCell(placement, file))
  assert.ok(Math.abs(cell.x - uvw.x * nx) < 1e-6 && Math.abs(cell.y - uvw.y * ny) < 1e-6 && Math.abs(cell.z - uvw.z * nz) < 1e-6)
})
