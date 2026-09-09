import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { registerServiceWorker, unregisterServiceWorker } from './serviceWorker'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if (import.meta.env.PROD) {
  registerServiceWorker()
} else {
  // In development, unregister service workers to avoid caching/fetch oddities while iterating
  unregisterServiceWorker()
}
