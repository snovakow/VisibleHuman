// The rig's previews, which show where its joints sit in the body: the bone as the CT shows it, from the front and from
// each side, with the skeleton drawn over it, and a sheet of every joint up close. They're drawn through the volume's
// own scene axes, as the volume's previews are, so the body shows as the app shows it: from the front, its left on the
// image's right; from a side, its front on the image's right. The close-ups cut the body three ways through each
// joint, in the photographs' colour with the CT's bone tinted, and look through a slab either side of it at the
// bone, so a joint can be judged against its joint space

import { join } from 'node:path'
import sharp from 'sharp'
import { Vector3 } from 'three'
import { boneDensity } from '../../src/volume/density.ts'
import { cellIndex, isBodyVoxel, type Triple, type Volume } from '../../src/volume/format.ts'
import { boneEnd, byJoint, jointNames, scanFrames, skeletonShape, type JointName, type Rig } from '../../src/rig/rig.ts'
import { isParted } from '../../src/rig/walls.ts'
import { writeWhole } from './files.ts'

export const rigPreviewFolder = '.cache/preview/rig'

type Rgb = readonly [number, number, number]

// A point's place along the scene's axes, in voxels from voxel (0, 0, 0), signed as the axes run: the grid's own
// place, fractional, as sceneCell gives it for whole voxels
function sceneVoxel(volume: Volume, at: Triple): Triple {
  const grid = [0, 1, 2].map((axis) => (at[axis] - volume.origin[axis]) / volume.spacing[axis])
  const along = ({ source, sign }: Volume['axes']['x']) => sign * grid[source]
  return [along(volume.axes.x), along(volume.axes.y), along(volume.axes.z)]
}

// The grid voxel at a place along the scene's axes, whole, or none outside the grid
function voxelAt(volume: Volume, scene: Triple): number | null {
  const grid = [0, 0, 0]
  const { x, y, z } = volume.axes
  for (const [axis, value] of [
    [x, scene[0]],
    [y, scene[1]],
    [z, scene[2]],
  ] as const) {
    grid[axis.source] = Math.round(axis.sign * value)
  }
  const [i, j, k] = grid
  const [nx, ny, nz] = volume.size
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return null
  return cellIndex(volume.size, i, j, k)
}

// The scene's millimetres per voxel along each scene axis
function sceneSpacing(volume: Volume): Triple {
  const { x, y, z } = volume.axes
  return [volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source]]
}

// The grid's extent along the scene's axes, in whole voxels
function sceneExtent(volume: Volume) {
  const [nx, ny, nz] = volume.size
  const corner = sceneVoxel(volume, [
    volume.origin[0] + (nx - 1) * volume.spacing[0],
    volume.origin[1] + (ny - 1) * volume.spacing[1],
    volume.origin[2] + (nz - 1) * volume.spacing[2],
  ])
  const low = corner.map((value) => Math.min(0, Math.round(value)))
  const high = corner.map((value) => Math.max(0, Math.round(value)))
  return { low, high }
}

// The density's grey for a pixel: the bone bright, the soft tissue faint, the body's outline a dark blue over black
function densityGrey(density: number, body: boolean): Rgb {
  if (!body) return [0, 0, 0]
  const grey = density < 60 ? 0 : Math.min(255, Math.round(((density - 60) / 100) * 255))
  return [grey, grey, Math.max(grey, 40)]
}

// A voxel's colour as photographed, with the CT's bone tinted cyan, or black outside the body
function tissueColour(volume: Volume, index: number | null): Rgb {
  if (index === null || !isBodyVoxel(volume.coverage[index])) return [0, 0, 0]
  const { red, green, blue, density } = volume
  if (density && density[index] >= boneDensity) {
    return [Math.round(red[index] * 0.45), Math.min(255, green[index] + 70), Math.min(255, blue[index] + 120)]
  }
  return [red[index], green[index], blue[index]]
}

// A view of the scene: which scene axis runs across the image, to the right, which runs up it, and which the view
// looks along, from the side it's seen from
interface View {
  right: 0 | 1 | 2
  rightSign: 1 | -1
  up: 0 | 1 | 2
  depth: 0 | 1 | 2
}
const front: View = { right: 0, rightSign: 1, up: 1, depth: 2 }
const side: View = { right: 2, rightSign: 1, up: 1, depth: 0 }
// From above, the front at the bottom of the image
const above: View = { right: 0, rightSign: 1, up: 2, depth: 1 }

// The colours the skeleton is drawn in: the bones, the joints, and a frame's x, y and z
const boneStroke = '#ffb000'
const jointStroke = '#ff3df0'
const axisStrokes = ['#ff4040', '#40ff40', '#4080ff'] as const
// How long a joint's drawn axes are, in millimetres
const axisMm = 40

