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

// The head is set in ice instead of gel: white frost over the crown and smooth grey ice below it, a little warm of
// neutral and lit unevenly, so that one frame's ice runs from a brightness of about 80 to over 200. Its channels
// spread with its brightness, as a cast does, which is why the rule above, a spread in levels, fits it badly: bright
// frost spreads as many levels as dim tissue. Tissue is told from it by the spread as a share of the brightest
// channel: a pixel is body when that share is at least this. The ice's share reaches 0.12 and the frost's 0.15 where
// the scalp shows through it; the palest tissue, bone and white matter, starts at 0.18.
// Tuned two ways. On patches labelled by hand on slices 1, 20, 60, 300, 600, 740, 900, 1200 and 1420, it keeps 0.3 %
// of the ice and 0.8 % of the frost the scalp shows through, and drops 3.5 % of whole stretches of tissue; a spread of
// 24 levels keeps 6.1 % of that ice, 40 % of that frost, and drops 7.8 % of that tissue. On 865,000 pixels of the
// six slices 20 to 400, labelled by the registered CT as 3 mm or more inside the head or outside it, it keeps 0.5 %
// of the ice and drops 4.6 % of the tissue, where 24 levels keeps 7.9 % and drops 4.6 %. At 0.14 the frost over the
// forehead joins the scalp as a cloud; at 0.18 the tissue dropped passes a tenth and the scalp starts to pit.
// What it drops is tissue with little colour of its own, the eye's vitreous and tissue under the grey streaks the
// knife leaves, which the head's build fills back in where tissue encloses it
export const iceSpreadShare = 0.16

// The head has no blue gel, so its blue veins count, and its darkest pixels are told from tissue as the male's are
export function isTissueOnIce(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  if (max < darkMax) return false
  return max - Math.min(r, g, b) >= iceSpreadShare * max
}

export const isBodyCell = (bodyPixels: number, pixels: number) => bodyPixels > pixels * bodyShare

// Some slices are missing in effect, and are read as if they weren't there: they add nothing to their cells.
// A blank slice has no body pixels at all, as 2424 to 2435 have, where the NLM's set holds all-black images between
// the thighs' block and the legs'; an all-dark slice has none either, since dark pixels aren't body.
// A short slice has far fewer body pixels than the slices on either side of it, as the first slices of a block do
// under a frosty cast that reads as gel (2017 to 2020). It's short when its count is under dipShare of the smaller of
// two references: the largest count among the nearest non-blank slices within dipWindowMm before it, and the same
// after it. The window is counted in millimetres, so that it reaches as far into every body: eight of the male's
// slices, but 24 of the female's, a third of a millimetre apart, whose window of eight reached only 2.7 mm and took
// slices under the same frost as the reference (her 1490a, at 319 thousand body pixels, was judged against 1498a at
// 318 thousand, where the clear slices either side hold 690 to 830 thousand). A slice with fewer than the window's
// slices on either side of it, within the slices read or the body, has too few on that side to judge it by, so it's
// never short: a taper isn't, and nor is the crown's second slice, 1002, which is a sixth smaller than 1001 alone and
// was flagged when one slice was reference enough. A body may keep a window of its own, as the head does
export const dipWindowMm = 8
export const dipShare = 0.85

// How many of a body's files, sliceSpacing apart, span this many millimetres
export const filesSpanning = (mm: number, sliceSpacing: number) => Math.round(mm / sliceSpacing)

export type MissingReason = 'blank' | 'short' | 'frosted'

// Why a slice with this many body pixels is missing by the blank and short rules, or null if it isn't. Before and
// after hold the body pixel counts of up to window non-blank slices on each side, nearest first, the window being
// dipWindowMm in the body's files
export function missingReason(
  body: number,
  before: readonly number[],
  after: readonly number[],
  window: number,
): MissingReason | null {
  if (body === 0) return 'blank'
  if (before.length < window || after.length < window) return null
  const reference = Math.min(Math.max(...before), Math.max(...after))
  return body < reference * dipShare ? 'short' : null
}

