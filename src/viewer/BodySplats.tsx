import { useThree } from '@react-three/fiber'
import { useEffect, useEffectEvent, useRef } from 'react'
import { AdditiveBlending, type BufferGeometry } from 'three'
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { createGaussianSplatGeometry, writeCovariance } from 'three/addons/utils/GaussianSplatUtils.js'
import { useShallow } from 'zustand/react/shallow'
import type { Blend } from '../options.ts'
import { useStore } from '../store.ts'
import { levelOf, type Detail, type Level, type Levels } from '../volume/levels.ts'
import { cellColor, createCellTable, paintCellTable, writeCellIndex, type CellTable, type TablePaint } from './cellTable.ts'
import { reportFirstDraw } from './firstDraw.ts'
import { asWebGPU } from './renderer.ts'

// A round splat's standard deviation, as a share of its level's spacing, at Size 1. three draws a splat out to two of
// them, so its edge reaches one spacing from its centre and overlaps its neighbours', and the body reads as solid
const sigmaPerSpacing = 0.5

// A level's splat, the source geometry it was built from, and its cell table
interface BuiltLevel {
  splat: GaussianSplat
  geometry: BufferGeometry
  table: CellTable
}

// The levels built so far at one Size and Blend: show builds a level's splat the first time it's asked for and shows
// it alone, and paint repaints the shown level's table if what it's painted from has changed. Each takes the body's
// levels as the store has built them so far, which grow after the body first draws
interface Drawn {
  show: (detail: Detail, levels: Levels) => void
  paint: (detail: Detail, paint: TablePaint, levels: Levels) => void
}

// Whether a blend lays the splats over one another in order, back to front. Added light doesn't depend on the order
// it's drawn in, nor does a weighted sum, so neither is sorted as the camera moves
const isSorted = (blend: Blend) => blend === 'normal'

// One round splat per cell of a level, at the cell's centre, with its colour bytes carrying the cell's index into the
// level's cell table, which holds its colour and its alpha, blended as Blend asks
function buildLevel(level: Level, size: number, blend: Blend): BuiltLevel {
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
  splat.material.colorNode = cellColor(table)
  // The glow adds each splat's colour, scaled by its alpha, to what's behind, so the body brightens where splats pile up
  if (!isSorted(blend)) splat.material.blending = AdditiveBlending
  // A weighted splat adds its colour and its alpha into the sums the effects' composite resolves, so it writes its
  // colour already multiplied by its alpha, and the blend adds both as they are
  if (blend === 'weighted') splat.material.premultipliedAlpha = true
  return { splat, geometry, table }
}

// The body as splats, at the level Detail asks for. Each level's splat is built the first time it's shown and kept,
// hidden while another is shown, until Size, Blend or the volume changes or this unmounts. Opacity and the cuts
// repaint the shown level's table, and rebuild nothing, nor does a level built after the body first draws
export function BodySplats() {
  const get = useThree((s) => s.get)
  const volume = useStore((s) => s.volume)
  const levels = useStore((s) => s.levels)
  const bounds = useStore((s) => s.bounds)
  const detail = useStore((s) => s.options.detail)
  const size = useStore((s) => s.options.size)
  const blend = useStore((s) => s.options.blend)
  const paint = useStore(
    useShallow(
      (s): TablePaint => ({
        opacity: s.options.opacity,
        axial: s.options.axial,
        coronal: s.options.coronal,
        sagittal: s.options.sagittal,
      }),
    ),
  )
  const drawn = useRef<Drawn | null>(null)

  // Shows and paints the level Detail asks for, with the inputs as they stand, for the effect that builds the splats,
  // which then needn't depend on them
  const showNow = useEffectEvent((current: Drawn) => {
    if (!levels) return
    current.show(detail, levels)
    current.paint(detail, paint, levels)
  })

  // Owns every splat built at this Size and Blend, and frees them all when either or the volume changes or this
  // unmounts. GaussianSplat has no dispose(): its storage buffers go when it's garbage-collected, so nothing else
  // keeps a splat
  useEffect(() => {
    if (!volume || !bounds) return undefined
    const { scene, gl, camera } = get()
    const renderer = asWebGPU(gl)
    const fallback = !('isWebGPUBackend' in renderer.backend)
    const built = new Map<Detail, BuiltLevel>()
    const current: Drawn = {
      show: (shown, soFar) => {
        const source = levelOf(soFar, shown)
        if (source && !built.has(shown)) {
          const level = buildLevel(source, size, blend)
          reportFirstDraw(level.splat, volume)
          scene.add(level.splat)
          // On the WebGL 2 fallback, only a sort moves the splat's data into the textures its shader reads, and the
          // shader is built for one or the other on its first draw, so an unsorted splat sorts once now, before it's
          // ever drawn. On WebGPU its draw order starts as every splat in turn
          if (!isSorted(blend) && fallback) level.splat.updateSort(renderer, camera)
          built.set(shown, level)
        }
        for (const [d, { splat }] of built) splat.visible = d === shown
      },
      paint: (shown, inputs, soFar) => {
        const level = built.get(shown)
        const source = levelOf(soFar, shown)
        if (level && source && level.table.painted !== inputs) paintCellTable(level.table, source, bounds.half, inputs)
      },
    }
    showNow(current)
    drawn.current = current
    return () => {
      for (const { splat, geometry, table } of built.values()) {
        scene.remove(splat)
        splat.geometry.dispose()
        splat.material.dispose()
        geometry.dispose()
        table.texture.dispose()
      }
      built.clear()
      drawn.current = null
    }
  }, [get, volume, bounds, size, blend])

  // A level shown for the first time is built here, then painted before any frame draws it; one built already is
  // shown again, and repainted only if the table's inputs have changed since
  useEffect(() => {
    const current = drawn.current
    if (!current || !levels) return
    current.show(detail, levels)
    current.paint(detail, paint, levels)
  }, [detail, paint, levels])

  return null
}
