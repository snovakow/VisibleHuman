import { isBodyVoxel, type Triple, type Volume } from '../volume/format.ts'
import { boneDensity } from '../volume/density.ts'
import { noChain } from './rigFile.ts'
import { faceSteps, featureTransform, inside, voxelOf } from './grid.ts'
import { MinCut } from './maxflow.ts'
import { joinedMask, joinsAcross, nearestSegment, segmentDistanceSquared, type Ball, type Segment } from './parts.ts'

// The walls: where a limb lies against the trunk or another limb in the scan, the surface that parts their flesh, so
// that a pose can open it. Found on the body's finest built level, whose 2 mm voxels show the gel caught between arm
// and chest as a dip in the coverage, which the default level's 4 mm voxels only hint at.
//
// Every body voxel first takes the chain of the segment it lies nearest. That puts each parting near the right place
// but not on it: halfway between two bones is seldom where two bodies' surfaces meet. So in a band either side of each
// parting between two chains, outside the joined flesh around the ball joints, the two are parted again by the
// cheapest cut between the band's two edges, each held by its own chain, where cutting costs least through the gel's
// dip in coverage, more through the pale fat and skin, and most through muscle and bone. Two touching bodies meet at a
// neck, the patch where their surfaces press together: a cut along it is far smaller than any around it, so the cut
// takes it, on the gel line where there is one and between the two skins where skin meets skin. Where a band meets
// the joined flesh it's held by neither chain, so a wall ends there. Pure, so the rig script and the tests run it

// How far either side of a first parting the cut finds the chains again, in millimetres
export const bandMm = 40
// How far either side of a wall a cell records it, in the wall field's millimetres: beyond where the field's byte has
// climbed to its top or fallen to its bottom, at 16, so a filtered read never mixes the field's slope with the cells
// that record no wall
export const wallReachMm = 24

// What cutting through a voxel costs, per square millimetre of cut: 1 through pale tissue, fat and skin, 10 through
// muscle and 50 through bone, each times the cube of the share of the voxel that's body, so the gel's line between two
// bodies, only partly body, costs next to nothing
export function cutCost(coverage: number, red: number, green: number, blue: number, density: number): number {
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  const pale = Math.min(1, Math.max(0, (luminance - 0.3) / 0.3))
  let cost = 1 + 9 * (1 - pale)
  if (density >= boneDensity) cost *= 5
  const body = Math.min(1, Math.max(0, (coverage - 127) / 128))
  return cost * body * body * body
}

// The source frame's place of a voxel's centre
function placeOf(volume: Volume, index: number): Triple {
  const [i, j, k] = voxelOf(volume.size, index)
  return [volume.origin[0] + i * volume.spacing[0], volume.origin[1] + j * volume.spacing[1], volume.origin[2] + k * volume.spacing[2]]
}

export interface Chains {
  // Each voxel's chain, by its index in chainNames, or noChain outside the body
  chain: Uint8Array
  // Which limbs' joined flesh the voxel lies in, a bit for each limb's chain, as joinedMask gives it: there a limb and
  // the trunk meet with no wall between them
  joined: Uint8Array
}

// Visits each voxel's face neighbours within the grid
function eachNeighbour(size: Triple, index: number, visit: (neighbour: number, axis: number) => void) {
  const place = voxelOf(size, index)
  for (const { axis, step } of faceSteps(size)) {
    if (inside(size, place[axis], axis, step)) visit(index + step, axis)
  }
}

// Each body voxel's chain by the segment it lies nearest, and whether it's joined
export function nearestChains(volume: Volume, segments: readonly Segment[], balls: readonly Ball[]): Chains {
  const count = volume.coverage.length
  const chain = new Uint8Array(count).fill(noChain)
  const joined = new Uint8Array(count)
  for (let n = 0; n < count; n++) {
    if (!isBodyVoxel(volume.coverage[n])) continue
    const [x, y, z] = placeOf(volume, n)
    chain[n] = nearestSegment(x, y, z, segments, balls).chain
    joined[n] = joinedMask(x, y, z, balls)
  }
  return { chain, joined }
}

// Whether two face neighbours' chains meet at a wall: both body, of two chains, and not of one flesh there
export const isParted = (chain: Uint8Array, joined: Uint8Array, a: number, b: number) =>
  chain[a] !== noChain && chain[b] !== noChain && chain[a] !== chain[b] && !joinsAcross(chain[a], chain[b], joined[a], joined[b])
const parted = (chains: Chains, a: number, b: number) => isParted(chains.chain, chains.joined, a, b)

// The voxels that face a voxel of another chain across a wall
function wallVoxels(volume: Volume, chains: Chains): Uint8Array {
  const count = chains.chain.length
  const wall = new Uint8Array(count)
  for (let n = 0; n < count; n++) {
    if (chains.chain[n] === noChain) continue
    eachNeighbour(volume.size, n, (neighbour) => {
      if (parted(chains, n, neighbour)) wall[n] = 1
    })
  }
  return wall
}

