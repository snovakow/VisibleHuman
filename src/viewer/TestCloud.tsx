import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { createGaussianSplatGeometry, writeColorBytes, writeCovariance } from 'three/addons/utils/GaussianSplatUtils.js'

// A temporary cloud that proves the splat pipeline before any body data: a few thousand round splats of varied size,
// colour and alpha, filling a box about the body's size, in millimetres, centred on the origin. Phase 5 replaces it
const count = 5000
const halfExtents = { x: 250, y: 900, z: 150 } as const
// A splat's scale is its standard deviation; three draws it out to two of them
const minSigma = 6
const maxSigma = 24
const minAlpha = 0.6

// A seeded generator (mulberry32), so every mount, StrictMode's second included, builds the same cloud
function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function TestCloud() {
  const get = useThree((s) => s.get)

  useEffect(() => {
    const random = seededRandom(1)
    const centers = new Float32Array(count * 3)
    const covariances = new Float32Array(count * 6)
    const colors = new Uint8ClampedArray(count * 4)
    for (let i = 0; i < count; i++) {
      // Position in the box, as fractions first, which also colour the splat: red across, green up, blue forwards
      const fx = random()
      const fy = random()
      const fz = random()
      centers[i * 3] = (fx * 2 - 1) * halfExtents.x
      centers[i * 3 + 1] = (fy * 2 - 1) * halfExtents.y
      centers[i * 3 + 2] = (fz * 2 - 1) * halfExtents.z
      const sigma = minSigma + random() * (maxSigma - minSigma)
      writeCovariance(covariances, i * 6, sigma, sigma, sigma, 0, 0, 0, 1)
      const alpha = minAlpha + random() * (1 - minAlpha)
      writeColorBytes(colors, i * 4, 64 + fx * 191, 64 + fy * 191, 64 + fz * 191, alpha * 255)
    }

    const { scene } = get()
    const geometry = createGaussianSplatGeometry(centers, covariances, colors)
    const splat = new GaussianSplat(geometry, { autoSort: true })
    scene.add(splat)

    // GaussianSplat has no dispose(): its storage buffers go when it's garbage-collected, so nothing keeps it
    return () => {
      scene.remove(splat)
      splat.geometry.dispose()
      splat.material.dispose()
      geometry.dispose()
    }
  }, [get])

  return null
}
