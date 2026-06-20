import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,   // WebSocket-Live-Kanal (/api/autofarm/ws) im Dev durchreichen
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // hls.js wird bei Bedarf als eigener Chunk geladen — die ~525 kB sind gewollt.
    chunkSizeWarningLimit: 1000,
  },
})
