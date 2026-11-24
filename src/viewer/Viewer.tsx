import { OrbitControls, Stats } from '@react-three/drei'
import { useRef, type ComponentRef } from 'react'
import { Framing } from './Framing.tsx'
import { StageHost } from './StageHost.tsx'
import { Sway } from './Sway.tsx'
import type { ViewAngle } from './viewAngle.ts'

// What the Canvas holds: the controls, the frame counter, the framing of a loaded body from the view angle given, the
// sway, and the stage, which draws the body. The view is React's to move; everything drawn is the stage's
export function Viewer({ view }: { view: ViewAngle }) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)

  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} view={view} />
      <Sway controlsRef={controlsRef} />
      <StageHost />
    </>
  )
}
