import { useThree } from '@react-three/fiber'
import { useEffect, useEffectEvent, useRef } from 'react'
import type { BufferGeometry } from 'three'
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { createGaussianSplatGeometry, writeCovariance } from 'three/addons/utils/GaussianSplatUtils.js'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store.ts'
import type { Detail, Level } from '../volume/levels.ts'
import { cellColor, createCellTable, paintCellTable, writeCellIndex, type CellTable, type TablePaint } from './cellTable.ts'

// A round splat's standard deviation, as a share of its level's spacing, at Size 1. three draws a splat out to two of
// them, so its edge reaches one spacing from its centre and overlaps its neighbours', and the body reads as solid
const sigmaPerSpacing = 0.5

// A level's splat, the source geometry it was built from, and its cell table
interface BuiltLevel {
  splat: GaussianSplat
  geometry: BufferGeometry
  table: CellTable
}

// The levels built so far at one Size: show builds a level's splat the first time it's asked for and shows it alone,
// and paint repaints the shown level's table if what it's painted from has changed
interface Drawn {
  show: (detail: Detail) => void
  paint: (detail: Detail, paint: TablePaint) => void
}

// One round splat per cell of a level, at the cell's centre, with its colour bytes carrying the cell's index into the
// level's cell table, which holds its colour and its alpha
function buildLevel(level: Level, size: number): BuiltLevel {
  const { count, centers } = level
  const sigma = level.spacing * sigmaPerSpacing * size
  const covariances = new Float32Array(count * 6)
  const colors = new Uint8ClampedArray(count * 4)
  for (let n = 0; n < count; n++) {
    writeCovariance(covariances, n * 6, sigma, sigma, sigma, 0, 0, 0, 1)
    writeCellIndex(colors, n * 4, n)
  }
  const geometry = createGaussianSplatGeometry(centers, covariances, colors)
  const splat = new GaussianSplat(geometry, { autoSort: true })
  const table = createCellTable(level)
  splat.material.colorNode = cellColor(table)
  return { splat, geometry, table }
}

// The body as splats, at the level Detail asks for. Each level's splat is built the first time it's shown and kept,
// hidden while another is shown, until Size or the volume changes or this unmounts. Opacity and the cuts repaint the
// shown level's table, and rebuild nothing
export function BodySplats() {
  const get = useThree((s) => s.get)
  const levels = useStore((s) => s.levels)
  const bounds = useStore((s) => s.bounds)
  const detail = useStore((s) => s.options.detail)
  const size = useStore((s) => s.options.size)
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
    current.show(detail)
    current.paint(detail, paint)
  })

  // Owns every splat built at this Size, and frees them all when Size or the volume changes or this unmounts.
  // GaussianSplat has no dispose(): its storage buffers go when it's garbage-collected, so nothing else keeps a splat
  useEffect(() => {
    if (!levels || !bounds) return undefined
    const { scene } = get()
    const built = new Map<Detail, BuiltLevel>()
    const current: Drawn = {
      show: (shown) => {
        if (!built.has(shown)) {
          const level = buildLevel(levels[shown], size)
          scene.add(level.splat)
          built.set(shown, level)
        }
        for (const [d, { splat }] of built) splat.visible = d === shown
      },
      paint: (shown, inputs) => {
        const level = built.get(shown)
        if (level && level.table.painted !== inputs) paintCellTable(level.table, levels[shown], bounds.half, inputs)
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
  }, [get, levels, bounds, size])

  // A level shown for the first time is built here, then painted before any frame draws it; one built already is
  // shown again, and repainted only if the table's inputs have changed since
  useEffect(() => {
    const current = drawn.current
    if (!current) return
    current.show(detail)
    current.paint(detail, paint)
  }, [detail, paint])

  return null
}
