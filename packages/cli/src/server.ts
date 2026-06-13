// The local API server behind `uigraph serve` (milestone M4). It serves the merged
// graph + overlay over plain node:http (no extra dep) for the dashboard, and
// accepts overlay edits via POST. The overlay-write logic is REUSED from
// @uigraph/mcp's updateGraph so the CLI and the MCP server cannot drift apart.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolContext, UpdateGraphArgs } from '@uigraph/mcp'
import { dbPath, listScenarios, loadMergedGraph, setScenario, updateGraph } from '@uigraph/mcp'
import { openStore } from '@uigraph/core/node'
import { buildCoverage, emptyOverlay, exportOverlaySpec, hashValue } from '@uigraph/core'

/** Render the workspace overlay as a markdown "planned changes" spec. */
function readPlan(ctx: ToolContext): string {
  const store = openStore(dbPath(ctx))
  try {
    const base = store.getBaseGraph()
    if (base === null) return '_No graph in this workspace._\n'
    return exportOverlaySpec(base, store.getOverlay() ?? emptyOverlay(hashValue(base)))
  } finally {
    store.close()
  }
}
import { readSoundiness } from './commands'

/** Read the quarantined Tier-2 proposals from the workspace store, or empty if none. */
function readProposals(ctx: ToolContext): unknown {
  const store = openStore(dbPath(ctx))
  try {
    return store.getProposals() ?? { version: 0, base: '', proposals: [] }
  } finally {
    store.close()
  }
}

/** A method + path request reduced to what the API router needs to dispatch. */
export interface ApiRequest {
  method: string
  path: string
  body: unknown
}

/** A status code plus a JSON-serializable payload; the router's pure output. */
export interface ApiResponse {
  status: number
  body: unknown
}

/**
 * Pure request router for the serve API, testable without a socket. Maps
 * `GET /api/graph` to the merged graph, `GET /api/soundiness` to the soundiness
 * report (or `[]` when absent), and `POST /api/overlay` to a single overlay edit
 * applied via the shared MCP updateGraph. Unknown routes return 404; a thrown
 * handler error becomes a 400 with the message.
 */
export function handleApiRequest(ctx: ToolContext, req: ApiRequest): ApiResponse {
  try {
    if (req.method === 'GET' && req.path === '/api/graph') {
      return { status: 200, body: loadMergedGraph(ctx) }
    }
    if (req.method === 'GET' && req.path === '/api/soundiness') {
      return { status: 200, body: readSoundiness(ctx.dir) }
    }
    if (req.method === 'GET' && req.path === '/api/proposals') {
      return { status: 200, body: readProposals(ctx) }
    }
    if (req.method === 'GET' && req.path === '/api/coverage') {
      return { status: 200, body: buildCoverage(loadMergedGraph(ctx)) }
    }
    if (req.method === 'GET' && req.path === '/api/plan') {
      return { status: 200, body: { spec: readPlan(ctx) } }
    }
    if (req.method === 'POST' && req.path === '/api/overlay') {
      const result = updateGraph(ctx, req.body as UpdateGraphArgs)
      return { status: 200, body: result }
    }
    if (req.method === 'GET' && req.path === '/api/scenarios') {
      return { status: 200, body: listScenarios(ctx) }
    }
    if (req.method === 'POST' && req.path === '/api/scenario') {
      const { name } = req.body as { name?: string }
      if (typeof name !== 'string' || name.length === 0) return { status: 400, body: { error: 'scenario name required' } }
      return { status: 200, body: setScenario(ctx, { name }) }
    }
    return { status: 404, body: { error: `not found: ${req.method} ${req.path}` } }
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } }
  }
}

/**
 * Resolve a `GET /api/shots/<name>.jpg|jpeg` request to a safe absolute file path
 * under `<dir>/shots`, or null when it is not a shot request, the name is unsafe,
 * or the file is missing. The name charset excludes `/`, so path traversal cannot
 * escape the shots directory. These are the per-screen evidence screenshots
 * referenced by a proposal's `screenshot` field.
 */
export function resolveShotPath(dir: string, reqPath: string): string | null {
  const m = /^\/api\/shots\/([A-Za-z0-9_.-]+\.jpe?g)$/.exec(reqPath)
  if (!m || m[1] === undefined || m[1].includes('..')) return null
  const file = join(dir, 'shots', m[1])
  return existsSync(file) ? file : null
}

/** Permissive CORS headers for localhost dashboard development. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Read an entire request body into a string, resolving once the stream ends. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Build (without listening) the node:http server for a workspace dir. It applies
 * CORS, short-circuits preflight OPTIONS, parses the JSON body for writes, and
 * delegates every other request to the pure handleApiRequest router.
 */
export function createApiServer(dir: string): Server {
  const ctx: ToolContext = { dir }
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(ctx, req, res)
  })
}

/** Serve one HTTP request: apply CORS, parse the body, route, and write JSON. */
async function handle(ctx: ToolContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const path = (req.url ?? '').split('?')[0] ?? ''

  if (req.method === 'GET' && path.startsWith('/api/shots/')) {
    const file = resolveShotPath(ctx.dir, path)
    if (file === null) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'shot not found' }))
    } else {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(readFileSync(file))
    }
    return
  }

  let body: unknown
  if (req.method === 'POST') {
    const raw = await readBody(req)
    try {
      body = raw.length > 0 ? JSON.parse(raw) : undefined
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
      return
    }
  }

  const result = handleApiRequest(ctx, { method: req.method ?? 'GET', path, body })
  res.writeHead(result.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

/** Options for starting the API server: the workspace dir and the listen port. */
export interface StartApiServerOptions {
  dir: string
  port: number
}

/**
 * Start the serve API listening on a port, resolving with the server and the URL
 * once it is accepting connections. A port of 0 binds an ephemeral port, which
 * tests use to avoid collisions.
 */
export function startApiServer(opts: StartApiServerOptions): Promise<{ server: Server; url: string }> {
  const server = createApiServer(opts.dir)
  return new Promise((resolve) => {
    server.listen(opts.port, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : opts.port
      resolve({ server, url: `http://localhost:${port}` })
    })
  })
}
