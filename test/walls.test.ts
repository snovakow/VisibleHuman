import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ball, Segment } from '../src/rig/parts.ts'
import { noChain } from '../src/rig/rigFile.ts'
import { nearestChains, refineChains } from '../src/rig/walls.ts'
import { homeJoints, skinWeights } from '../src/rig/weights.ts'
import { cellIndex, type Triple, type Volume } from '../src/volume/format.ts'

// The walls (src/rig/walls.ts) and the skinning (src/rig/weights.ts), on phantoms built here: a wide body and a narrow
// limb lying against it, which the first parting, halfway between their bones, splits inside the wide one, and the cut
// moves to where they touch; and a limb of two bones meeting at a joint, whose flesh follows each bone beside it and
// is shared about the joint

const spacing: Triple = [2, 2, 2]
const origin: Triple = [0, 0, 0]

// Muscle inside, a pale layer of fat and skin two voxels thick under each surface, as the photographs show them
const muscle = [80, 44, 34] as const
const fat = [207, 185, 129] as const

interface Shape {
  // A cylinder along k, by its axis's place in i and j and its radius, in voxels
  i: number
  j: number
  radius: number
}

// A volume of cylinders along k, each body inside its radius, with the pale layer under its surface; where two meet,
// both are body. A gel line, partly body, may part them over some of their length
function phantom(size: Triple, shapes: readonly Shape[], gel?: (i: number, j: number, k: number) => boolean): Volume {
  const count = size[0] * size[1] * size[2]
  const red = new Uint8Array(count)
  const green = new Uint8Array(count)
  const blue = new Uint8Array(count)
  const coverage = new Uint8Array(count)
  const density = new Uint8Array(count)
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const n = cellIndex(size, i, j, k)
        // How deep inside the nearest shape the voxel lies, in voxels
        let depth = -Infinity
        for (const shape of shapes) depth = Math.max(depth, shape.radius - Math.hypot(i - shape.i, j - shape.j))
        if (depth < 0) continue
        coverage[n] = gel?.(i, j, k) ? 150 : 255
        const colour = depth < 2 ? fat : muscle
        red[n] = colour[0]
        green[n] = colour[1]
        blue[n] = colour[2]
        density[n] = 60
      }
    }
  }
  return {
    size,
    spacing,
    origin,
    firstSlice: 1,
    lastSlice: size[2],
    axes: { x: { source: 0, sign: 1 }, y: { source: 2, sign: -1 }, z: { source: 1, sign: 1 } },
    body: 'phantom',
    red,
    green,
    blue,
    coverage,
    density,
  }
}

const along = (shape: Shape, chain: number, joint: number, depth: number): Segment => ({
  joint,
  chain,
  from: [shape.i * 2, shape.j * 2, 0],
  to: [shape.i * 2, shape.j * 2, (depth - 1) * 2],
})

void test('a wall between a wide body and a narrow limb against it lies where they touch, not halfway between their bones', () => {
  const size: Triple = [44, 30, 12]
  const wide: Shape = { i: 14, j: 15, radius: 12 }
  const narrow: Shape = { i: 32, j: 15, radius: 6 }
  const volume = phantom(size, [wide, narrow])
  const segments = [along(wide, 0, 0, size[2]), along(narrow, 1, 1, size[2])]
  const first = nearestChains(volume, segments, [])
  const { chains } = refineChains(volume, first, segments)
  // Every voxel takes the shape it lies deeper inside, but within a voxel of where they meet
  let wrongBefore = 0
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      for (let i = 0; i < size[0]; i++) {
        const n = cellIndex(size, i, j, k)
        if (chains.chain[n] === noChain) continue
        const inWide = wide.radius - Math.hypot(i - wide.i, j - wide.j)
        const inNarrow = narrow.radius - Math.hypot(i - narrow.i, j - narrow.j)
        if (Math.abs(inWide - inNarrow) <= 1.5) continue
        const expected = inWide > inNarrow ? 0 : 1
        if (first.chain[n] !== expected) wrongBefore++
        assert.equal(chains.chain[n], expected, `(${i}, ${j}, ${k})`)
      }
    }
  }
  // The first parting, halfway between the bones, was wrong, which is what the cut is for
  assert.ok(wrongBefore > 0)
})