// The rig's joints along the scene's axes, in voxels, and each joint's frame in the scan
function rigInScene(volume: Volume, rig: Rig) {
  const joints = byJoint((name) => sceneVoxel(volume, rig.joints[name].at))
  const frames = scanFrames(rig, volume.axes)
  const spacing = sceneSpacing(volume)
  // A frame's axes as offsets in voxels along the scene's axes, axisMm long
  const axesOf = (name: JointName) =>
    [0, 1, 2].map((axis) => {
      const turned = new Vector3(axis === 0 ? axisMm : 0, axis === 1 ? axisMm : 0, axis === 2 ? axisMm : 0).applyQuaternion(frames[name])
      return [turned.x / spacing[0], turned.y / spacing[1], turned.z / spacing[2]] as Triple
    })
  return { joints, axesOf, spacing }
}

// The skeleton drawn over a view as SVG: each bone a line from its joint to the next, or to its end; each joint a ring,
// a ball joint's at its head's radius; and each limb joint's frame as three short axes, so its twist can be judged. A
// joint's place in the image is given by toImage, from scene voxels to pixels
function skeletonSvg(volume: Volume, rig: Rig, view: View, toImage: (scene: Triple) => [number, number], only?: (joint: JointName) => boolean) {
  const { joints, axesOf, spacing } = rigInScene(volume, rig)
  const parts: string[] = []
  const drawn = (name: JointName) => !only || only(name)
  for (const name of jointNames) {
    if (!drawn(name)) continue
    const [x1, y1] = toImage(joints[name])
    const [x2, y2] = toImage(sceneVoxel(volume, boneEnd(rig, name)))
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${boneStroke}" stroke-width="2" stroke-opacity="0.8"/>`)
  }
  for (const name of jointNames) {
    if (!drawn(name)) continue
    const at = joints[name]
    const [x, y] = toImage(at)
    if (skeletonShape[name].lie !== 'scanned') {
      axesOf(name).forEach((offset, axis) => {
        const [ax, ay] = toImage([at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]])
        parts.push(`<line x1="${x}" y1="${y}" x2="${ax}" y2="${ay}" stroke="${axisStrokes[axis]}" stroke-width="2"/>`)
      })
    }
    const { ball } = rig.joints[name]
    if (ball) {
      // The ball's radius in pixels, as toImage scales the view's across axis
      const across: [number, number, number] = [at[0], at[1], at[2]]
      across[view.right] += ball / spacing[view.right]
      const [bx, by] = toImage(across)
      parts.push(`<circle cx="${x}" cy="${y}" r="${Math.hypot(bx - x, by - y)}" fill="none" stroke="${jointStroke}" stroke-width="1.5"/>`)
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="${jointStroke}" stroke-width="2"/>`)
  }
  return parts.join('')
}

async function writeOverlaid(path: string, width: number, height: number, data: Uint8Array, svg: string) {
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`
  const bytes = await sharp(data, { raw: { width, height, channels: 3 } })
    .composite([{ input: Buffer.from(overlay) }])
    .png()
    .toBuffer()
  await writeWhole(path, bytes)
}

// The bone through the whole body along a view, at one pixel per voxel: the densest voxel along each line of sight,
// within the scene's x from xFrom to xTo for a side view, so that each side's limbs show without the other's
function boneProjection(volume: Volume, view: View, across?: readonly [number, number]) {
  const { low, high } = sceneExtent(volume)
  const width = high[view.right] - low[view.right] + 1
  const height = high[view.up] - low[view.up] + 1
  const data = new Uint8Array(width * height * 3)
  const scene: [number, number, number] = [0, 0, 0]
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      scene[view.right] = view.rightSign > 0 ? low[view.right] + column : high[view.right] - column
      scene[view.up] = high[view.up] - row
      let densest = 0
      let body = false
      for (let depth = low[view.depth]; depth <= high[view.depth]; depth++) {
        if (across && (depth < across[0] || depth > across[1])) continue
        scene[view.depth] = depth
        const index = voxelAt(volume, scene)
        if (index === null || !isBodyVoxel(volume.coverage[index])) continue
        body = true
        densest = Math.max(densest, volume.density?.[index] ?? 0)
      }
      const rgb = densityGrey(densest, body)
      data.set(rgb, (row * width + column) * 3)
    }
  }
  const toImage = (at: Triple): [number, number] => [
    view.rightSign > 0 ? at[view.right] - low[view.right] : high[view.right] - at[view.right],
    high[view.up] - at[view.up],
  ]
  return { width, height, data, toImage }
}

// The close-up sheet: a row for each joint, of five panels about it, each ±halfMm across. The first three cut through
// the joint in colour: from the front, from the side and from above; the last two look through a slab ±slabMm
// either side of it at the bone, from the front and from the side. The joint is a cross; the skeleton's lines and
// rings show where they pass close by
const halfMm = 50
const slabMm = 12
const panelPixels = 150
const labelPixels = 16
const gapPixels = 4

