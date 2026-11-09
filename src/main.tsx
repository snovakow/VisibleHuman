import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PanelRoot } from './Panel.tsx'

// The panel's root renders before and outside StrictMode, for the reasons PanelRoot gives
createRoot(document.getElementById('root')!).render(
  <>
    <PanelRoot />
    <StrictMode>
      <App />
    </StrictMode>
  </>,
)
