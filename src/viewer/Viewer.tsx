import { OrbitControls, Stats } from '@react-three/drei'
import { useCallback, useRef, type ComponentRef } from 'react'
import type { Stage } from '../render/stage.ts'
import { Framing } from './Framing.tsx'
import { Handles } from './Handles.tsx'
import { StageHost } from './StageHost.tsx'
import { Sway } from './Sway.tsx'
import type { ViewAngle } from './viewAngle.ts'

// What the Canvas holds: the controls, the frame counter, the framing of a loaded body from the view angle given, the
// sway, the stage, which draws the body, and the handles that pose it, which drag what the stage draws. The view is
// React's to move; everything drawn is the stage's
export function Viewer({ view }: { view: ViewAngle }) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const stage = useRef<Stage>(null)
  const onStage = useCallback((made: Stage | null) => {
    stage.current = made
  }, [])

  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault />
      <Stats />
      <Framing controlsRef={controlsRef} view={view} />
      <Sway controlsRef={controlsRef} />
      <StageHost onStage={onStage} />
      <Handles stage={stage} controlsRef={controlsRef} />
    </>
  )
}
