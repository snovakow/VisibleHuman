import { OrbitControls, Stats } from '@react-three/drei'
import { useRef, type ComponentRef } from 'react'
import { useStore } from '../store.ts'
import { BodySplats } from './BodySplats.tsx'
import { BodyVolume } from './BodyVolume.tsx'
import { Framing } from './Framing.tsx'

// The scene: the controls, the frame counter, the framing of a loaded body, and the body drawn in the one style the
// panel has chosen. The raytrace and surface styles have no component yet, so they draw nothing
export function Viewer() {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const style = useStore((s) => s.options.style)
  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} />
      {style === 'splats' ? <BodySplats /> : style === 'volume' ? <BodyVolume /> : null}
    </>
  )
}
