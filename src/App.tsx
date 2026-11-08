import { Canvas } from '@react-three/fiber'
import { useCallback, useState } from 'react'
import { createRenderer } from './viewer/renderer.ts'
import { Viewer } from './viewer/Viewer.tsx'

// ?webgl in the page URL forces the WebGL 2 fallback
const webglRequested = new URLSearchParams(window.location.search).has('webgl')

// The body is measured in millimetres and is about 1,900 of them tall, so the camera starts far enough back to see
// all of it from the front
const camera = { fov: 50, near: 1, far: 20000, position: [0, 0, 2600] as const }

function App() {
  const [forceWebGL, setForceWebGL] = useState(webglRequested)
  // The Canvas's key follows the flag, so setting it mounts a new Canvas whose factory forces the fallback
  const gl = useCallback(
    ({ canvas }: { canvas: object }) => createRenderer(canvas, forceWebGL, () => setForceWebGL(true)),
    [forceWebGL],
  )

  return (
    <Canvas key={forceWebGL ? 'webgl' : 'webgpu'} gl={gl} camera={camera} flat>
      <Viewer />
    </Canvas>
  )
}

export default App
