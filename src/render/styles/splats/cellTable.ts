import { DataTexture, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { writeColorBytes } from 'three/addons/utils/GaussianSplatUtils.js'
import {
  colorSpaceToWorking,
  Discard,
  dot,
  exp,
  Fn,
  If,
  int,
  ivec2,
  positionView,
  round,
  textureLoad,
  varyingProperty,
  vec3,
  vec4,
} from 'three/tsl'
import type { Triple } from '../../../volume/format.ts'
import type { Level } from '../../../volume/levels.ts'
import { cutLimits, type Cuts } from '../../cuts.ts'
import type { DepthCue } from '../../depthCue.ts'

// The cell table: one RGBA texel per cell of a level, in splat order, which the splats' colour node reads by the cell's
// index, carried in the splat's own colour bytes. Those bytes are copied into the splat's storage when it's built and
// have no update path, so Opacity and the cuts rewrite the table's alpha in place instead, and rebuild nothing

const bytesPerCell = 4
// An index is written as three bytes, the red the low, the green the middle and the blue the high, so it's exact to
// 2²⁴ cells, ten times the 4 mm level's
const byteRange = 256
const fullByte = byteRange - 1
// A fixed width, a power of two within WebGPU's default limit of 8192 texels, with as many rows as the cells need
const tableWidth = 4096

// What the table's alpha is painted from
export interface TablePaint {
  opacity: number
  cuts: Cuts
}

export interface CellTable {
  texture: DataTexture
  bytes: Uint8Array
  // What it was last painted from, so a level shown again is repainted only if that has changed
  painted: TablePaint | null
}

// Whether a table is painted from the same values as those given
export function isPainted({ painted }: CellTable, { opacity, cuts }: TablePaint) {
  return (
    painted !== null &&
    painted.opacity === opacity &&
    painted.cuts.axial === cuts.axial &&
    painted.cuts.coronal === cuts.coronal &&
    painted.cuts.sagittal === cuts.sagittal
  )
}

// A level's table, its texels holding the cells' colours, unpainted. The bytes are the photographs' sRGB, which the
// colour node decodes, so the texture takes no colour space; it's read by texel, so it takes no filtering and no
// mipmaps, as a DataTexture has by default
export function createCellTable({ count, colors }: Level): CellTable {
  const rows = Math.max(1, Math.ceil(count / tableWidth))
  const bytes = new Uint8Array(tableWidth * rows * bytesPerCell)
  for (let n = 0; n < count; n++) {
    bytes[n * bytesPerCell] = colors[n * 3]
    bytes[n * bytesPerCell + 1] = colors[n * 3 + 1]
    bytes[n * bytesPerCell + 2] = colors[n * 3 + 2]
  }
  return { texture: new DataTexture(bytes, tableWidth, rows, RGBAFormat, UnsignedByteType), bytes, painted: null }
}

// Paints every cell's alpha: none on a cut's far side, and elsewhere Opacity's share of the cell's coverage, so a cell
// the skin runs through is as opaque as it's covered and the surface's lattice of whole cells fades at its steps
// instead of showing them as contour rings. The centres are centred on the bounds, so half holds the bounds' half
// extents along x, y and z, which the cuts' planes run across
export function paintCellTable(table: CellTable, { count, centers, coverage }: Level, half: Triple, paint: TablePaint) {
  const { bytes } = table
  const { opacity } = paint
  // Axial keeps what's below its plane, Coronal what's behind its own, and Sagittal what's to the left of its own
  const { top, front, right } = cutLimits(half, paint.cuts)
  for (let n = 0; n < count; n++) {
    const x = centers[n * 3]
    const y = centers[n * 3 + 1]
    const z = centers[n * 3 + 2]
    bytes[n * bytesPerCell + 3] = y > top || z > front || x < right ? 0 : Math.round(opacity * coverage[n])
  }
  table.texture.needsUpdate = true
  table.painted = { opacity, cuts: { ...paint.cuts } }
}

// Writes a cell's index into its splat's colour bytes, with a full alpha, which three's antialiasing compensation
// then scales and the colour node multiplies by the table's
export function writeCellIndex(target: Uint8ClampedArray, offset: number, index: number) {
  const low = index % byteRange
  const middle = Math.floor(index / byteRange) % byteRange
  const high = Math.floor(index / (byteRange * byteRange))
  writeColorBytes(target, offset, low, middle, high, fullByte)
}

// The splat's own varyings, by three's names: its position across the splat, in standard deviations, and its colour,
// whose rgb carries the cell's index and whose alpha is three's antialiasing compensation. three clamps the colour to
// 0–1 and the quad's corners all carry one value, so each channel times 255 rounds back to its byte
const splatUv = varyingProperty('vec2', 'vSplatUv')
const splatColor = varyingProperty('vec4', 'vSplatColor')
const cellIndex = int(dot(round(splatColor.rgb.mul(fullByte)), vec3(1, byteRange, byteRange * byteRange)))

// The splats' colour node, which replaces three's own: its Gaussian falloff, out to two standard deviations as three
// cuts it, in the cell's colour from the table, decoded from sRGB to the linear colour the renderer works in, so that
// the output's encoding gives back the photographs' bytes, and darkened by the depth cue. Every pixel of a splat has
// its centre's view depth, as three rebuilds the fragment's position from a clip position whose depth all four corners
// share, so the cue is the same across it. A cut cell's fragments are discarded rather than blended in at no alpha
export function cellColor(table: CellTable, cue: DepthCue) {
  const texels = textureLoad(table.texture)
  const depthShade = cue.at(positionView.z.negate())
  return Fn(() => {
    const r2 = dot(splatUv, splatUv).toVar()
    If(r2.greaterThan(4), () => {
      Discard()
    })
    const index = cellIndex.toVar()
    const row = index.div(tableWidth).toVar()
    const texel = texels.load(ivec2(index.sub(row.mul(tableWidth)), row)).toVar()
    If(texel.a.equal(0), () => {
      Discard()
    })
    const rgb = colorSpaceToWorking(texel, SRGBColorSpace).rgb
    return vec4(rgb.mul(depthShade), exp(r2.mul(-0.5)).mul(splatColor.a).mul(texel.a))
  })()
}
