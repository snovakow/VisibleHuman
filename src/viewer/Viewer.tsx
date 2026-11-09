import { OrbitControls, Stats } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type ComponentRef, type ComponentType } from 'react'
import type { PointLight } from 'three'
import { useStore } from '../store.ts'
import { BodyRaytrace } from './BodyRaytrace.tsx'
import { BodySplats } from './BodySplats.tsx'
import { BodySurface } from './BodySurface.tsx'
import { BodyVolume } from './BodyVolume.tsx'
import { CutCaps } from './CutCaps.tsx'
import { Framing } from './Framing.tsx'
import type { Style } from './styles.ts'

// The body drawn in each style
const bodies: Record<Style, ComponentType> = { splats: BodySplats, volume: BodyVolume, raytrace: BodyRaytrace, surface: BodySurface }

// The scene: the controls, the frame counter, the framing of a loaded body, the lights the surface style's meshes
// are lit by, and the body drawn in the one style the panel has chosen, with the caps on its cuts for the surface
export function Viewer() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const style = useStore((s) => s.options.style)
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
      <Body />
      {style === 'surface' ? <CutCaps /> : null}
    </>
  )
}
