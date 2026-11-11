/**
 * A local stub of the RealWorld API for the must-tier runtime check (Addendum A1). It answers the
 * calls realworld's signed-in screens make (/editor, /editor/:slug, /settings) with records shaped
 * per specs/api/openapi.yml (theme submodule at ffbd690), so those screens load as themselves. One
 * test account and one article written by it; no persistence, no validation beyond the token.
 * It is a test double for loading screens, not a RealWorld implementation.
 *
 * Usage: node stub-realworld.mjs [--port 4601]
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4601
const TOKEN = 'must-run-stub-token'
const USER = { email: 'must-run@stub.local', username: 'mustrun', bio: null, image: null }
const PROFILE = { username: USER.username, bio: null, image: null, following: false }
const ARTICLE = {
  slug: 'introduction-to-machine-learning-for-developers',
  title: 'Introduction to machine learning for developers',
  description: 'Stub article for the must-tier runtime check',
  body: 'Stub body.',
  tagList: ['ai'],
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  favorited: false,
  favoritesCount: 0,
  author: PROFILE,
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

/** Writes one JSON response with the CORS headers the browser needs for a cross-port call. */
function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

/** Maps one request to the spec-shaped answer, or null when the stub does not serve the path. */
export function answer(method, path, authorized) {
  const signedIn = () => (authorized ? [200, { user: { ...USER, token: TOKEN } }] : [401, { errors: { token: ['missing'] } }])
  if (method === 'POST' && (path === '/api/users/login' || path === '/api/users')) return [200, { user: { ...USER, token: TOKEN } }]
  if (path === '/api/user') return signedIn()
  if (method === 'GET' && path === '/api/tags') return [200, { tags: ['ai'] }]
  if (method === 'GET' && (path === '/api/articles' || path === '/api/articles/feed')) return [200, { articles: [ARTICLE], articlesCount: 1 }]
  if (path === '/api/articles' && method === 'POST') return [201, { article: ARTICLE }]
  const m = path.match(/^\/api\/articles\/([^/]+)(\/comments|\/favorite)?$/)
  if (m && m[1] === ARTICLE.slug) {
    if (m[2] === '/comments') return [200, { comments: [] }]
    if (m[2] === '/favorite') return [200, { article: ARTICLE }]
    return method === 'DELETE' ? [204, undefined] : [200, { article: ARTICLE }]
  }
  if (method === 'GET' && path.startsWith('/api/profiles/')) return [200, { profile: { ...PROFILE, username: decodeURIComponent(path.slice(14)) } }]
  return null
}

/** Serves the stub on the loopback interface and logs each request with its status. */
function main() {
  createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204)
    req.resume()
    const path = new URL(req.url, 'http://stub').pathname
    const hit = answer(req.method, path, req.headers.authorization === `Token ${TOKEN}`)
    const [status, body] = hit ?? [404, { errors: { path: ['not served by the stub'] } }]
    console.log(`${req.method} ${path} ${status}`)
    send(res, status, body)
  }).listen(PORT, '127.0.0.1', () => console.log(`stub-realworld on http://127.0.0.1:${PORT}/api`))
}

if (import.meta.url === `file://${process.argv[1]}`) main()