// Each pair of chains that a first parting divides, as their indices, the lower first
function partedPairs(volume: Volume, chains: Chains, walls: Uint8Array): [number, number][] {
  const pairs = new Set<number>()
  for (let n = 0; n < walls.length; n++) {
    if (walls[n] === 0) continue
    eachNeighbour(volume.size, n, (neighbour) => {
      if (!parted(chains, n, neighbour)) return
      const a = Math.min(chains.chain[n], chains.chain[neighbour])
      const b = Math.max(chains.chain[n], chains.chain[neighbour])
      pairs.add(a * 256 + b)
    })
  }
  return [...pairs].sort((x, y) => x - y).map((pair) => [pair >> 8, pair & 255])
}

// How near its own chain's segment a voxel lies to be held to its chain in the cut, in millimetres: a limb thinner than
// the band, lying along the trunk, has no voxel outside the band to hold it, but its bone always does
const heldMm = 3

// The chains found again in a band either side of each parting, by the cheapest cut between each pair's two chains
// described above. Returns the refined chains and how many voxels changed chain
export function refineChains(volume: Volume, first: Chains, segments: readonly Segment[], band = bandMm): { chains: Chains; changed: number } {
  const { size, spacing, coverage, red, green, blue, density } = volume
  const count = coverage.length
  const walls = wallVoxels(volume, first)
  const chain = first.chain.slice()
  const faceArea = [spacing[1] * spacing[2], spacing[0] * spacing[2], spacing[0] * spacing[1]]
  // A tie to a terminal no cut can afford
  const held = 1e12
  for (const [a, b] of partedPairs(volume, first, walls)) {
    // The pair's band: its two chains' voxels within the band's reach of their parting, outside the joined flesh
    const near = featureTransform((n) => walls[n] === 1 && facesAcross(volume, first, n, a, b), size, spacing).squared
    // A voxel within both chains' joined reach, where they're of one flesh, is left out of the band, so a cut ends there
    const pairJoined = (n: number) => joinsAcross(a, b, first.joined[n], first.joined[n])
    const node = new Int32Array(count).fill(-1)
    const members: number[] = []
    for (let n = 0; n < count; n++) {
      const own = first.chain[n]
      if ((own !== a && own !== b) || pairJoined(n) || near[n] > band * band) continue
      node[n] = members.length
      members.push(n)
    }
    const cut = new MinCut(members.length)
    const costOf = (n: number) => cutCost(coverage[n], red[n], green[n], blue[n], density ? density[n] : 0)
    for (let m = 0; m < members.length; m++) {
      const n = members[m]
      const own = first.chain[n]
      let edge = false
      eachNeighbour(size, n, (neighbour, axis) => {
        const other = node[neighbour]
        if (other >= 0) {
          // Each edge once, from the lower index
          if (neighbour > n) {
            const capacity = ((costOf(n) + costOf(neighbour)) / 2) * faceArea[axis]
            cut.addEdge(m, other, capacity, capacity)
          }
          return
        }
        // Beside the band's edge, a voxel of its own chain outside the band holds it to its chain
        if (first.chain[neighbour] === own && !pairJoined(neighbour)) edge = true
      })
      // So does its own chain's segment through it
      if (!edge) {
        const [x, y, z] = placeOf(volume, n)
        edge = segments.some((segment) => segment.chain === own && segmentDistanceSquared(x, y, z, segment) <= heldMm * heldMm)
      }
      if (edge) cut.setTerminal(m, own === a ? held : 0, own === b ? held : 0)
    }
    cut.maxflow()
    for (let m = 0; m < members.length; m++) chain[members[m]] = cut.isSource(m) ? a : b
  }
  let changed = 0
  for (let n = 0; n < count; n++) if (chain[n] !== first.chain[n]) changed++
  return { chains: { chain, joined: first.joined }, changed }
}

// Whether a voxel of one chain of a pair faces the pair's other chain across a wall
function facesAcross(volume: Volume, chains: Chains, n: number, a: number, b: number) {
  const own = chains.chain[n]
  if (own !== a && own !== b) return false
  const other = own === a ? b : a
  let faces = false
  eachNeighbour(volume.size, n, (neighbour) => {
    if (chains.chain[neighbour] === other && parted(chains, n, neighbour)) faces = true
  })
  return faces
}

// A grid of places the walls are measured at: the rig file's, the body's default level's
export interface PlaceGrid {
  size: Triple
  spacing: Triple
  origin: Triple
}

export interface WallField {
  // The chain across the nearest wall within reach, or noChain
  other: Uint8Array
  // A signed measure of the distance to that wall, in millimetres, as wallField takes it: 0 at the wall, positive on
  // the side of the pair whose chain comes first in chainNames, negative on the other's, and 0 where there's no wall
  // within reach
  signed: Float32Array
}

// How far apart two chains' flesh may lie, across air or gel, and still be walled apart, in millimetres. On the finer
// grid a strip of air may part a hand from the belly it lies on, but a coarser grid's cells straddle the strip and
// join the two, so a wall lies across a gap this narrow as it does where the two touch: in the middle of the gap
export const gapMm = 20

