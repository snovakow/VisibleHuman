// The rigid transform that places one scan of the head on another: a rotation about a stated centre, then a
// translation, six numbers in all. A point p of the source, in millimetres in the source's frame, lands at
//
//   q = R(rotationDeg) · (p − from) + to + translationMm
//
// with `from` and `to` the two grids' centres in their own frames, and R the turn about x by rotationDeg[0], then
// about y by rotationDeg[1], then about z by rotationDeg[2], each counter-clockwise seen from the axis's tip. A file
// records the six numbers and the centres; the fit and the resampling go through a plain map q = M · p + t, which has
// an exact inverse. The first guess at R comes from the two shapes' principal axes, which fix it only up to which
// axis is which and which way each points: 24 turns to try, of which the fit keeps the best

export type Vec3 = readonly [number, number, number]
// A 3 × 3 matrix by its rows
export type Mat3 = readonly [Vec3, Vec3, Vec3]

export interface Rigid {
  // Degrees about x, then y, then z
  rotationDeg: Vec3
  translationMm: Vec3
}

// q = matrix · p + offset
export interface RigidMap {
  matrix: Mat3
  offset: Vec3
}

export const identityMatrix: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

export const multiply = (a: Mat3, b: Mat3): Mat3 => {
  const cell = (row: number, column: number) => a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column]
  const row = (n: number): Vec3 => [cell(n, 0), cell(n, 1), cell(n, 2)]
  return [row(0), row(1), row(2)]
}

export const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
]

export const transform = (m: Mat3, [x, y, z]: Vec3): Vec3 => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z,
  m[1][0] * x + m[1][1] * y + m[1][2] * z,
  m[2][0] * x + m[2][1] * y + m[2][2] * z,
]

export const determinant = (m: Mat3) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])

const radians = (degrees: number) => (degrees * Math.PI) / 180
const degrees = (angle: number) => (angle * 180) / Math.PI

// The rotation by the three angles: about x first, then y, then z, so the matrix is Rz · Ry · Rx
export function rotationMatrix([x, y, z]: Vec3): Mat3 {
  const [cx, sx] = [Math.cos(radians(x)), Math.sin(radians(x))]
  const [cy, sy] = [Math.cos(radians(y)), Math.sin(radians(y))]
  const [cz, sz] = [Math.cos(radians(z)), Math.sin(radians(z))]
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ]
}

// The three angles of a rotation matrix, the inverse of rotationMatrix. Where the turn about y is a quarter turn,
// x and z turn about the same line and only their sum or difference is fixed: z is then given as 0
export function rotationDegrees(m: Mat3): Vec3 {
  const sy = Math.max(-1, Math.min(1, -m[2][0]))
  // Within a millionth of a quarter turn
  if (Math.abs(sy) > 1 - 1e-12) return [degrees(Math.atan2(-m[1][2], m[1][1])), degrees(Math.asin(sy)), 0]
  return [degrees(Math.atan2(m[2][1], m[2][2])), degrees(Math.asin(sy)), degrees(Math.atan2(m[1][0], m[0][0]))]
}

// The angle of a rotation, in degrees, from 0 to 180: how far it turns about its own axis
export function rotationAngle(m: Mat3) {
  return degrees(Math.acos(Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2))))
}

// The map of a rigid transform about the source's centre `from`, onto the target's centre `to`
export function rigidMap(rigid: Rigid, from: Vec3, to: Vec3): RigidMap {
  return mapAbout(rotationMatrix(rigid.rotationDeg), rigid.translationMm, from, to)
}

// q = matrix · (p − from) + to + translation, as a plain map
export function mapAbout(matrix: Mat3, translation: Vec3, from: Vec3, to: Vec3): RigidMap {
  const turned = transform(matrix, from)
  return { matrix, offset: [to[0] + translation[0] - turned[0], to[1] + translation[1] - turned[1], to[2] + translation[2] - turned[2]] }
}

// The rigid transform about the two centres that a map amounts to, for a file: the inverse of rigidMap
export function rigidOf(map: RigidMap, from: Vec3, to: Vec3): Rigid {
  const turned = transform(map.matrix, from)
  return {
    rotationDeg: rotationDegrees(map.matrix),
    translationMm: [map.offset[0] + turned[0] - to[0], map.offset[1] + turned[1] - to[1], map.offset[2] + turned[2] - to[2]],
  }
}

