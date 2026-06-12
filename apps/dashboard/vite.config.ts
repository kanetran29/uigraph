import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config for the uigraph dashboard. The dev server proxies /api to the
// local CLI API server (`uigraph serve`, default port 4317) so the browser can
// fetch the merged graph and POST overlay edits without CORS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4317',
        changeOrigin: true,
      },
    },
  },
})
