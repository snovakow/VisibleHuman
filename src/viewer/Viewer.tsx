import { OrbitControls, Stats } from '@react-three/drei'
import { TestCloud } from './TestCloud.tsx'

export function Viewer() {
  return (
    <>
      <OrbitControls makeDefault />
      <Stats />
      <TestCloud />
    </>
  )
}
