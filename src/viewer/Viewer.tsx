import { OrbitControls, Stats } from '@react-three/drei'
import { useRef, type ComponentRef, type ComponentType } from 'react'
import { useStore } from '../store.ts'
import { BodyRaytrace } from './BodyRaytrace.tsx'
import { BodySplats } from './BodySplats.tsx'
import { BodyVolume } from './BodyVolume.tsx'
import { Framing } from './Framing.tsx'
import type { Style } from './styles.ts'

// The body drawn in each style that has one: the surface style has no component yet, so it draws nothing
const bodies: Partial<Record<Style, ComponentType>> = { splats: BodySplats, volume: BodyVolume, raytrace: BodyRaytrace }

// The scene: the controls, the frame counter, the framing of a loaded body, and the body drawn in the one style the
// panel has chosen
export function Viewer() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const style = useStore((s) => s.options.style)
  const Body = bodies[style]
  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} />
      {Body ? <Body /> : null}
    </>
  )
}