void test('a gel line between the two pins the wall to it', () => {
  const size: Triple = [44, 30, 12]
  const wide: Shape = { i: 14, j: 15, radius: 12 }
  const narrow: Shape = { i: 31, j: 15, radius: 6 }
  // The shapes overlap by a voxel along i = 25 and 26, which the gel marks
  const volume = phantom(size, [wide, narrow], (i) => i === 25)
  const segments = [along(wide, 0, 0, size[2]), along(narrow, 1, 1, size[2])]
  const { chains } = refineChains(volume, nearestChains(volume, segments, []), segments)
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      const left = chains.chain[cellIndex(size, 24, j, k)]
      const right = chains.chain[cellIndex(size, 26, j, k)]
      if (left === noChain || right === noChain) continue
      assert.equal(left, 0, `the wide body's side at (24, ${j}, ${k})`)
      assert.equal(right, 1, `the limb's side at (26, ${j}, ${k})`)
    }
  }
})

void test("within the limb's joined reach the two meet with no wall, and the band leaves them as the segments did", () => {
  const size: Triple = [44, 30, 12]
  const wide: Shape = { i: 14, j: 15, radius: 12 }
  const narrow: Shape = { i: 32, j: 15, radius: 6 }
  const volume = phantom(size, [wide, narrow])
  const segments = [along(wide, 0, 0, size[2]), along(narrow, 1, 1, size[2])]
  // A ball on the limb whose joined reach takes in the whole phantom
  const ball: Ball = { joint: 1, chain: 1, at: [64, 30, 10], radius: 4, joined: 1000 }
  const first = nearestChains(volume, segments, [ball])
  const { chains, changed } = refineChains(volume, first, segments)
  assert.equal(changed, 0)
  assert.deepEqual(chains.chain, first.chain)
})

void test('flesh follows the bone beside it, is shared about a joint, and a bone moves with its own joint alone', () => {
  // One limb along k, two bones meeting at its middle: the upper from k = 0 to 15, the lower from 15 to 29
  const size: Triple = [20, 20, 30]
  const limb: Shape = { i: 10, j: 10, radius: 7 }
  const volume = phantom(size, [limb])
  // The bones' cells are dense
  for (let k = 0; k < size[2]; k++) {
    for (const [i, j] of [
      [10, 10],
      [11, 10],
      [10, 11],
    ]) {
      if (k !== 15) volume.density![cellIndex(size, i, j, k)] = 150
    }
  }
  const upper: Segment = { joint: 0, chain: 0, from: [20, 20, 0], to: [20, 20, 30] }
  const lower: Segment = { joint: 1, chain: 0, from: [20, 20, 30], to: [20, 20, 58] }
  const chain = new Uint8Array(volume.coverage.length).fill(noChain)
  for (let n = 0; n < chain.length; n++) if (volume.coverage[n] >= 128) chain[n] = 0
  const home = homeJoints(volume, chain, [upper, lower], [])
  const { jointA, jointB, weight } = skinWeights(volume, chain, home, [upper, lower], [])
  const at = (i: number, j: number, k: number) => cellIndex(size, i, j, k)
  // Bone moves with its own joint alone
  assert.deepEqual([jointA[at(10, 10, 5)], jointB[at(10, 10, 5)], weight[at(10, 10, 5)]], [0, 0, 255])
  assert.deepEqual([jointA[at(10, 10, 25)], jointB[at(10, 10, 25)], weight[at(10, 10, 25)]], [1, 1, 255])
  // Flesh far up the limb follows the upper bone, and far down the lower, all but wholly
  const share = (n: number, joint: number) => (jointA[n] === joint ? weight[n] : jointB[n] === joint ? 255 - weight[n] : 0) / 255
  assert.ok(share(at(15, 10, 4), 0) > 0.99)
  assert.ok(share(at(15, 10, 26), 1) > 0.99)
  // Flesh about the joint, at its level, is shared about evenly
  const middle = at(15, 10, 15)
  assert.ok(Math.abs(share(middle, 0) - 0.5) < 0.15, `shared ${share(middle, 0)} and ${share(middle, 1)}`)
  // The shares always make a whole, and across the joint they pass from one bone to the other in order
  let last = 1
  for (let k = 2; k < 28; k++) {
    const n = at(15, 10, k)
    assert.ok(Math.abs(share(n, 0) + share(n, 1) - 1) < 0.01)
    assert.ok(share(n, 0) <= last + 0.02, `at k = ${k} the upper bone's share rises`)
    last = share(n, 0)
  }
})
