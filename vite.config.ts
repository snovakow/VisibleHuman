import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build runs from the site's visiblehuman/ folder
  base: '',
  build: {
    // three.js makes one large chunk, about 2 MB with its WebGPU build; it's one scene, so it isn't split
    chunkSizeWarningLimit: 2500,
  },
})