// Frost at a block's faces. The first and last slices of a frozen block can lie under frost, bright, green and blue,
// which the gel rule reads as body: as it takes the gel a slice's body pixels fall, which the short rule sees, and as
// it covers the tissue their colour turns blue, which it doesn't. A slice within frostReachMm of a face of its block,
// or of a run of blank or short slices, is frosted when its body pixels' mean blue over red is more than frostShare
// above the median of the same ratio over the kept slices frostReferenceMm from it on the side away from that face,
// which lie past the frost's reach. Measured on every slice of both bodies: the frost the short rule leaves raises the
// ratio by 10.4 % or more (the female's 1499b and 1980c, 3 mm into their blocks, and up to 37 % at 1979b; the male's
// 1506 by 12.3 % and 2016 by 12.1 %), and fades over 4 mm or less, the female's next slices rising 8.6 to 9.9 %. The
// share sits between that and what tints a face's slices that isn't frost: the colour card photographed beside the
// male's 2436 to 2443, whose patches pass the gel rule, raises the ratio of 2436 to 2442 by 8.1 to 9.3 % while the
// legs beside it read as the slices after it do; at 8 % those seven slices of the legs were read as missing. Away
// from the faces the ratio drifts with the anatomy by as much (a 4 mm layer by up to 10.7 % over the male's 1363 to
// 1371 against the medians 8 to 16 mm either side), which is why only slices near a face are judged
export const frostReachMm = 8
export const frostReferenceMm = [8, 16] as const
export const frostShare = 0.1

// The side of a slice its frost is judged from: 1 for the slices after it, where the nearest face within reach lies
// before it, -1 for those before it, where that face lies after it, or null where no face lies within reach, when it
// isn't judged. Positions count files; a face is named by the position of the first file after it, so it lies half a
// file before that file, and reach is frostReachMm in files
export function frostSide(position: number, faces: readonly number[], reach: number): 1 | -1 | null {
  let nearest = Infinity
  let side: 1 | -1 | null = null
  for (const face of faces) {
    const distance = Math.abs(position - (face - 0.5))
    if (distance >= reach || distance >= nearest) continue
    nearest = distance
    side = face <= position ? 1 : -1
  }
  return side
}

// Whether a slice whose body pixels' mean blue over red is blueOverRed is frosted, against the same ratio of the kept
// slices it's judged by; null where there are none to judge it by
export function frostedReason(blueOverRed: number, references: readonly number[]): MissingReason | null {
  if (references.length === 0) return null
  const sorted = references.toSorted((a, b) => a - b)
  const middle = sorted.length >> 1
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return blueOverRed > median * (1 + frostShare) ? 'frosted' : null
}

// A layer that keeps fewer than this share of its slices is filled as a missing one, from its neighbours: the frosted
// slices beside a face would otherwise leave layers made of one or two slices, whose cells hold too few pixels to
// average and whose coverage thins where the frost took the gel's place
export const thinShare = 0.5

export const isThinLayer = (kept: number, slices: number) => kept < slices * thinShare

// The planes a gap's colour is blended in: the colour, one of the planes filled, and the body decision it's blended
// by, a byte per cell, non-zero for body
export interface GapBlend {
  colors: Uint8Array
  body: Uint8Array
}

// Fills each layer marked missing, one made only of missing slices or keeping too few, from its nearest read layers,
// so the body stays one piece across the gap: in a run of missing layers, the upper half copies the read layer above
// it and the lower half the one below (the middle one, in an odd run, from above). A run at either end of the grid
// copies the one read layer beside it.
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

// The cells outside the body that the body encloses: those from which no path of cells outside it, stepping across
// faces as the pieces join, reaches a face of the grid. The grid is one byte a cell (non-zero for body), indexed
// i + nx·(j + ny·k); a grid one layer deep gives what a single slice encloses within itself. Returns a grid of 0s and
// 1s and how many it marks. A body that fills them counts tissue the pixel rule can't tell from the background, where
// it lies inside tissue the rule can
export function enclosedCells(cells: Uint8Array, nx: number, ny: number, nz: number) {
  const count = nx * ny * nz
  if (cells.length !== count) throw new Error(`enclosedCells: ${cells.length} cells for a ${nx} × ${ny} × ${nz} grid`)
  const layer = nx * ny
  // Every cell outside the body that the faces reach, found from the faces inward
  const reached = new Uint8Array(count)
  const queue = new Int32Array(count)
  let head = 0
  let tail = 0
  const step = (index: number) => {
    if (cells[index] === 0 && reached[index] === 0) {
      reached[index] = 1
      queue[tail++] = index
    }
  }
  for (let k = 0; k < nz; k++) {
    // A grid one layer deep has no faces along k to start from: its one layer is searched within itself
    const endLayer = nz > 1 && (k === 0 || k === nz - 1)
    for (let j = 0; j < ny; j++) {
      const endRow = j === 0 || j === ny - 1
      for (let i = 0; i < nx; i++) {
        if (endLayer || endRow || i === 0 || i === nx - 1) step(i + nx * (j + ny * k))
      }
    }
  }
  while (head < tail) {
    const index = queue[head++]
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
  const enclosed = new Uint8Array(count)
  let size = 0
  for (let index = 0; index < count; index++) {
    if (cells[index] !== 0 || reached[index] !== 0) continue
    enclosed[index] = 1
    size++
  }
  return { cells: enclosed, size }
}