export function apply(map: RigidMap, point: Vec3): Vec3 {
  const [x, y, z] = transform(map.matrix, point)
  return [x + map.offset[0], y + map.offset[1], z + map.offset[2]]
}

// A rotation's inverse is its transpose, so the map's is exact
export function invert(map: RigidMap): RigidMap {
  const matrix = transpose(map.matrix)
  const [x, y, z] = transform(matrix, map.offset)
  return { matrix, offset: [-x, -y, -z] }
}

// The map that applies inner first, then outer
export function compose(outer: RigidMap, inner: RigidMap): RigidMap {
  return { matrix: multiply(outer.matrix, inner.matrix), offset: apply(outer, inner.offset) }
}

// A shape's first and second moments, gathered point by point: enough for its centre and its principal axes
export interface Moments {
  count: number
  sum: [number, number, number]
  // The sums of xx, yy, zz, xy, xz and yz
  products: [number, number, number, number, number, number]
}

export const emptyMoments = (): Moments => ({ count: 0, sum: [0, 0, 0], products: [0, 0, 0, 0, 0, 0] })

export function addPoint(moments: Moments, x: number, y: number, z: number) {
  moments.count++
  moments.sum[0] += x
  moments.sum[1] += y
  moments.sum[2] += z
  moments.products[0] += x * x
  moments.products[1] += y * y
  moments.products[2] += z * z
  moments.products[3] += x * y
  moments.products[4] += x * z
  moments.products[5] += y * z
}

export interface PrincipalFrame {
  centroid: Vec3
  // The principal axes as rows, unit vectors, the longest first, made right-handed by the third's sign
  axes: Mat3
  // The shape's variance along each, in the points' units squared
  variances: Vec3
}

// A shape's centre and principal axes from its moments: the eigenvectors of its covariance, found by Jacobi's
// rotations, which converge on a symmetric 3 × 3 in a few sweeps
export function principalFrame(moments: Moments): PrincipalFrame {
  const { count, sum, products } = moments
  if (count === 0) throw new Error('A shape with no points has no principal axes')
  const centroid: Vec3 = [sum[0] / count, sum[1] / count, sum[2] / count]
  const covariance = (n: number, a: number, b: number) => products[n] / count - centroid[a] * centroid[b]
  const a = [
    [covariance(0, 0, 0), covariance(3, 0, 1), covariance(4, 0, 2)],
    [covariance(3, 0, 1), covariance(1, 1, 1), covariance(5, 1, 2)],
    [covariance(4, 0, 2), covariance(5, 1, 2), covariance(2, 2, 2)],
  ]
  // The eigenvectors gather in v's columns as the off-diagonal cells are turned to zero, the largest first
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const sweeps = 32
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2])
    if (off < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (a[p][q] === 0) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p]
        const akq = a[k][q]
        a[k][p] = c * akp - s * akq
        a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k]
        const aqk = a[q][k]
        a[p][k] = c * apk - s * aqk
        a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]
        const vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq
        v[k][q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((m, n) => a[n][n] - a[m][m])
  const axis = (n: number): Vec3 => [v[0][order[n]], v[1][order[n]], v[2][order[n]]]
  const first = axis(0)
  const second = axis(1)
  let third = axis(2)
  if (determinant([first, second, third]) < 0) third = [-third[0], -third[1], -third[2]]
  return { centroid, axes: [first, second, third], variances: [a[order[0]][order[0]], a[order[1]][order[1]], a[order[2]][order[2]]] }
}

// The 24 turns that take the three axes onto themselves, each to an axis or its opposite: every order of the axes with
// every choice of signs that leaves the turn a rotation, not a mirror. The first is the identity
export const axisTurns: readonly Mat3[] = (() => {
  const turns: Mat3[] = []
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  for (const order of orders) {
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const row = (axis: number, sign: number): Vec3 => [axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0]
          const turn: Mat3 = [row(order[0], sx), row(order[1], sy), row(order[2], sz)]
          if (determinant(turn) > 0) turns.push(turn)
        }
      }
    }
  }
  return turns
})()

// The rotations that could take a shape with principal axes `from` onto the same shape turned, with axes `to`: one
// for each way of matching the axes up, 24 in all. Principal axes come with no sign and, where two variances are
// close, in no sure order, so which of these is the turn is for the fit to say
export function rotationsBetween(from: Mat3, to: Mat3): Mat3[] {
  const back = transpose(to)
  return axisTurns.map((turn) => multiply(back, multiply(turn, from)))
}