// Each chain's wall layer: its voxels within gapMm of another chain's flesh, where the two aren't of one flesh, which
// face that chain across a wall or a narrow gap. One chain's distances to the rest are held at a time
function wallLayers(volume: Volume, chains: Chains, chainCount: number): Uint8Array {
  const { size, spacing } = volume
  const layer = new Uint8Array(chains.chain.length)
  for (let c = 0; c < chainCount; c++) {
    let any = false
    for (let n = 0; n < chains.chain.length && !any; n++) any = chains.chain[n] === c
    if (!any) continue
    const { squared, nearest } = featureTransform((n) => chains.chain[n] === c, size, spacing)
    for (let n = 0; n < chains.chain.length; n++) {
      const own = chains.chain[n]
      if (own === noChain || own === c || squared[n] > gapMm * gapMm) continue
      if (!joinsAcross(own, c, chains.joined[n], chains.joined[nearest[n]])) layer[n] = 1
    }
  }
  return layer
}

// Each place's nearest wall within reach, and a signed measure of its distance to it, measured on the finer grid the
// chains were found on. A wall lies midway between two chains' wall layers, which face each other across it, touching
// or across a narrow gap. A place in the gap, between them, measures half the difference of its distances to the two
// layers, its distance to the wall; a place in one chain's flesh, their mean. A layer holds all of its chain's flesh
// within gapMm of the other's, so in the flesh beside a wall the mean is half the distance to the other's layer and
// rises about half a millimetre a millimetre, as fast as the distance only beyond the layer. Either way it crosses 0 at
// the wall. The own chain of each place is given, as the rig file's grid takes it, or none for a place in the air,
// which takes the chain whose layer is nearer
export function wallField(volume: Volume, chains: Chains, places: PlaceGrid, own: Uint8Array, reach = wallReachMm): WallField {
  const { size, spacing, origin } = volume
  const count = own.length
  const chainCount = 5
  const layers = wallLayers(volume, chains, chainCount)
  // Each place's distance to each chain's wall layer, kept only within reach, one chain at a time
  const distances = Array.from({ length: chainCount }, () => new Float32Array(count).fill(Infinity))
  const [px, py, pz] = places.size
  const far = reach + gapMm
  for (let c = 0; c < chainCount; c++) {
    let any = false
    for (let n = 0; n < layers.length && !any; n++) any = layers[n] === 1 && chains.chain[n] === c
    if (!any) continue
    const { nearest } = featureTransform((n) => layers[n] === 1 && chains.chain[n] === c, size, spacing)
    for (let k = 0; k < pz; k++) {
      for (let j = 0; j < py; j++) {
        for (let i = 0; i < px; i++) {
          const n = i + px * (j + py * k)
          const x = places.origin[0] + i * places.spacing[0]
          const y = places.origin[1] + j * places.spacing[1]
          const z = places.origin[2] + k * places.spacing[2]
          // The nearest feature of the finer voxels about the place, measured from the place itself
          const gx = Math.floor((x - origin[0]) / spacing[0])
          const gy = Math.floor((y - origin[1]) / spacing[1])
          const gz = Math.floor((z - origin[2]) / spacing[2])
          let best = Infinity
          for (let corner = 0; corner < 8; corner++) {
            const a = Math.min(size[0] - 1, Math.max(0, gx + (corner & 1)))
            const b = Math.min(size[1] - 1, Math.max(0, gy + ((corner >> 1) & 1)))
            const d = Math.min(size[2] - 1, Math.max(0, gz + ((corner >> 2) & 1)))
            const feature = nearest[a + size[0] * (b + size[1] * d)]
            if (feature < 0) continue
            const [fi, fj, fk] = voxelOf(size, feature)
            const ex = origin[0] + fi * spacing[0] - x
            const ey = origin[1] + fj * spacing[1] - y
            const ez = origin[2] + fk * spacing[2] - z
            best = Math.min(best, Math.sqrt(ex * ex + ey * ey + ez * ez))
          }
          if (best <= far) distances[c][n] = best
        }
      }
    }
  }
  const other = new Uint8Array(count).fill(noChain)
  const signed = new Float32Array(count)
  for (let n = 0; n < count; n++) {
    // The two chains whose layers lie nearest
    let first = noChain
    let second = noChain
    for (let c = 0; c < chainCount; c++) {
      const d = distances[c][n]
      if (d === Infinity) continue
      if (first === noChain || d < distances[first][n]) {
        second = first
        first = c
      } else if (second === noChain || d < distances[second][n]) second = c
    }
    const mine = own[n] !== noChain ? own[n] : first
    if (mine === noChain) continue
    const across = mine === first ? second : first
    if (across === noChain || distances[mine][n] === Infinity) continue
    const toMine = distances[mine][n]
    const toOther = distances[across][n]
    // In its own flesh a place lies behind its layer, on the side of whichever layer is nearer; in the air, between them
    const mineSide = own[n] !== noChain ? ((toMine + toOther) / 2) * Math.sign(toOther - toMine || 1) : (toOther - toMine) / 2
    if (Math.abs(mineSide) > reach) continue
    other[n] = across
    signed[n] = mine < across ? mineSide : -mineSide
  }
  return { other, signed }
}
