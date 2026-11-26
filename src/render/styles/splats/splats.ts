import { AdditiveBlending, Group, type BufferGeometry } from 'three'
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { createGaussianSplatGeometry, writeCovariance } from 'three/addons/utils/GaussianSplatUtils.js'
import type { Volume } from '../../../volume/format.ts'
import { levelOf, type Detail, type Level } from '../../../volume/levels.ts'
import type { DepthCue } from '../../depthCue.ts'
import type { Blend } from '../../look.ts'
import { whenFirstDrawn, type StyleContext, type StyleDrawing } from '../style.ts'
import { isSorted } from './blend.ts'
import { cellColor, createCellTable, isPainted, paintCellTable, writeCellIndex, type CellTable } from './cellTable.ts'
import { freeSplatBuffers } from './threeSplat.ts'

// The Splats style: the body as one round Gaussian per cell of the level Detail asks for. Each level's splat is built
// the first time it's shown and kept, hidden while another is shown, until Size, Blend or the volume changes or the
// style goes. Opacity and the cuts repaint the shown level's table, and rebuild nothing, nor does a level built after
// the body first draws

// A round splat's standard deviation, as a share of its level's spacing, at Size 1. three draws a splat out to two of
// them, so its edge reaches one spacing from its centre and overlaps its neighbours', and the body reads as solid
const sigmaPerSpacing = 0.5

// A level's splat, the source geometry it was built from, and its cell table
interface BuiltLevel {
  splat: GaussianSplat
  geometry: BufferGeometry
  table: CellTable
}

// What every level built so far was built at
interface BuiltAt {
  volume: Volume
  size: number
  blend: Blend
}

// One round splat per cell of a level, at the cell's centre, with its colour bytes carrying the cell's index into the
// level's cell table, which holds its colour and its alpha, blended as Blend asks
function buildLevel(level: Level, size: number, blend: Blend, cue: DepthCue): BuiltLevel {
  const { count, centers } = level
  const sigma = level.spacing * sigmaPerSpacing * size
  const covariances = new Float32Array(count * 6)
  const colors = new Uint8ClampedArray(count * 4)
  for (let n = 0; n < count; n++) {
    writeCovariance(covariances, n * 6, sigma, sigma, sigma, 0, 0, 0, 1)
    writeCellIndex(colors, n * 4, n)
  }
  const geometry = createGaussianSplatGeometry(centers, covariances, colors)
  const splat = new GaussianSplat(geometry, { autoSort: isSorted(blend) })
  const table = createCellTable(level)
  splat.material.colorNode = cellColor(table, cue)
  // The glow adds each splat's colour, scaled by its alpha, to what's behind, so the body brightens where splats pile up
  if (!isSorted(blend)) splat.material.blending = AdditiveBlending
  // A weighted splat adds its colour and its alpha into the sums the frame's composite resolves, so it writes its
  // colour already multiplied by its alpha, and the blend adds both as they are
  if (blend === 'weighted') splat.material.premultipliedAlpha = true
  return { splat, geometry, table }
}

export function createSplats({ renderer, camera, webgpu, cue, events }: StyleContext): StyleDrawing {
  const group = new Group()
  const built = new Map<Detail, BuiltLevel>()
  let builtAt: BuiltAt | null = null

  // Frees every splat built. GaussianSplat has no dispose(), and its storage buffers and its sort's, with the textures
  // the WebGL 2 fallback reads them through, outlive it on the GPU unless they're freed here: five textures a splat,
  // 12 MB at the male's 8 mm Detail, were left behind by every change of style, Size, Blend or body
  const clear = () => {
    for (const { splat, geometry, table } of built.values()) {
      group.remove(splat)
      freeSplatBuffers(splat)
      splat.geometry.dispose()
      splat.material.dispose()
      geometry.dispose()
      table.texture.dispose()
    }
    built.clear()
    builtAt = null
  }

  return {
    object: group,
    update(body, look) {
      const { detail, size, blend, opacity } = look.splats
      if (builtAt && (builtAt.volume !== body?.volume || builtAt.size !== size || builtAt.blend !== blend)) clear()
      if (!body) return
      const { volume, bounds, levels } = body
      builtAt ??= { volume, size, blend }

      // A level shown for the first time is built here, then painted before any frame draws it; one built already
      // is shown again, and repainted only if what its table is painted from has changed since
      const source = levelOf(levels, detail)
      if (source && !built.has(detail)) {
        const level = buildLevel(source, size, blend, cue)
        whenFirstDrawn(level.splat, () => events.drawn(volume))
        group.add(level.splat)
        // On the WebGL 2 fallback, only a sort moves the splat's data into the textures its shader reads, and the
        // shader is built for one or the other on its first draw, so an unsorted splat sorts once now, before it's
        // ever drawn. On WebGPU its draw order starts as every splat in turn
        if (!isSorted(blend) && !webgpu) level.splat.updateSort(renderer, camera)
        built.set(detail, level)
      }
      for (const [each, { splat }] of built) splat.visible = each === detail

      const shown = built.get(detail)
      const paint = { opacity, cuts: look.cuts }
      if (shown && source && !isPainted(shown.table, paint)) paintCellTable(shown.table, source, bounds.half, paint)
    },
    dispose: clear,
  }
}
