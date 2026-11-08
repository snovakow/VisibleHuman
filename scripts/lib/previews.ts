// The previews the volume script draws of a volume, through the volume's own scene axes so they show the body as the
// app will: the body from the front, the mid-coronal and mid-sagittal planes in colour, and the mid-coronal plane's
// density in grey. Each view looks along one scene axis (0 x, 1 y, 2 z): right and up are the scene axes across the
// image, with right's sign, and toward is the side the view looks from. A plane view shows the voxels in the middle
// of the grid along that axis; otherwise each line of sight shows its nearest body voxel

import { join } from 'node:path'
import { cellIndex, isBodyVoxel, sceneCell, type Volume } from '../../src/volume/format2.ts'
import { writePng } from './decode.ts'

export const previewFolder = '.cache/preview'
// Each voxel is drawn as a square of this many pixels
const previewScale = 2

interface PreviewView {
  file: string
  right: 0 | 1 | 2
  rightSign: 1 | -1
  up: 0 | 1 | 2
  toward: 0 | 1 | 2
  towardSign: 1 | -1
  plane: boolean
  // Drawn from the density block in grey rather than the colour
  density: boolean
}

const previewViews: readonly PreviewView[] = [
  // From the front, which faces +z: the body's left (+x) on the right
  { file: 'front.png', right: 0, rightSign: 1, up: 1, toward: 2, towardSign: 1, plane: false, density: false },
  { file: 'coronal.png', right: 0, rightSign: 1, up: 1, toward: 2, towardSign: 1, plane: true, density: false },
  // From the body's right (−x): the front (+z) on the right
  { file: 'sagittal.png', right: 2, rightSign: 1, up: 1, toward: 0, towardSign: -1, plane: true, density: false },
  { file: 'density.png', right: 0, rightSign: 1, up: 1, toward: 2, towardSign: 1, plane: true, density: true },
]

// Draws the previews into the folder and returns their paths
export async function drawPreviews(volume: Volume, folder = previewFolder) {
  const [sx, sy, sz] = volume.size
  // The grid's bounds along the scene's axes, in whole voxels
  const corner = sceneCell(volume, sx - 1, sy - 1, sz - 1)
  const low = [0, 1, 2].map((axis) => Math.min(0, corner[axis]))
  const high = [0, 1, 2].map((axis) => Math.max(0, corner[axis]))
  const paths: string[] = []

  for (const view of previewViews) {
    const rightLow = view.rightSign > 0 ? low[view.right] : -high[view.right]
    const width = high[view.right] - low[view.right] + 1
    const height = high[view.up] - low[view.up] + 1
    const middle = Math.floor((low[view.toward] + high[view.toward]) / 2)
    const nearest = new Float64Array(width * height).fill(-Infinity)
    const channels = view.density ? 1 : 3
    const imageWidth = width * previewScale
    // Black where no body is drawn
    const data = new Uint8Array(imageWidth * height * previewScale * channels)

    for (let k = 0; k < sz; k++) {
      for (let j = 0; j < sy; j++) {
        for (let i = 0; i < sx; i++) {
          const index = cellIndex(volume.size, i, j, k)
          if (!isBodyVoxel(volume.coverage[index])) continue
          const at = sceneCell(volume, i, j, k)
          if (view.plane && at[view.toward] !== middle) continue
          const u = at[view.right] * view.rightSign - rightLow
          const v = high[view.up] - at[view.up]
          const depth = at[view.toward] * view.towardSign
          if (depth <= nearest[u + width * v]) continue
          nearest[u + width * v] = depth
          for (let dy = 0; dy < previewScale; dy++) {
            for (let dx = 0; dx < previewScale; dx++) {
              const offset = ((v * previewScale + dy) * imageWidth + u * previewScale + dx) * channels
              if (view.density) {
                data[offset] = volume.density?.[index] ?? 0
              } else {
                data[offset] = volume.red[index]
                data[offset + 1] = volume.green[index]
                data[offset + 2] = volume.blue[index]
              }
            }
          }
        }
      }
    }
    const path = join(folder, view.file)
    await writePng(path, { width: imageWidth, height: height * previewScale, channels, data })
    paths.push(path)
  }
  return paths
}
