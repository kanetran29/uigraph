/**
 * Asks a running Angular application what it does with a list of addresses, so that the way the
 * comparison classifies an address can be checked against the framework's own behaviour instead
 * of inferred from its configuration. The probe reads the route table; this navigates to an
 * address and records what the recogniser made of it: whether it matched at all, what the URL
 * became after redirects, and the component chain it activated. Nothing here parses a route file.
 *
 * It exists because two readings of a configuration can agree on a wrong premise. The comparison
 * files an address with children and no screen of its own outside the screens it compares; an
 * application whose catch-all answers every URL makes "the configuration mentions it" worthless
 * as an answerability test. Only a navigation settles either.
 *
 * Usage: node answerability.mjs --dist <dir> --addresses a,b,c --out <file> [--base /en/] [--wait ms]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** Reads the flags this script takes into a plain object. */
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const next = argv[i + 1]
    out[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true
  }
  return out
}

/** The index.html that owns an address, so a build under a base href is served its own. */
function nearestIndex(root, urlPath) {
  const parts = urlPath.split('/').filter(Boolean)
  for (let i = parts.length; i >= 0; i -= 1) {
    const candidate = join(root, ...parts.slice(0, i), 'index.html')
    if (candidate.startsWith(root) && existsSync(candidate)) return candidate
  }
  return join(root, 'index.html')
}

/** Serves a build output with the single-page fallback a client-side router needs. */
function serve(dir) {
  const root = resolve(dir)
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    const candidate = join(root, normalize(urlPath))
    const file = candidate.startsWith(root) && existsSync(candidate) && extname(candidate) ? candidate : nearestIndex(root, urlPath)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

/**
 * Finds the live Router the way in-page.js does and leaves it on the page, so each navigation
 * below can be driven from the application's own router rather than through the address bar,
 * which would reload the application once per address.
 */
const FIND_ROUTER = () => {
  const ng = globalThis.ng
  if (!ng || typeof ng.getComponent !== 'function') return false
  const instances = []
  for (const el of [document.body, ...Array.from(document.querySelectorAll('*')).slice(0, 4000)]) {
    try { const c = ng.getComponent(el); if (c) instances.push(c) } catch {}
    try { const ds = ng.getDirectives(el); if (Array.isArray(ds)) instances.push(...ds) } catch {}
  }
  const looks = (v) => !!v && typeof v === 'object' && typeof v.navigateByUrl === 'function' && Array.isArray(v.config)
  const seen = new Set()
  let frontier = instances.filter((o) => o && typeof o === 'object')
  for (let hop = 0; hop <= 4; hop += 1) {
    const next = []
    for (const obj of frontier) {
      if (seen.has(obj) || seen.size > 20000) continue
      seen.add(obj)
      if (looks(obj)) { globalThis.__uigraphRouter = obj; return true }
      const keys = new Set(Object.getOwnPropertyNames(obj))
      const proto = Object.getPrototypeOf(obj)
      if (proto && proto !== Object.prototype) for (const k of Object.getOwnPropertyNames(proto)) keys.add(k)
      for (const k of keys) {
        let v
        try { v = obj[k] } catch { continue }
        if (v && typeof v === 'object' && !seen.has(v)) next.push(v)
      }
    }
    if (next.length === 0) return false
    frontier = next
  }
  return false
}

/**
 * Navigates to one address and reports the recogniser's verdict. RoutesRecognized is the event
 * that fires exactly when the URL matched the configuration, before any guard runs, so a guard
 * that sends the visitor to a sign-in page does not hide the fact that the address was matched.
 *
 * Three things the first version of this got wrong, and all three read as a wrong answer about
 * whether the framework serves the address. Navigating to the address the application is already
 * at is a no-op that emits no event at all, and approaching it from a sentinel first only moved
 * the problem, because an application with no catch-all refuses the sentinel and stays where it
 * was: so the router's own URL after the attempt decides reachability when no event arrives.
 * Reading the chain off the router's SETTLED state was worse, because a guard redirects to a
 * sign-in page and the settled state is then that page for every address alike --- the chain has
 * to come from RoutesRecognized, which fires before any guard runs. And a route whose component
 * is loaded lazily carries none at recognition time, so what is read is the route's own
 * `loadComponent`, which is there to be seen whether or not the load has happened.
 */
const NAVIGATE = async (target) => {
  const router = globalThis.__uigraphRouter
  if (!router) return { target, error: 'router-not-found' }
  // Stripped on BOTH sides: a target carrying a query matched nothing on the left and was
  // reported as a redirect to itself.
  const bare = (u) => String(u || '').split('#')[0].split('?')[0].replace(/\/+$/, '')
  const same = (a, b) => bare(a) === bare(b)
  const chainOf = (snapshot) => {
    const chain = []
    let n = snapshot
    while (n) {
      const cfg = n.routeConfig
      chain.push({
        path: cfg ? cfg.path : null,
        component: n.component ? (n.component.name || String(n.component)) : null,
        lazyComponent: !!(cfg && cfg.loadComponent),
      })
      n = (n.children || []).find((c) => c.outlet === 'primary') || null
    }
    return chain
  }
  const seen = []
  const sub = router.events.subscribe((e) => {
    const row = { event: e.constructor && e.constructor.name }
    if (e.url) row.url = e.url
    if (e.urlAfterRedirects) row.after = e.urlAfterRedirects
    if (e.state) row.chain = chainOf(e.state.root)
    seen.push(row)
  })
  try { await router.navigateByUrl(target, { skipLocationChange: true }) } catch {}
  await new Promise((ok) => setTimeout(ok, 500))
  sub.unsubscribe()
  const event = seen.find((r) => r.event === 'RoutesRecognized')
  const url = router.url
  const alreadyThere = !event && same(url, target)
  const settled = router.routerState && router.routerState.snapshot ? chainOf(router.routerState.snapshot.root) : []
  const chain = event ? event.chain || [] : alreadyThere ? settled : []
  const last = chain[chain.length - 1]
  const landed = event ? event.after : url
  return {
    target,
    recognized: !!event || alreadyThere,
    at: url,
    after: landed,
    alreadyThere,
    redirected: !!event && !same(landed, target),
    chain: chain.map((c) => ({ path: c.path, component: c.component, lazyComponent: c.lazyComponent })),
    catchAll: chain.some((c) => c.path === '**' || c.path === '*'),
    placesComponent: !!last && (!!last.component || !!last.lazyComponent),
  }
}

const a = args(process.argv.slice(2))
if (!a.dist || !a.addresses || !a.out) {
  console.error('usage: node answerability.mjs --dist <dir> --addresses a,b,c --out <file> [--base /en/] [--wait ms]')
  process.exit(2)
}
const { server, port } = await serve(a.dist)
const origin = `http://127.0.0.1:${port}${a.base || ''}`
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', () => {})
let out
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(Number(a.wait) || 8000)
  const found = await page.evaluate(FIND_ROUTER)
  const results = []
  if (found) for (const target of String(a.addresses).split(',')) results.push(await page.evaluate(NAVIGATE, target))
  out = { slug: a.slug || 'app', origin, routerFound: found, results }
} finally {
  await browser.close()
  server.close()
}
writeFileSync(a.out, JSON.stringify(out, null, 2))
for (const r of out.results) {
  const verdict = !r.recognized ? 'not-recognized' : r.catchAll ? 'catch-all' : r.redirected ? `redirect to ${r.after}` : r.placesComponent ? 'screen' : 'no screen of its own'
  console.log(`${r.target.padEnd(34)} ${verdict}`)
}
if (!out.routerFound) {
  console.error('  router not found: build the application in development mode')
  process.exit(1)
}
