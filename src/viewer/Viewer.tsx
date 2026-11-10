import { OrbitControls, Stats } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef, type ComponentType } from 'react'
import type { PointLight } from 'three'
import { useStore } from '../store.ts'
import { BodyRaytrace } from './BodyRaytrace.tsx'
import { BodySplats } from './BodySplats.tsx'
import { BodySurface } from './BodySurface.tsx'
import { BodyVolume } from './BodyVolume.tsx'
import { CutCaps } from './CutCaps.tsx'
import { Effects } from './Effects.tsx'
import { Framing } from './Framing.tsx'
import { bodyHalf, useCueFog, useOptionUniform } from './shading.ts'
import { isOit, isWeighted, type Style } from './styles.ts'

// The body drawn in each style
const bodies: Record<Style, ComponentType> = { splats: BodySplats, volume: BodyVolume, raytrace: BodyRaytrace, surface: BodySurface }

// Copies the panel's shading options and the body's bounds into the shading's uniforms, in every style, and gives the
// surface the depth cue as fog on the scene: its materials take fog, and the splats and the ray quad apply the cue in
// their own colours, so the cue reaches the styles by two routes
function ShadingUniforms() {
  const bounds = useStore((s) => s.bounds)
  useOptionUniform('depthCue')
  useCueFog()

  // The bounds' half extents, which the cue's near and far are set by; none until a body loads
  useEffect(() => {
    if (bounds) bodyHalf.value.fromArray(bounds.half)
    else bodyHalf.value.set(0, 0, 0)
  }, [bounds])

  return null
}

// The scene: the controls, the frame counter, the framing of a loaded body, the lights the surface style's meshes
// are lit by, the shading's uniforms, the body drawn in the one style the panel has chosen, with the caps on its cuts
// for the surface, and the effects while one is on
export function Viewer() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const style = useStore((s) => s.options.style)
  // The pipeline renders the scene only while it has something to add: bloom, the weighted blend's sums and their
  // composite, or the sum of the surface's see-through layers. Otherwise R3F renders it directly, as it always has
  const effects = useStore((s) => s.options.bloom > 0 || isWeighted(s.options) || isOit(s.options))
  const headlight = useRef<PointLight>(null)
  const Body = bodies[style]

  // The headlight follows the camera, so the side in view is always lit
  useFrame(({ camera }) => {
    headlight.current?.position.copy(camera.position)
  })

  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} />
      <hemisphereLight args={['#ffffff', '#404040', 1]} />
      <pointLight ref={headlight} decay={0} intensity={2.2} />
      <ShadingUniforms />
      <Body />
      {style === 'surface' ? <CutCaps /> : null}
      {effects ? <Effects /> : null}
    </>
  )
}
