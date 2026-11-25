import type { Triple } from '../volume/format.ts'

// Helpers on a dense grid in the volume's index order, i + nx·(j + ny·k), shared by the rig's build: the Euclidean
// distance from every voxel to the nearest of a set of feature voxels, with which one that is, over a spacing that may
// differ along each axis. Pure, so the build script and the tests run them alike

// A squared distance no voxel's can reach, standing for "no feature along the row yet": finite, so the parabolas'
// crossings never meet infinity minus infinity
const far = 1e30

export interface FeatureTransform {
  // Each voxel's squared distance to its nearest feature voxel, in square millimetres, or far where the grid has none
  squared: Float32Array<ArrayBuffer>
  // The index of that feature voxel, or −1 where the grid has none
  nearest: Int32Array<ArrayBuffer>
}

// The exact Euclidean distance transform with its nearest features, by Felzenszwalb and Huttenlocher's separable
// passes: along i, then along j over that, then along k, each the lower envelope of the parabolas rooted at the row's
// values, each parabola as wide as its axis's spacing says. A feature voxel is its own nearest, at no distance
export function featureTransform(isFeature: (index: number) => boolean, size: Triple, spacing: Triple): FeatureTransform {
  const [nx, ny, nz] = size
  const nxy = nx * ny
  const cells = nxy * nz
  const squared = new Float32Array(cells)
  const nearest = new Int32Array(cells)
  for (let n = 0; n < cells; n++) {
    const feature = isFeature(n)
    squared[n] = feature ? 0 : far
    nearest[n] = feature ? n : -1
  }
  const longest = Math.max(nx, ny, nz)
  const values = new Float64Array(longest)
  const owners = new Int32Array(longest)
  const roots = new Int32Array(longest)
  const bounds = new Float64Array(longest + 1)
  const pass = (start: number, count: number, stride: number, step: number) => {
    const step2 = step * step
    let any = false
    for (let q = 0, n = start; q < count; q++, n += stride) {
      values[q] = squared[n]
      owners[q] = nearest[n]
      if (values[q] < far) any = true
    }
    if (!any) return
    // The envelope over the rooted parabolas, skipping the voxels with nothing yet, which root none
    let top = -1
    for (let q = 0; q < count; q++) {
      if (values[q] >= far) continue
      const lift = values[q] + q * q * step2
      if (top < 0) {
        top = 0
        roots[0] = q
        bounds[0] = -Infinity
        bounds[1] = Infinity
        continue
      }
      let root = roots[top]
      let crossing = (lift - (values[root] + root * root * step2)) / (2 * step2 * (q - root))
      while (crossing <= bounds[top]) {
        top--
        if (top < 0) break
        root = roots[top]
        crossing = (lift - (values[root] + root * root * step2)) / (2 * step2 * (q - root))
      }
      top++
      roots[top] = q
      bounds[top] = top === 0 ? -Infinity : crossing
      bounds[top + 1] = Infinity
    }
    let at = 0
    for (let q = 0, n = start; q < count; q++, n += stride) {
      while (bounds[at + 1] < q) at++
      const root = roots[at]
      squared[n] = (q - root) * (q - root) * step2 + values[root]
      nearest[n] = owners[root]
    }
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) pass(nx * (j + ny * k), nx, 1, spacing[0])
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(i + nxy * k, ny, nx, spacing[1])
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(i + nx * j, nz, nxy, spacing[2])
  return { squared, nearest }
}

// The grid's index of voxel (i, j, k), and the voxel of an index
export const indexOf = (size: Triple, i: number, j: number, k: number) => i + size[0] * (j + size[1] * k)
export function voxelOf(size: Triple, index: number): Triple {
  const i = index % size[0]
  const row = (index - i) / size[0]
  const j = row % size[1]
  return [i, j, (row - j) / size[1]]
}

// The six neighbours' index steps, with the axis each runs along, for walking a grid face to face
export function faceSteps(size: Triple) {
  const nxy = size[0] * size[1]
  return [
    { axis: 0, step: 1 },
    { axis: 0, step: -1 },
    { axis: 1, step: size[0] },
    { axis: 1, step: -size[0] },
    { axis: 2, step: nxy },
    { axis: 2, step: -nxy },
  ] as const
}

// Whether the neighbour a step away along an axis lies in the grid, for a voxel at that place along the axis
export function inside(size: Triple, along: number, axis: number, step: number) {
  return step > 0 ? along + 1 < size[axis] : along > 0
}

// A binary min-heap of grid indices keyed by float distances, held in typed arrays so a march over millions of voxels
// makes no garbage. An index may be pushed again with a smaller key; its stale entries are passed over when popped,
// by comparing with the caller's own record of each voxel's best
export class IndexHeap {
  private keys: Float64Array
  private items: Int32Array
  size = 0

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity)
    this.items = new Int32Array(capacity)
  }

  push(item: number, key: number) {
    if (this.size === this.items.length) {
      const keys = new Float64Array(this.size * 2)
      keys.set(this.keys)
      const items = new Int32Array(this.size * 2)
      items.set(this.items)
      this.keys = keys
      this.items = items
    }
    let at = this.size++
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (this.keys[parent] <= key) break
      this.keys[at] = this.keys[parent]
      this.items[at] = this.items[parent]
      at = parent
    }
    this.keys[at] = key
    this.items[at] = item
  }

  // The least key's item, removed, with its key left in topKey
  topKey = 0
  pop(): number {
    const item = this.items[0]
    this.topKey = this.keys[0]
    const lastKey = this.keys[--this.size]
    const lastItem = this.items[this.size]
    let at = 0
    for (;;) {
      let child = 2 * at + 1
      if (child >= this.size) break
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++
      if (this.keys[child] >= lastKey) break
      this.keys[at] = this.keys[child]
      this.items[at] = this.items[child]
      at = child
    }
    this.keys[at] = lastKey
    this.items[at] = lastItem
    return item
  }
}
