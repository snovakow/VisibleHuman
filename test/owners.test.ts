import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import type { Placement } from '../src/rig/pose.ts'
import { jointCellBoxes, jointOfVoxel, jointSceneBoxes, noOwnerChain, noOwnerJoint, ownerBytes, ownerChain, ownerJoint, ownerOf } from '../src/rig/owners.ts'
import { chainNames, jointNames } from '../src/rig/rig.ts'
import { noChain, readRigFile } from '../src/rig/rigFile.ts'
import { readVolume } from '../src/volume/format.ts'
import { bodyBounds } from '../src/volume/levels.ts'

// Each rig cell's owner, packed as the per-pixel styles fetch it, and each joint's box of the cells it owns
// (src/rig/owners.ts), on the male's committed 4 mm level and rig file

const read = (path: string) => new Uint8Array(gunzipSync(readFileSync(new URL(path, import.meta.url))))
const volume = readVolume(read('../public/volume/male-4mm.bin'))
const file = readRigFile(read('../public/volume/male.rig.bin'))
const bounds = bodyBounds(volume)
const placement: Placement = { axes: volume.axes, origin: volume.origin, center: bounds.center }
const cellBoxes = jointCellBoxes(file)
const sceneBoxes = jointSceneBoxes(file, cellBoxes, placement, bounds.half)

void test('a cell is owned by its first joint, whose share is never the lesser, and by none beyond the reach', () => {
  const { chain, jointA, weight } = file.cells
  let owned = 0
  for (let n = 0; n < chain.length; n++) {
    if (chain[n] === noChain) {
      assert.equal(ownerOf(file.cells, n), -1)
      continue
    }
    owned++
    assert.ok(weight[n] >= 128, `cell ${n}'s first joint takes ${weight[n]} of 255`)
    assert.equal(ownerOf(file.cells, n), jointA[n])
  }
  assert.ok(owned > 1_000_000)
  // Every cell of the body is in the reach
  for (let n = 0; n < chain.length; n++) if (volume.coverage[n] >= 128) assert.notEqual(chain[n], noChain)
})

void test('the owner byte holds the joint and the chain, each with its own code for none', () => {
  const bytes = ownerBytes(file.cells)
  assert.equal(bytes.length, file.cells.chain.length)
  assert.equal(noOwnerJoint, 31)
  assert.equal(noOwnerChain, 7)
  assert.ok(jointNames.length < noOwnerJoint && chainNames.length < noOwnerChain)
  for (let n = 0; n < bytes.length; n++) {
    const owner = ownerOf(file.cells, n)
    if (owner < 0) {
      assert.equal(ownerJoint(bytes[n]), noOwnerJoint)
      assert.equal(ownerChain(bytes[n]), noOwnerChain)
    } else {
      assert.equal(ownerJoint(bytes[n]), owner)
      assert.equal(ownerChain(bytes[n]), file.cells.chain[n])
    }
  }
})

void test("each joint's box holds every cell it owns, and together they reach every face of the body's bounds", () => {
  const [nx, ny] = file.size
  for (let joint = 0; joint < jointNames.length; joint++) assert.ok(cellBoxes[joint] && sceneBoxes[joint], `the ${jointNames[joint]} owns no cell`)
  // A source point's place in the scene along each of its axes, as scenePoint puts it, written out so that the
  // millions of corners below make nothing
  const axes = [volume.axes.x, volume.axes.y, volume.axes.z]
  const sceneOf = (source: readonly number[], scene: number) => {
    const { source: from, sign } = axes[scene]
    return sign * (source[from] - placement.origin[from]) - placement.center[scene]
  }
  // Every cell's centre lies in its owner's box where it lies in the bounds, and so does each corner of its whole cube,
  // since a point is read at its nearest cell. Counted rather than asserted one by one, which would take seconds
  const source = [0, 0, 0]
  let checked = 0
  let outside = 0
  let bodyOutside = 0
  let first = ''
  for (let n = 0; n < file.cells.chain.length; n++) {
    const joint = ownerOf(file.cells, n)
    if (joint < 0) continue
    const box = sceneBoxes[joint]
    if (!box) continue
    const cell = [n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))]
    for (let corner = 0; corner < 9; corner++) {
      for (let axis = 0; axis < 3; axis++) {
        const offset = corner === 8 ? 0 : (corner >> axis) & 1 ? 0.4995 : -0.4995
        source[axis] = file.origin[axis] + (cell[axis] + offset) * file.spacing[axis]
      }
      let within = true
      let held = true
      for (let scene = 0; scene < 3; scene++) {
        const value = sceneOf(source, scene)
        if (Math.abs(value) > bounds.half[scene]) within = false
        if (value < box.min[scene] - 1e-9 || value > box.max[scene] + 1e-9) held = false
      }
      if (within && !held) {
        outside++
        if (!first) first = `cell (${cell.join(', ')}) of the ${jointNames[joint]}`
      }
      // A cell of the body lies within the bounds, so its centre is always checked
      if (corner === 8 && volume.coverage[n] >= 128 && !within) bodyOutside++
    }
    checked++
  }
  assert.equal(outside, 0, `${outside} places lie outside their owner's box, first ${first}`)
  assert.equal(bodyOutside, 0)
  assert.ok(checked > 1_000_000)
  // Each box lies within the bounds, and their union reaches each of the bounds' six faces
  for (let axis = 0; axis < 3; axis++) {
    const lowest = Math.min(...sceneBoxes.map((box) => box?.min[axis] ?? Infinity))
    const highest = Math.max(...sceneBoxes.map((box) => box?.max[axis] ?? -Infinity))
    assert.ok(Math.abs(lowest + bounds.half[axis]) < 1e-6, `the boxes start at ${lowest} along axis ${axis}, the bounds at ${-bounds.half[axis]}`)
    assert.ok(Math.abs(highest - bounds.half[axis]) < 1e-6, `the boxes end at ${highest} along axis ${axis}, the bounds at ${bounds.half[axis]}`)
    for (const box of sceneBoxes) assert.ok(box && box.min[axis] >= -bounds.half[axis] - 1e-9 && box.max[axis] <= bounds.half[axis] + 1e-9)
  }
})

void test("a voxel of a mesh's grid moves with the owner of the rig cell nearest it, and with none off the rig's grid", () => {
  // On the rig's own grid, each voxel is its cell
  const own = jointOfVoxel(file, file)
  const [nx, ny, nz] = file.size
  for (let k = 0, n = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, n++) if (own(i, j, k) !== ownerOf(file.cells, n)) assert.fail(`voxel ${i}, ${j}, ${k}`)
  // On a grid of half the spacing, two voxels to a cell along each axis, the even ones on the cells' centres
  const half = jointOfVoxel(file, { size: [nx * 2, ny * 2, nz * 2], spacing: [file.spacing[0] / 2, file.spacing[1] / 2, file.spacing[2] / 2], origin: file.origin })
  const middle = [Math.floor(nx / 2), Math.floor(ny / 2), Math.floor(nz / 2)]
  assert.equal(half(middle[0] * 2, middle[1] * 2, middle[2] * 2), ownerOf(file.cells, middle[0] + nx * (middle[1] + ny * middle[2])))
  assert.equal(own(-1, 0, 0), -1)
  assert.equal(own(nx, 0, 0), -1)
})
