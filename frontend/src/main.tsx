import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { consumeProjectAccessFragment, storeInitialProjectAccess } from './projectAccess'

storeInitialProjectAccess(consumeProjectAccessFragment(
  window.location,
  (path) => window.history.replaceState(null, '', path),
))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
		<App />
  </StrictMode>,
)
