import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * A trivial mock of the Help page's "Save preferences" endpoint (request-evidence
 * proof fixture) — always replies 204, so a live Tier-3 drive gets a real network
 * response to witness instead of a 404 from the plain dev server.
 */
function mockSavePreferencesApi(): Plugin {
  return {
    name: 'mock-save-preferences-api',
    configureServer(server) {
      server.middlewares.use('/api/save-preferences', (req, res) => {
        res.statusCode = 204
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), mockSavePreferencesApi()],
  // Pin the dev port to match playwright.config.ts's baseURL default (5187) so a
  // plain `pnpm dev` is drivable by the gate's --app-url without extra flags.
  server: { port: 5187 },
})
