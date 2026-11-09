// Telling body from background. Each slice shows the body set in blue gel, inside a black frame, with white
// fiducial dots, a grey-scale card and a yellow tag. A pixel is body unless it's blue, dark or grey; a cell is body when
// most of its pixels are; and only the largest connected piece of body is kept, which drops the tag, the card's pale
// patches and the dots, since none of them touch the body. Tuned on slices 1100, 1500, 1950 and 2600

// The gel is blue: blue above red by more than this. Tissue is red, yellow or cream, with red above blue
export const blueMargin = 0
// The frame, its shadow and the card's dark end are near black: every channel below this. The darkest tissue, such as
// clotted blood, sits above it
export const darkMax = 40
// The card's patches and the fiducial dots are grey or white: the channels within this of each other. Tissue,
// pale cartilage and fat included, spreads further
export const greyRange = 20
// A cell is body when more than this share of its pixels are
export const bodyShare = 0.5

export function isBodyPixel(r: number, g: number, b: number) {
  if (b > r + blueMargin) return false
  const max = Math.max(r, g, b)
  if (max < darkMax) return false
  return max - Math.min(r, g, b) >= greyRange
}

export const isBodyCell = (bodyPixels: number, pixels: number) => bodyPixels > pixels * bodyShare

// Some slices are missing in effect, and are read as if they weren't there: they add nothing to their cells.
// A blank slice has no body pixels at all, as 2424 to 2435 have, where the NLM's set holds all-black images between
// the thighs' block and the legs'; an all-dark slice has none either, since dark pixels aren't body.
// A short slice has far fewer body pixels than the slices on either side of it, as the first slices of a block do
// under a frosty cast that reads as gel (2017 to 2020). It's short when its count is under dipShare of the smaller of
// two references: the largest count among the dipWindow nearest non-blank slices before it, and the same after it.
// A slice within dipWindow slices of either end of the slices read, or of the body, has too few on that side to judge
// it by, so it's never short: a taper isn't, and nor is the crown's second slice, 1002, which is a sixth smaller
// than 1001 alone and was flagged when one slice was reference enough
export const dipWindow = 8
export const dipShare = 0.85

export type MissingReason = 'blank' | 'short'

// Why a slice with this many body pixels is missing, or null if it isn't. Before and after hold the body pixel counts
// of up to dipWindow non-blank slices on each side, nearest first
export function missingReason(body: number, before: readonly number[], after: readonly number[]): MissingReason | null {
  if (body === 0) return 'blank'
  if (before.length < dipWindow || after.length < dipWindow) return null
  const reference = Math.min(Math.max(...before), Math.max(...after))
  return body < reference * dipShare ? 'short' : null
}

// The planes a gap's colour is blended in: the colour, one of the planes filled, and the body decision it's blended
// by, a byte per cell, non-zero for body
export interface GapBlend {
  colors: Uint8Array
  body: Uint8Array
}

