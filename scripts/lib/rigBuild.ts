// The rig file's build, from a body's rig, its finest built level, whose voxels find the walls, and its default level,
// whose grid the file is on: the chains on the finer grid, found by the segments and again in a band about each
// parting; carried onto the default grid by each cell's most common chain; then the walls' field, each cell's home
// joint and skinning, and the skinning across each wall, with the cells beside the body taking its nearest cell's
// values

import { isBodyVoxel, type Volume } from '../../src/volume/format.ts'
import { featureTransform } from '../../src/rig/grid.ts'
import { ballsOf, segmentsOf } from '../../src/rig/parts.ts'
import { noChain, wallMiddle, wallSlope, type RigFile } from '../../src/rig/rigFile.ts'
import type { Rig } from '../../src/rig/rig.ts'
import { nearestChains, refineChains, wallField, type Chains } from '../../src/rig/walls.ts'
import { homeJoints, otherSides, skinWeights, spreadIntoAir } from '../../src/rig/weights.ts'

const chainCount = 5

export interface BuiltRig {
  file: RigFile
  // The chains on the finer grid, for the previews
  fine: Chains
  // How many of the finer grid's body voxels the band's march gave another chain
  changed: number
}

// Each default cell's most common chain among the finer voxels inside it, or none where none of them is body
function carriedChains(fine: Volume, chains: Chains, grid: Volume): Uint8Array {
  const count = grid.coverage.length
  const votes = new Uint8Array(count * chainCount)
  const [fx, fy, fz] = fine.size
  for (let k = 0; k < fz; k++) {
    for (let j = 0; j < fy; j++) {
      for (let i = 0; i < fx; i++) {
        const n = i + fx * (j + fy * k)
        const chain = chains.chain[n]
        if (chain === noChain) continue
        const ci = Math.round((fine.origin[0] + i * fine.spacing[0] - grid.origin[0]) / grid.spacing[0])
        const cj = Math.round((fine.origin[1] + j * fine.spacing[1] - grid.origin[1]) / grid.spacing[1])
        const ck = Math.round((fine.origin[2] + k * fine.spacing[2] - grid.origin[2]) / grid.spacing[2])
        if (ci < 0 || cj < 0 || ck < 0 || ci >= grid.size[0] || cj >= grid.size[1] || ck >= grid.size[2]) continue
        const cell = ci + grid.size[0] * (cj + grid.size[1] * ck)
        votes[cell * chainCount + chain] = Math.min(255, votes[cell * chainCount + chain] + 1)
      }
    }
  }
  const chain = new Uint8Array(count).fill(noChain)
  for (let n = 0; n < count; n++) {
    let best = 0
    for (let c = 0; c < chainCount; c++) {
      if (votes[n * chainCount + c] > best) {
        best = votes[n * chainCount + c]
        chain[n] = c
      }
    }
  }
  return chain
}

export function buildRig(rig: Rig, fine: Volume, grid: Volume, log: (line: string) => void = () => {}): BuiltRig {
  const clock = performance.now()
  const lap = (what: string) => log(`${what} in ${((performance.now() - clock) / 1000).toFixed(1)} s`)
  const segments = segmentsOf(rig)
  const balls = ballsOf(rig)

  const first = nearestChains(fine, segments, balls)
  lap('The finer grid takes its chains by the segments')
  const { chains: fineChains, changed } = refineChains(fine, first, segments)
  lap(`The band about each parting finds them again, moving ${changed.toLocaleString('en')} voxels`)

  // The default grid's chains, for its body cells: carried, then given to any body cell none came to by the nearest
  // body cell with one. The air's cells have none while the walls are measured, so that a cell in a gap between two
  // chains takes the chain whose side of the gap it lies on
  const chain = carriedChains(fine, fineChains, grid)
  const isBody = (n: number) => isBodyVoxel(grid.coverage[n])
  for (let n = 0; n < chain.length; n++) if (!isBody(n)) chain[n] = noChain
  const { nearest } = featureTransform((n) => chain[n] !== noChain, grid.size, grid.spacing)
  for (let n = 0; n < chain.length; n++) if (isBody(n) && chain[n] === noChain && nearest[n] >= 0) chain[n] = chain[nearest[n]]
  lap('The default grid takes its chains')

  const field = wallField(fine, fineChains, grid, chain)
  const wall = new Uint8Array(chain.length).fill(wallMiddle)
  for (let n = 0; n < wall.length; n++) {
    if (field.other[n] !== noChain) wall[n] = Math.max(0, Math.min(255, Math.round(wallMiddle + wallSlope * field.signed[n])))
  }
  lap('The walls are measured')

  const home = homeJoints(grid, chain, segments, balls)
  const skinning = skinWeights(grid, chain, home, segments, balls)
  lap('Each cell is skinned')
  const across = otherSides(grid, chain, field.other, skinning)
  lap('The cells beside the walls take the skinning across them')

  // The air beside the body takes its nearest body cell's chain and skinning, from one place, so they agree. It keeps
  // the wall field measured at its own place, which in a gap between two chains crosses the gap's middle; the pair of
  // chains it records is its nearest body cell's, which across a gap is one of the two
  const blocks = [chain, field.other, skinning.jointA, skinning.jointB, skinning.weight, across.otherJointA, across.otherJointB, across.otherWeight]
  spreadIntoAir(grid, isBody, blocks)
  lap('The air beside the body takes its nearest cell')

  return {
    file: {
      size: grid.size,
      spacing: grid.spacing,
      origin: grid.origin,
      rig,
      cells: { chain, otherChain: field.other, wall, ...skinning, ...across },
    },
    fine: fineChains,
    changed,
  }
}