async function jointSheet(volume: Volume, rig: Rig, path: string) {
  const { joints } = rigInScene(volume, rig)
  const spacing = sceneSpacing(volume)
  const panels = [
    { view: front, slab: false, title: 'front' },
    { view: side, slab: false, title: 'side' },
    { view: above, slab: false, title: 'above' },
    { view: front, slab: true, title: `front ±${slabMm}` },
    { view: side, slab: true, title: `side ±${slabMm}` },
  ]
  const rowHeight = panelPixels + labelPixels + gapPixels
  const width = panels.length * (panelPixels + gapPixels)
  const height = jointNames.length * rowHeight
  const data = new Uint8Array(width * height * 3).fill(40)
  const svg: string[] = []
  jointNames.forEach((name, row) => {
    const at = joints[name]
    const top = row * rowHeight + labelPixels
    svg.push(`<text x="2" y="${row * rowHeight + 12}" font-family="Menlo, Consolas, monospace" font-size="11" fill="#ffffff">${name}</text>`)
    panels.forEach(({ view, slab, title }, column) => {
      const left = column * (panelPixels + gapPixels)
      if (column > 0) {
        svg.push(`<text x="${left + 2}" y="${row * rowHeight + 12}" font-family="Menlo, Consolas, monospace" font-size="10" fill="#c0c0c0">${title}</text>`)
      }
      // Millimetres per pixel across the panel, the same along both of its axes
      const mmPerPixel = (2 * halfMm) / panelPixels
      const scene: [number, number, number] = [0, 0, 0]
      for (let y = 0; y < panelPixels; y++) {
        for (let x = 0; x < panelPixels; x++) {
          const acrossMm = (x + 0.5) * mmPerPixel - halfMm
          const upMm = halfMm - (y + 0.5) * mmPerPixel
          scene[view.right] = at[view.right] + (view.rightSign * acrossMm) / spacing[view.right]
          // From above, up the image is toward the back, which is −z
          scene[view.up] = at[view.up] + (view === above ? -upMm : upMm) / spacing[view.up]
          let rgb: Rgb
          if (!slab) {
            scene[view.depth] = at[view.depth]
            rgb = tissueColour(volume, voxelAt(volume, scene))
          } else {
            let densest = 0
            let body = false
            const reach = Math.round(slabMm / spacing[view.depth])
            for (let step = -reach; step <= reach; step++) {
              scene[view.depth] = Math.round(at[view.depth]) + step
              const index = voxelAt(volume, scene)
              if (index === null || !isBodyVoxel(volume.coverage[index])) continue
              body = true
              densest = Math.max(densest, volume.density?.[index] ?? 0)
            }
            rgb = densityGrey(densest, body)
          }
          data.set(rgb, ((top + y) * width + left + x) * 3)
        }
      }
      // The skeleton near this joint, clipped to the panel
      const toImage = (point: Triple): [number, number] => {
        const acrossMm = ((point[view.right] - at[view.right]) * spacing[view.right]) / view.rightSign
        const upMm = (point[view.up] - at[view.up]) * spacing[view.up] * (view === above ? -1 : 1)
        return [left + (acrossMm + halfMm) / mmPerPixel, top + (halfMm - upMm) / mmPerPixel]
      }
      svg.push(`<svg x="${left}" y="${top}" width="${panelPixels}" height="${panelPixels}" overflow="hidden"><g transform="translate(${-left} ${-top})">`)
      svg.push(skeletonSvg(volume, rig, view, toImage))
      svg.push('</g></svg>')
      const [cx, cy] = toImage(at)
      svg.push(`<line x1="${cx - 9}" y1="${cy}" x2="${cx + 9}" y2="${cy}" stroke="#ffffff" stroke-width="1.5"/>`)
      svg.push(`<line x1="${cx}" y1="${cy - 9}" x2="${cx}" y2="${cy + 9}" stroke="#ffffff" stroke-width="1.5"/>`)
    })
  })
  await writeOverlaid(path, width, height, data, svg.join(''))
}

// The chains on the finer grid, in slices across the body from above at the heights given, in millimetres along the
// slices: the photographs' colour tinted by each voxel's chain, the trunk left as it is, each arm and each leg its
// own tint, the joined flesh paler, and every voxel that faces another chain across a wall in white. A slice may be
// cropped to a box across the body, in millimetres, and drawn larger, to judge a wall against the gel beside it
const chainTints: readonly (Rgb | null)[] = [null, [255, 60, 60], [60, 255, 60], [80, 120, 255], [255, 200, 40]]

export interface ChainSlice {
  // The slice's height along the slices, and an optional crop across the body, from and to along the image's columns
  // and rows, in the source frame's millimetres
  mm: number
  crop?: { columns: readonly [number, number]; rows: readonly [number, number] }
}

