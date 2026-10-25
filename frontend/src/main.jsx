import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initTheme } from './services/theme'
import { reloadOnceForStaleChunk } from './services/reloadGuard'

// Thema anwenden (index.html hat es schon vor dem ersten Bild gesetzt) und auf
// Wechsel des Betriebssystems hören. Speichert nichts — siehe services/theme.js.
initTheme()

// Nach einem Update (neuer Build → neue Hash-Dateinamen) kann ein alter offener Tab ein
// gelöschtes Lazy-Asset nicht mehr laden → Vite feuert 'vite:preloadError'. Einmal hart
// neu laden holt die frische Version (Guard verhindert eine Reload-Schleife).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnceForStaleChunk()
})

// Register the service worker for web-push (PWA). Best-effort.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
