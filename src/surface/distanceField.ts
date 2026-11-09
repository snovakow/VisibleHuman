import { isBodyVoxel, type Triple } from '../volume/format.ts'

// How far each body voxel lies inside the body: its Euclidean distance to the nearest voxel centre outside the body,
// in voxels, with the voxel taken as a cube, and 0 outside. Computed exactly by Felzenszwalb and Huttenlocher's
// separable passes, the squared distance along i, then along j over that, then along k, each the lower envelope of the
// parabolas rooted at the row's values; along i, where every value is 0 or none yet, that's the distance to the
// nearest outside voxel in the row, found by a sweep each way. A shell under the skin is this field's isosurface:
// half a voxel out from the outermost body voxels' centres is where the skin's crossing lies, and every voxel deeper
// is that much further in, so the shells nest, none crossing another. Pure, so the worker runs it and the tests
// prove it

// Where the field crosses the skin, in voxels: halfway between the outermost body voxels' centres, at 1, and the
// outside voxels' beside them, at 0. A shell d voxels under the skin is the isosurface at this plus d
export const skinDistance = 0.5

// A squared distance no voxel's can reach, standing for "no outside voxel along the row yet": finite, so the
// parabolas' crossings never meet infinity minus infinity
const far = 1e20

export function distanceField(coverage: Uint8Array, size: Triple): Float32Array<ArrayBuffer> {
  const [nx, ny, nz] = size
  const nxy = nx * ny
  const cells = nxy * nz
  if (coverage.length !== cells) {
    throw new Error(`The coverage has ${coverage.length} bytes, but a ${size.join(' × ')} grid needs ${cells}`)
  }
  // The squared distances, refined pass by pass, then their roots
  const field = new Float32Array(cells)
  for (let n = 0; n < cells; n++) field[n] = isBodyVoxel(coverage[n]) ? far : 0

  // One row's scratch, sized for the longest axis and reused by every row: its values, its result, and the envelope's
  // parabolas by where each is rooted and from where along the row each is the lowest
  const longest = Math.max(nx, ny, nz)
  const values = new Float64Array(longest)
  const result = new Float64Array(longest)
  const roots = new Int32Array(longest)
  const bounds = new Float64Array(longest + 1)

  // The squared distance along a row of i, from the body voxels, which hold far, to the nearest outside voxel in the
  // row, which holds 0: a sweep forward finds the nearest behind each voxel, and one back the nearest ahead
  const sweep = (start: number) => {
    let last = -1
    for (let q = 0; q < nx; q++) {
      if (field[start + q] === 0) last = q
      else if (last >= 0) field[start + q] = (q - last) * (q - last)
    }
    last = -1
    for (let q = nx - 1; q >= 0; q--) {
      const n = start + q
      if (field[n] === 0) last = q
      else if (last >= 0) field[n] = Math.min(field[n], (last - q) * (last - q))
    }
  }

  // The squared distance transform of one row of `count` values `stride` apart from `start`, in place. The outside
  // voxels hold 0 and keep it, and each body voxel's nearest outside voxel in the row lies no further out than the one
  // either side of the row's body, so only the span from one before its first body voxel to one after its last is
  // transformed. A row all outside, or all with no outside voxel found yet, is left as it is
  const pass = (start: number, count: number, stride: number) => {
    let first = -1
    let last = -1
    let unreached = 0
    for (let q = 0, n = start; q < count; q++, n += stride) {
      const value = field[n]
      values[q] = value
      if (value === 0) continue
      if (first < 0) first = q
      last = q
      if (value >= far) unreached++
    }
    if (first < 0 || unreached === count) return
    const low = Math.max(0, first - 1)
    const high = Math.min(count - 1, last + 1)
    let top = 0
    roots[0] = low
    bounds[0] = -Infinity
    bounds[1] = Infinity
    for (let q = low + 1; q <= high; q++) {
      const lift = values[q] + q * q
      let root = roots[top]
      let crossing = (lift - (values[root] + root * root)) / (2 * (q - root))
      while (crossing <= bounds[top]) {
        top--
        root = roots[top]
        crossing = (lift - (values[root] + root * root)) / (2 * (q - root))
      }
      top++
      roots[top] = q
      bounds[top] = crossing
      bounds[top + 1] = Infinity
    }
    top = 0
    for (let q = low; q <= high; q++) {
      while (bounds[top + 1] < q) top++
      const root = roots[top]
      result[q] = (q - root) * (q - root) + values[root]
    }
    for (let q = low, n = start + low * stride; q <= high; q++, n += stride) field[n] = result[q]
  }

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) sweep(nx * (j + ny * k))
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(i + nxy * k, ny, nx)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(i + nx * j, nz, nxy)
  for (let n = 0; n < cells; n++) field[n] = Math.sqrt(field[n])
  return field
}