export async function drawChainPreview(volume: Volume, chain: Uint8Array, joined: Uint8Array, slices: readonly ChainSlice[], path: string, scale = 1, columns = 4) {
  const { size, spacing, origin } = volume
  const [nx, ny] = size
  const label = 14
  const index = (mm: number, axis: number) => Math.max(0, Math.min(size[axis] - 1, Math.round((mm - origin[axis]) / spacing[axis])))
  const boxes = slices.map(({ crop }) => ({
    i0: crop ? index(crop.columns[0], 0) : 0,
    i1: crop ? index(crop.columns[1], 0) : nx - 1,
    j0: crop ? index(crop.rows[0], 1) : 0,
    j1: crop ? index(crop.rows[1], 1) : ny - 1,
  }))
  const cellWidth = Math.max(...boxes.map((box) => (box.i1 - box.i0 + 1) * scale))
  const cellHeight = Math.max(...boxes.map((box) => (box.j1 - box.j0 + 1) * scale))
  const rows = Math.ceil(slices.length / columns)
  const width = columns * (cellWidth + gapPixels)
  const height = rows * (cellHeight + label + gapPixels)
  const data = new Uint8Array(width * height * 3).fill(30)
  const svg: string[] = []
  slices.forEach(({ mm }, slot) => {
    const k = index(mm, 2)
    const { i0, i1, j0, j1 } = boxes[slot]
    const left = (slot % columns) * (cellWidth + gapPixels)
    const top = Math.floor(slot / columns) * (cellHeight + label + gapPixels)
    svg.push(`<text x="${left + 2}" y="${top + 11}" font-family="Menlo, Consolas, monospace" font-size="10" fill="#ffffff">${mm} mm</text>`)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const n = i + nx * (j + ny * k)
        let rgb: Rgb = tissueColour(volume, n)
        const own = chain[n]
        if (own !== 255) {
          const tint = chainTints[own]
          const mix = (joined[n] !== 0 ? 0.25 : 0.45) / Math.sqrt(scale)
          if (tint) rgb = [rgb[0] * (1 - mix) + tint[0] * mix, rgb[1] * (1 - mix) + tint[1] * mix, rgb[2] * (1 - mix) + tint[2] * mix]
          // A voxel facing another chain across a wall
          const faces = [i > 0 ? n - 1 : -1, i < nx - 1 ? n + 1 : -1, j > 0 ? n - nx : -1, j < ny - 1 ? n + nx : -1]
          if (faces.some((m) => m >= 0 && isParted(chain, joined, n, m))) rgb = [255, 255, 255]
        } else if (!isBodyVoxel(volume.coverage[n]) && volume.coverage[n] > 0) {
          // Partly body, as the gel's line is: drawn in the blue of the gel, by how much
          const share = volume.coverage[n] / 127
          rgb = [20, 40 + 60 * share, 90 + 120 * share]
        }
        const pixel = rgb.map(Math.round)
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            data.set(pixel, ((top + label + (j - j0) * scale + dy) * width + left + (i - i0) * scale + dx) * 3)
          }
        }
      }
    }
  })
  await writeOverlaid(path, width, height, data, svg.join(''))
}

// Draws the previews into the folder and returns their paths: the body from the front with the whole skeleton, from
// its right with its right limbs and from its left with its left limbs, each side seen through its own half of the
// body, and the close-up sheet
export async function drawRigPreviews(volume: Volume, rig: Rig, folder = rigPreviewFolder): Promise<string[]> {
  const paths: string[] = []
  const name = (view: string) => join(folder, `${rig.body}-${view}.png`)

  const frontal = boneProjection(volume, front)
  await writeOverlaid(name('front'), frontal.width, frontal.height, frontal.data, skeletonSvg(volume, rig, front, frontal.toImage))
  paths.push(name('front'))

  // The body's halves divide at the hips' joint across the body. Seen from its right, the body's front is on the
  // image's right, and seen from its left, on the image's left
  const middle = sceneVoxel(volume, rig.joints.hips.at)[0]
  const { low, high } = sceneExtent(volume)
  const sides = [
    { side: 'right', view: side, across: [low[0], middle] as const },
    { side: 'left', view: { ...side, rightSign: -1 } as const, across: [middle, high[0]] as const },
  ] as const
  for (const { side: which, view, across } of sides) {
    const projection = boneProjection(volume, view, across)
    const other = which === 'right' ? 'left' : 'right'
    const svg = skeletonSvg(volume, rig, view, projection.toImage, (joint) => !joint.startsWith(other))
    await writeOverlaid(name(which), projection.width, projection.height, projection.data, svg)
    paths.push(name(which))
  }

  await jointSheet(volume, rig, name('joints'))
  paths.push(name('joints'))
  return paths
}
