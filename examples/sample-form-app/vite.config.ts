import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * A deterministic mock of the sign-up backend described in openapi.yaml. The
 * response is keyed off the submitted email so every decision-tree branch
 * (201 success / 400 server-reject / 409 taken / 429 rate-limited / 500 error)
 * is reproducible at runtime by a single input value — which is what lets the
 * uigraph Tier-3 verifier (and a human) drive each branch on demand.
 */
function mockSignupApi(): Plugin {
  return {
    name: 'mock-signup-api',
    configureServer(server) {
      server.middlewares.use('/api/signup', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          let email = ''
          try {
            email = (JSON.parse(raw || '{}').email ?? '').toLowerCase()
          } catch {
            email = ''
          }
          const reply = (status: number, body: unknown): void => {
            res.statusCode = status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(body))
          }
          if (email === 'bad@example.com') return reply(400, { errors: { email: 'rejected by server' } })
          if (email === 'taken@example.com') return reply(409, { error: 'email already registered' })
          if (email === 'boom@example.com') return reply(500, { error: 'internal error' })
          if (email === 'ratelimited@example.com') return reply(429, { error: 'too many attempts' })
          return reply(201, { userId: `u_${Math.abs(hash(email))}` })
        })
      })
    },
  }
}

/** Tiny stable string hash for a fake user id (no crypto needed). */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export default defineConfig({
  plugins: [react(), mockSignupApi()],
  server: { port: 5183, strictPort: true },
})
