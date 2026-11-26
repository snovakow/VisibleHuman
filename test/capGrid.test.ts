import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Placement } from '../src/rig/pose.ts'
import { noChain, wallMiddle, wallSlope, type RigCells } from '../src/rig/rigFile.ts'
import type { RigGridCells } from '../src/rig/sampling.ts'
import { capGrids, capMesh, capMiddle } from '../src/surface/capGrid.ts'
import type { SceneAxes, Triple } from '../src/volume/format.ts'

// The cap on a posed body's cut (src/surface/capGrid.ts): a grid in the cut's plane at rest for each chain the plane
// meets, on a rig file of a box built here, whose two chains a wall parts or none does

const axes: SceneAxes = { x: { source: 0, sign: 1 }, y: { source: 1, sign: 1 }, z: { source: 2, sign: 1 } }
// The scene's frame is the source frame, so a vertex's place is its place among the cells
const placement: Placement = { axes, origin: [0, 0, 0], center: [0, 0, 0] }

// A box of 20 × 10 × 10 cells 2 mm apart: chain 0 up to i = 9 and chain 1 from 10, a wall between them at x = 19 mm
// recorded within 12 mm of it, or, with no wall, chain 0 throughout
const size: Triple = [20, 10, 10]
const spacing = 2
const at = (i: number, j: number, k: number) => i + size[0] * (j + size[1] * k)
function rigOf(walled: boolean, joined = false): RigGridCells {
  const count = size[0] * size[1] * size[2]
  const block = (value: number) => new Uint8Array(count).fill(value)
  const cells: RigCells = {
    chain: block(0),
    otherChain: block(noChain),
    wall: block(wallMiddle),
    jointA: block(0),
    jointB: block(0),
    weight: block(255),
    otherJointA: block(0),
    otherJointB: block(0),
    otherWeight: block(255),
  }
  if (walled || joined) {
    for (let k = 0; k < size[2]; k++) {
      for (let j = 0; j < size[1]; j++) {
        for (let i = 0; i < size[0]; i++) {
          const n = at(i, j, k)
          cells.chain[n] = i <= 9 ? 0 : 1
          cells.jointA[n] = cells.jointB[n] = i <= 9 ? 0 : 1
          const distance = (9.5 - i) * spacing
          if (joined || Math.abs(distance) > 12) continue
          cells.otherChain[n] = i <= 9 ? 1 : 0
          cells.wall[n] = Math.max(0, Math.min(255, Math.round(wallMiddle + wallSlope * distance)))
        }
      }
    }
  }
  return { size, spacing: [spacing, spacing, spacing], origin: [0, 0, 0], cells }
}

// A plane across z at 9 mm, between the cells' layers at 8 and 10 mm, crossing the wall
const input = (walled: boolean) => ({ file: rigOf(walled), placement, axis: 2 as const, level: 9 })

void test('a plane across two chains a wall parts gives one grid for each, every vertex on the plane', () => {
  const grids = capGrids(input(true))
  assert.deepEqual(
    grids.map((grid) => grid.chain),
    [0, 1],
  )
  for (const grid of grids) {
    assert.ok(grid.indices.length > 0)
    for (let v = 0; v < grid.measures.length; v++) assert.equal(grid.positions[v * 3 + 2], 9, `chain ${grid.chain}'s vertex ${v}`)
    for (const index of grid.indices) assert.ok(index < grid.measures.length)
  }
})

void test('each chain\'s measure crosses the middle where the wall crosses the plane, and the two sides\' are each other\'s complement', () => {
  for (const grid of capGrids(input(true))) {
    // Along a row of the grid, at y = 10 mm: the measure crosses the middle between x = 18 and 20, where the wall lies
    const row = new Map<number, number>()
    for (let v = 0; v < grid.measures.length; v++) if (grid.positions[v * 3 + 1] === 10) row.set(grid.positions[v * 3], grid.measures[v])
    const before = row.get(18)
    const after = row.get(20)
    assert.ok(before !== undefined && after !== undefined)
    const crossing = 18 + (2 * (capMiddle - before)) / (after - before)
    assert.ok(Math.abs(crossing - 19) < 0.1, `chain ${grid.chain} crosses at x = ${crossing}`)
    // Its own flesh above the middle, the other's below
    const inOwn = grid.chain === 0 ? before : after
    const inOther = grid.chain === 0 ? after : before
    assert.ok(inOwn > capMiddle && inOther < capMiddle)
    // Nothing of the chain's grid lies further into the other's flesh than the first cell past the wall
    for (let v = 0; v < grid.measures.length; v++) {
      const x = grid.positions[v * 3]
      assert.ok(grid.chain === 0 ? x <= 20 : x >= 18, `chain ${grid.chain}'s vertex at x = ${x}`)
    }
  }
  // Where both grids hold a vertex, their measures sum to the whole byte, so the two sections meet with no gap
  const [left, right] = capGrids(input(true))
  const key = (grid: typeof left, v: number) => `${grid.positions[v * 3]},${grid.positions[v * 3 + 1]}`
  const rights = new Map<string, number>()
  for (let v = 0; v < right.measures.length; v++) rights.set(key(right, v), right.measures[v])
  let shared = 0
  for (let v = 0; v < left.measures.length; v++) {
    const other = rights.get(key(left, v))
    if (other === undefined) continue
    shared++
    assert.equal(left.measures[v] + other, 255)
  }
  assert.ok(shared > 0)
})

void test('with no wall the plane gives one grid, over the whole of it, the chain\'s own flesh throughout', () => {
  const grids = capGrids(input(false))
  assert.equal(grids.length, 1)
  const [grid] = grids
  assert.equal(grid.chain, 0)
  assert.equal(grid.measures.length, size[0] * size[1])
  assert.equal(grid.indices.length / 3, 2 * (size[0] - 1) * (size[1] - 1))
  assert.ok(grid.measures.every((measure) => measure === 255))
  // As one mesh, each vertex names its chain
  const mesh = capMesh(input(true))
  assert.equal(mesh.chains, 2)
  const first = capGrids(input(true))[0].measures.length
  assert.ok(mesh.sides.subarray(0, first).every((side) => side === 0) && mesh.sides.subarray(first).every((side) => side === 1))
})

void test('where two chains are one flesh with no wall, as about a shoulder, their sections meet and skin their shared vertices alike', () => {
  const grids = capGrids({ ...input(false), file: rigOf(false, true) })
  assert.deepEqual(
    grids.map((grid) => grid.chain),
    [0, 1],
  )
  const [left, right] = grids
  const key = (grid: typeof left, v: number) => `${grid.positions[v * 3]},${grid.positions[v * 3 + 1]}`
  const rights = new Map<string, number>()
  for (let v = 0; v < right.measures.length; v++) rights.set(key(right, v), v)
  let shared = 0
  for (let v = 0; v < left.measures.length; v++) {
    const w = rights.get(key(left, v))
    if (w === undefined) continue
    shared++
    // One side's flesh wholly, the other's not at all, and both copies skinned as the chain whose flesh it is
    assert.equal(left.measures[v] + right.measures[w], 255)
    assert.equal(left.sides[v], right.sides[w])
    assert.equal(left.sides[v], left.measures[v] === 255 ? 0 : 1)
  }
  // The two columns either side of the border, along each row
  assert.equal(shared, 2 * size[1])
})
