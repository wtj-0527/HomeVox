import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { parseProjectAccessFragment, storeInitialProjectAccess } from './projectAccess'

// Keep the fragment until metadata and source image both load successfully.
// The controller clears it only after it has retained the private capability.
storeInitialProjectAccess(parseProjectAccessFragment(window.location.hash))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
		<App />
  </StrictMode>,
)
