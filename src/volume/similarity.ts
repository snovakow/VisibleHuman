// The 2D similarity that places a CT slice on its cryosection: a flip, a rotation and a scale about the CT image's
// centre, then a translation. A CT pixel centre (u, v), in pixels from the CT image's top-left, lands on the cryo
// pixel centre
//
//   (x, y) = scale · R(rotationDeg) · F(flip) · (u − cu, v − cv) + (tx, ty)
//
// with (cu, cv) the CT image's centre, F negating v for a vertical flip, u for a horizontal one and both for both,
// R turning clockwise on the page in image coordinates (x right, y down), and scale the CT pixel's millimetres
// over the cryo pixel's. The registration fits one per segment; the volume script uses its inverse to find, for each
// cell of its grid, the CT pixel to sample. Both go through a plain affine map, which has an exact inverse

export type Flip = 'none' | 'vertical' | 'horizontal' | 'both'
export const flips: readonly Flip[] = ['none', 'vertical', 'horizontal', 'both']

export interface Similarity {
  scale: number
  rotationDeg: number
  tx: number
  ty: number
  flip: Flip
}

export type Point = readonly [number, number]

// x' = a·x + b·y + e, y' = c·x + d·y + f
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const identity: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export const isFlip = (value: unknown): value is Flip => typeof value === 'string' && flips.some((flip) => flip === value)

// The signs a flip puts on u and v
const flipSigns = (flip: Flip): Point => [
  flip === 'horizontal' || flip === 'both' ? -1 : 1,
  flip === 'vertical' || flip === 'both' ? -1 : 1,
]

// The map from CT pixels to cryo pixels, with the CT image's centre given in pixels
export function ctToCryo(similarity: Similarity, centre: Point): Affine {
  const { scale, rotationDeg, tx, ty, flip } = similarity
  const angle = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [su, sv] = flipSigns(flip)
  const [cu, cv] = centre
  // Rows of scale · R · F
  const a = scale * cos * su
  const b = -scale * sin * sv
  const c = scale * sin * su
  const d = scale * cos * sv
  return { a, b, c, d, e: tx - a * cu - b * cv, f: ty - c * cu - d * cv }
}

export function apply(map: Affine, [x, y]: Point): Point {
  return [map.a * x + map.b * y + map.e, map.c * x + map.d * y + map.f]
}

export function invert(map: Affine): Affine {
  const { a, b, c, d, e, f } = map
  const determinant = a * d - b * c
  if (determinant === 0) throw new Error('The map flattens the plane, so it has no inverse')
  const ia = d / determinant
  const ib = -b / determinant
  const ic = -c / determinant
  const id = a / determinant
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * e + ib * f), f: -(ic * e + id * f) }
}

// The map that applies inner first, then outer
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.b * inner.c,
    b: outer.a * inner.b + outer.b * inner.d,
    c: outer.c * inner.a + outer.d * inner.c,
    d: outer.c * inner.b + outer.d * inner.d,
    e: outer.a * inner.e + outer.b * inner.f + outer.e,
    f: outer.c * inner.e + outer.d * inner.f + outer.f,
  }
}