// Fills each layer made only of missing slices from its nearest read layers, so the body stays one piece across the
// gap: in a run of missing layers, the upper half copies the read layer above it and the lower half the one below
// (the middle one, in an odd run, from above). A run at either end of the grid copies the one read layer beside it.
// Each plane holds the whole grid, layer after layer of layerCells cells, with any whole number of bytes per cell (one
// for a cell's body or coverage, three for its colour), and every plane is filled the same way, except the colour
// where blend names it: in a run between two read layers, the layer a fraction t of the way from the one above to the
// one below takes (1 − t) of the colour above and t of the colour below, in a cell that's body in both, so the gap
// steps evenly from one side's colour to the other's instead of jumping halfway; a cell that's body on one side only
// takes that side's colour, and one that's body on neither the nearer side's. Returns each layer's source: itself when
// read, the layer its cells were filled from, or -1 when no layer was read at all
export function fillMissingLayers(
  planes: readonly Uint8Array[],
  layerCells: number,
  missing: readonly boolean[],
  blend?: GapBlend,
) {
  const layers = missing.length
  const strideOf = (plane: Uint8Array) => {
    const stride = plane.length / (layers * layerCells)
    if (!Number.isInteger(stride) || stride < 1) {
      throw new Error(`fillMissingLayers: a plane of ${plane.length} bytes for ${layers} layers of ${layerCells} cells`)
    }
    return stride
  }
  const strides = planes.map(strideOf)
  if (blend && !planes.includes(blend.colors)) throw new Error('fillMissingLayers: the colour blended is not a plane filled')
  if (blend && strideOf(blend.body) !== 1) throw new Error('fillMissingLayers: the body blended by has more than a byte a cell')
  const sources = missing.map((gap, layer) => (gap ? -1 : layer))
  for (let layer = 0; layer < layers; layer++) {
    if (!missing[layer]) continue
    let above = layer - 1
    while (above >= 0 && missing[above]) above--
    let below = layer + 1
    while (below < layers && missing[below]) below++
    const hasBelow = below < layers
    const source = above >= 0 && (!hasBelow || layer - above <= below - layer) ? above : hasBelow ? below : -1
    sources[layer] = source
    if (source < 0) continue
    planes.forEach((plane, n) => {
      const bytes = layerCells * strides[n]
      plane.copyWithin(layer * bytes, source * bytes, (source + 1) * bytes)
    })
    if (!blend || above < 0 || !hasBelow) continue
    const { colors, body } = blend
    const stride = strideOf(colors)
    const t = (layer - above) / (below - above)
    for (let cell = 0; cell < layerCells; cell++) {
      const inAbove = body[above * layerCells + cell] !== 0
      const inBelow = body[below * layerCells + cell] !== 0
      if (!inAbove && !inBelow) continue
      const to = (layer * layerCells + cell) * stride
      const fromAbove = (above * layerCells + cell) * stride
      const fromBelow = (below * layerCells + cell) * stride
      for (let c = 0; c < stride; c++) {
        const a = colors[fromAbove + c]
        const b = colors[fromBelow + c]
        colors[to + c] = !inBelow ? a : !inAbove ? b : Math.round((1 - t) * a + t * b)
      }
    }
  }
  return sources
}

// Keeps the largest 6-connected piece of a grid of cells, one byte each (non-zero for body), indexed
// i + nx·(j + ny·k). Pieces join across faces only, slices included, not along edges or corners. Returns a new grid
// of 0s and 1s and the piece's size. The search uses an explicit queue, since the body runs to millions of cells
export function largestPiece(cells: Uint8Array, nx: number, ny: number, nz: number) {
  const count = nx * ny * nz
  if (cells.length !== count) throw new Error(`largestPiece: ${cells.length} cells for a ${nx} × ${ny} × ${nz} grid`)
  const seen = new Uint8Array(count)
  const queue = new Int32Array(count)
  const layer = nx * ny

  // Visits the piece holding start, calling visit on each cell, and returns its size
  const flood = (start: number, visit: (index: number) => void) => {
    let head = 0
    let tail = 0
    const step = (neighbour: number) => {
      if (cells[neighbour] !== 0 && seen[neighbour] === 0) {
        seen[neighbour] = 1
        queue[tail++] = neighbour
      }
    }
    step(start)
    while (head < tail) {
      const index = queue[head++]
      visit(index)
      const i = index % nx
      const j = Math.floor(index / nx) % ny
      const k = Math.floor(index / layer)
      if (i > 0) step(index - 1)
      if (i < nx - 1) step(index + 1)
      if (j > 0) step(index - nx)
      if (j < ny - 1) step(index + nx)
      if (k > 0) step(index - layer)
      if (k < nz - 1) step(index + layer)
    }
    return tail
  }

  let bestStart = -1
  let bestSize = 0
  for (let index = 0; index < count; index++) {
    if (cells[index] === 0 || seen[index] !== 0) continue
    const size = flood(index, () => undefined)
    if (size > bestSize) {
      bestSize = size
      bestStart = index
    }
  }

  const kept = new Uint8Array(count)
  if (bestStart < 0) return { cells: kept, size: 0 }
  seen.fill(0)
  flood(bestStart, (index) => {
    kept[index] = 1
  })
  return { cells: kept, size: bestSize }
}
