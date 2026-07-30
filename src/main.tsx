import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/archivo'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@xyflow/react/dist/style.css'

import App from './App'
import './index.css'

if (import.meta.env.PROD) {
  void navigator.serviceWorker?.register('/sw.js')
}

const root = document.querySelector<HTMLDivElement>('#root')

if (!root) {
  throw new Error('无法找到应用挂载节点。')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
