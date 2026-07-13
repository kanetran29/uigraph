// The local API server behind `uigraph serve` (milestone M4). It serves the merged
// graph + overlay over plain node:http (no extra dep) for the dashboard, and
// accepts overlay edits via POST. The overlay-write logic is REUSED from
// @ui-graph/mcp's updateGraph so the CLI and the MCP server cannot drift apart.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { ToolContext, ListCasesArgs, UpdateGraphArgs } from '@ui-graph/mcp'
import { dbPath, getCoverage, getFreshness, getFrontier, getState, listCases, listScenarios, loadMergedGraph, setScenario, updateGraph } from '@ui-graph/mcp'
import { openStore, readRegistry, findWorkspace, summarize, type WorkspaceSummary } from '@ui-graph/core/node'
import type { TrustTier } from '@ui-graph/core'
import { diffSinceLast, emptyOverlay, exportOverlaySpec, hashValue } from '@ui-graph/core'

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
  query?: URLSearchParams
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
 * applied via the shared MCP updateGraph. The recall-first read tools are exposed
 * for the dashboard/agent: `GET /api/state/<id>` (a state + its trust-tiered cases,
 * 404 on unknown id), `GET /api/cases?from&outcomeClass&minTier` (the filterable
 * case set), and `GET /api/frontier?state` (the known-unknowns). Unknown routes
 * return 404; a thrown handler error becomes a 400 with the message.
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
      return { status: 200, body: getCoverage(ctx) }
    }
    if (req.method === 'GET' && req.path === '/api/freshness') {
      return { status: 200, body: getFreshness(ctx) }
    }
    if (req.method === 'GET' && req.path === '/api/plan') {
      return { status: 200, body: { spec: readPlan(ctx) } }
    }
    if (req.method === 'GET' && req.path === '/api/changes') {
      const store = openStore(dbPath(ctx))
      try {
        return { status: 200, body: diffSinceLast(store.getBaseGraph(), store.getFingerprint()?.mappedAt ?? null, store.getPreviousGraph()) }
      } finally {
        store.close()
      }
    }
    if (req.method === 'GET' && req.path.startsWith('/api/state/')) {
      const id = decodeURIComponent(req.path.slice('/api/state/'.length))
      const result = getState(ctx, { id })
      return 'error' in result ? { status: 404, body: result } : { status: 200, body: result }
    }
    if (req.method === 'GET' && req.path === '/api/cases') {
      const q = req.query
      const args: ListCasesArgs = {
        ...(q?.get('from') ? { from: q.get('from') as string } : {}),
        ...(q?.get('outcomeClass') ? { outcomeClass: q.get('outcomeClass') as string } : {}),
        ...(q?.get('minTier') ? { minTier: q.get('minTier') as TrustTier } : {}),
      }
      return { status: 200, body: listCases(ctx, args) }
    }
    if (req.method === 'GET' && req.path === '/api/frontier') {
      const state = req.query?.get('state')
      return { status: 200, body: getFrontier(ctx, state ? { state } : {}) }
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
/**
 * How a request picks its workspace. `resolveDir(wsId)` maps a client-supplied OPAQUE id
 * to a server-vetted absolute dir (or null = unknown/unavailable → 404); the id is NEVER
 * used to build a path. `workspaces()` is the client-safe switcher list (no dirs leak).
 */
export interface ServeConfig {
  resolveDir: (wsId: string | null) => string | null
  workspaces: () => WorkspaceSummary[]
}

/** Single-workspace mode: every request hits the one fixed dir; no switcher list. */
export function singleConfig(dir: string): ServeConfig {
  return { resolveDir: () => dir, workspaces: () => [] }
}

/** Registry mode: resolve ?ws against ~/.uigraph; null ws → the first AVAILABLE workspace. */
export function registryConfig(): ServeConfig {
  const dirHasDb = (dir: string): boolean => existsSync(dbPath({ dir }))
  return {
    resolveDir: (wsId) => {
      const reg = readRegistry()
      if (wsId === null) return reg.workspaces.find((w) => dirHasDb(w.dir))?.dir ?? null
      const e = findWorkspace(reg, wsId)
      return e && dirHasDb(e.dir) ? e.dir : null
    },
    workspaces: () => summarize(readRegistry(), (e) => dirHasDb(e.dir)),
  }
}

export function createApiServer(dir: string, staticDir?: string): Server {
  return createConfiguredServer(singleConfig(dir), staticDir)
}

/** MIME types for the static dashboard assets the server may deliver. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

/**
 * Resolve a non-API GET path to a file inside the static dir (the built
 * dashboard), falling back to index.html for SPA routes. Returns null when no
 * static dir is configured or the resolved path escapes it (traversal-safe).
 */
export function resolveStaticPath(staticDir: string | undefined, reqPath: string): string | null {
  if (staticDir === undefined) return null
  const root = resolve(staticDir)
  const rel = normalize(decodeURIComponent(reqPath)).replace(/^([/\\])+/, '')
  const candidate = resolve(root, rel === '' ? 'index.html' : rel)
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  const index = join(root, 'index.html')
  return existsSync(index) ? index : null
}

/** Build the node:http server from a ServeConfig (single or registry mode), optionally serving a built dashboard. */
export function createConfiguredServer(config: ServeConfig, staticDir?: string): Server {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(config, req, res, staticDir)
  })
}

/** Serve one HTTP request: apply CORS, resolve the workspace, route, and write JSON (or a static dashboard file). */
async function handle(config: ServeConfig, req: IncomingMessage, res: ServerResponse, staticDir?: string): Promise<void> {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && !path.startsWith('/api/')) {
    const file = resolveStaticPath(staticDir, path)
    if (file !== null) {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
      return
    }
  }

  // The switcher list — client-safe summaries (dirs omitted), independent of any workspace.
  if (req.method === 'GET' && path === '/api/workspaces') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(config.workspaces()))
    return
  }

  // Resolve the per-request workspace from the OPAQUE ?ws id (never a path) → 404 if unknown.
  const dir = config.resolveDir(url.searchParams.get('ws'))
  if (dir === null) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unknown or unavailable workspace' }))
    return
  }
  const ctx: ToolContext = { dir }

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

  const result = handleApiRequest(ctx, { method: req.method ?? 'GET', path, body, query: url.searchParams })
  res.writeHead(result.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

/** Options for starting the API server: a single workspace `dir`, OR registry mode (omit
 *  dir → serve every registered workspace, selected per-request by ?ws). */
export interface StartApiServerOptions {
  dir?: string
  port: number
  staticDir?: string
}

/**
 * Start the serve API listening on a port, resolving with the server and the URL
 * once it is accepting connections. A port of 0 binds an ephemeral port, which
 * tests use to avoid collisions. With `dir` → single-workspace; without → registry mode.
 */
export function startApiServer(opts: StartApiServerOptions): Promise<{ server: Server; url: string }> {
  const server = opts.dir !== undefined ? createApiServer(opts.dir, opts.staticDir) : createConfiguredServer(registryConfig(), opts.staticDir)
  return new Promise((resolve) => {
    server.listen(opts.port, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : opts.port
      resolve({ server, url: `http://localhost:${port}` })
    })
  })
}
