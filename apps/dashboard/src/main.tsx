// Browser entry point: mount the dashboard App into #root with React 18's
// concurrent root. StrictMode is on to surface effect/lifecycle issues in dev.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (container === null) throw new Error('missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
