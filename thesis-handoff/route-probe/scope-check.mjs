/**
 * An oracle for the scope. Every other method in this evaluation checks a node, an edge or a
 * witness; none of them can be asked whether the SET OF SCREENS attribution computed for a
 * navigation site is the set it can really fire from. That set is the contribution, so the gap
 * was the sharpest limitation of the work. This closes one direction of it.
 *
 * The idea is the one the runtime method already rests on: ask the running application. A scope
 * says "this site fires from these screens". Navigate to one of those screens, let it render,
 * and read the in-app links the DOM actually holds. Then compare with the edges the graph's
 * per-screen query yields at that screen.
 *
 * Only ONE direction of the comparison is sound, and the asymmetry is the point:
 *
 *   observed and not predicted  --  the application renders a link at this screen that the
 *       graph does not have leaving it. Either a site was attributed to too FEW screens, or
 *       the extractor never read it. Unambiguous: the link is there.
 *
 *   predicted and not observed  --  the graph has an edge leaving this screen that the DOM
 *       does not show. This is NOT evidence of a wrong scope on its own, because a template
 *       renders links conditionally: realworld's header shows "New Article" only once a user
 *       is signed in, and this harness signs in to nothing. Reported, never counted against
 *       the analysis.
 *
 * So what it measures is the recall of the scope against the rendered interface, plus a count
 * of confirmed memberships. A screen whose rendered links the graph all predicts is a screen
 * on which attribution did not under-attribute anything reachable by a link.
 *
 * It sees `routerLink` anchors only. A `router.navigate()` in an event handler leaves nothing
 * in the DOM to read, so the sites this oracle covers are the template-sourced ones. That is a
 * restriction to declare, not a flaw to hide: those are also the sites the nesting and outlet
 * relations matter most for, since a shared component's links are exactly what a scope is for.
 *
 * Usage: node scope-check.mjs --slug <s> --dist <dir> --db <uigraph.db> --out <file>
 *                             [--addresses a,b,c] [--wait ms]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright-core'
import { edgesFrom } from '@ui-graph/core'

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
  '.wasm': 'application/wasm',
}

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const slug = flag('--slug')
const dist = flag('--dist')
const dbPath = flag('--db')
const outFile = flag('--out')
const waitMs = Number(flag('--wait', '900'))
const SCOPE_HARNESS = '1.1.0'
if (!slug || !dist || !dbPath || !outFile) {
  console.error('usage: node scope-check.mjs --slug <s> --dist <dir> --db <uigraph.db> --out <file> [--addresses a,b,c] [--wait ms]')
  process.exit(2)
}

/** A path with its parameter segments replaced, so a concrete URL can be matched to a pattern. */
function norm(p) {
  if (typeof p !== 'string') return null
  const s = `/${p}`.replace(/\/+/g, '/').replace(/[?#].*$/, '').replace(/\/$/, '')
  return s === '' ? '/' : s
}

const segs = (p) => norm(p).split('/').filter(Boolean)

/** Does a concrete address answer a route pattern? A hole answers any one segment. */
function matchesPattern(concrete, pattern) {
  if (pattern === '*' || pattern === '/*') return false
  const c = segs(concrete)
  const t = segs(pattern)
  if (c.length !== t.length) return false
  return t.every((s, i) => s.startsWith(':') || s === c[i])
}

function serveDir(dir) {
  const root = resolve(dir)
  const index = join(root, 'index.html')
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    // A built app with no backend still asks for one; answering {} keeps the router alive
    // instead of letting an unhandled rejection stop the render.
    if (urlPath.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    const candidate = join(root, normalize(urlPath))
    const file = candidate.startsWith(root) && existsSync(candidate) && extname(candidate) ? candidate : index
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

/**
 * Finds the live Router. Lifted verbatim from answerability.mjs rather than written again: a
 * shallower walk of my own found it in two of the five applications and reported the other
 * three as having no router, which would have published a scope oracle that silently covered
 * one application.
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
 * Reads the in-app links a rendered screen holds. An anchor carries an href, but Angular's
 * RouterLink sets href only on `a` and `area`: on a button or a component it binds a click
 * handler and leaves nothing to read. bitwarden renders 18 screens and not one anchor, so a
 * reader that looked only at `a[href]` measured nothing there. A STATIC `routerLink="/x"`
 * survives compilation as an attribute, so those are read too, and the count of elements that
 * carry a routerLink binding with no readable target is reported rather than ignored --- it
 * bounds what this oracle can see on that screen.
 */
const READ_LINKS = `(async (target, wait) => {
  const router = globalThis.__uigraphRouter
  if (!router) return { routerFound: false }
  try { await router.navigateByUrl(target) } catch {}
  await new Promise((ok) => setTimeout(ok, wait))
  const out = []
  let opaque = 0
  const take = (raw) => {
    if (typeof raw !== 'string') return
    const v = raw.trim()
    if (!v || /^([a-z]+:|#|\\/\\/)/i.test(v)) return
    out.push(v.startsWith('/') ? v : '/' + v)
  }
  for (const a of Array.from(document.querySelectorAll('a[href], area[href]'))) {
    if (a.getAttribute('target') === '_blank') continue
    take(a.getAttribute('href'))
  }
  for (const el of Array.from(document.querySelectorAll('[routerlink], [ng-reflect-router-link]'))) {
    const raw = el.getAttribute('routerlink') ?? el.getAttribute('ng-reflect-router-link')
    if (raw && raw.trim() && !raw.includes('[object')) take(raw.replace(/^,/, '').split(',').join('/'))
    else opaque += 1
  }
  return { routerFound: true, here: router.url, links: Array.from(new Set(out)), opaque }
})`

const db = new DatabaseSync(dbPath, { readOnly: true })
const graph = JSON.parse(db.prepare("select json from docs where key = 'graph'").get().json)
const screens = graph.nodes.filter((n) => n.kind === 'screen' && typeof n.route === 'string' && n.route.startsWith('/'))
if (!screens.length) throw new Error(`${dbPath} holds no screen node with a readable address`)

// The addresses to visit. A parameterised pattern cannot be navigated as written, so a hole is
// filled with a token; the comparison is pattern-aware, so the token never has to be real.
const chosen = flag('--addresses')
  ? String(flag('--addresses')).split(',').map((s) => s.trim()).filter(Boolean)
  : screens.map((n) => n.route).filter((r) => !r.includes('*'))
const concrete = (p) => segs(p).map((s) => (s.startsWith(':') ? 'probe-value' : s)).join('/')

const { server, port } = await serveDir(dist)
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', () => {})
page.on('console', () => {})

const rows = []
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(waitMs)
const routerFound = await page.evaluate(FIND_ROUTER)
if (!routerFound) throw new Error(`${slug}: no Angular Router was reachable from the loaded page, so no screen can be judged`)

for (const address of chosen) {
  const target = '/' + concrete(address)
  let obs
  try {
    obs = await page.evaluate(READ_LINKS + `(${JSON.stringify(target)}, ${waitMs})`)
  } catch (e) {
    rows.push({ address, error: String(e.message).slice(0, 160) })
    continue
  }
  if (!obs || !obs.routerFound) { rows.push({ address, error: 'no Angular Router reachable from the page' }); continue }

  // Where the router actually left us. A screen that redirects elsewhere renders the other
  // screen's links, so comparing them against THIS screen's scope would be a false finding.
  const landed = norm(obs.here)
  const stayed = matchesPattern(landed, address)

  const node = screens.find((n) => n.route === address)
  const predicted = node
    ? [...new Set(edgesFrom(graph, node.id)
        .filter((e) => String(e.event || '').startsWith('click'))
        .map((e) => graph.nodes.find((n) => n.id === e.to))
        .filter((n) => n && typeof n.route === 'string')
        .map((n) => n.route))]
    : []

  const observed = [...new Set((obs.links || []).map(norm).filter(Boolean))]
  const confirmed = observed.filter((o) => predicted.some((p) => matchesPattern(o, p) || norm(p) === o))
  const unpredicted = observed.filter((o) => !confirmed.includes(o))
  const unrendered = predicted.filter((p) => !observed.some((o) => matchesPattern(o, p) || norm(p) === o))

  rows.push({ address, landed, stayed, predicted, observed, confirmed, unpredicted, unrendered, opaque: obs.opaque ?? 0 })
}

await browser.close()
server.close()

const usable = rows.filter((r) => !r.error && r.stayed)
const tot = (k) => usable.reduce((a, r) => a + r[k].length, 0)
const report = {
  // The version of this harness, so a result set assembled from two runs of different
  // versions cannot be published as one measurement. The first run of this oracle read only
  // `a[href]`; the second also reads a static routerLink, and one application's file survived
  // from the first because it was read while the second run was still writing it.
  scopeHarness: SCOPE_HARNESS,
  slug,
  dist,
  dbPath,
  screensInGraph: screens.length,
  visited: rows.length,
  // A screen the router redirects away from renders another screen's links, so its scope
  // cannot be judged from what rendered. Counted, never silently folded in.
  usable: usable.length,
  redirectedAway: rows.filter((r) => !r.error && !r.stayed).length,
  errors: rows.filter((r) => r.error).length,
  observedLinks: tot('observed'),
  confirmed: tot('confirmed'),
  unpredicted: tot('unpredicted'),
  unrendered: tot('unrendered'),
  // Elements carrying a routerLink whose target this oracle cannot read. They bound what the
  // confirmed figure covers on each screen, so they are published beside it.
  opaqueLinks: usable.reduce((a, r) => a + (r.opaque || 0), 0),
  rows,
}
writeFileSync(outFile, JSON.stringify(report, null, 2))

console.log(`${slug}: ${report.usable} of ${report.visited} screens judged (${report.redirectedAway} redirected away, ${report.errors} unreachable)`)
console.log(`  links the running application renders:        ${report.observedLinks}`)
console.log(`  of those, predicted by the graph's scope:     ${report.confirmed}` +
  (report.observedLinks ? ` = ${((report.confirmed / report.observedLinks) * 100).toFixed(1)}%` : ''))
console.log(`  rendered but NOT predicted (scope too small): ${report.unpredicted}`)
console.log(`  predicted but not rendered (conditional, or scope too large -- not decided here): ${report.unrendered}`)
for (const r of usable.filter((r) => r.unpredicted.length).slice(0, 6)) {
  console.log(`    ${r.address}: renders ${r.unpredicted.slice(0, 5).join(', ')}`)
}
if (report.errors) process.exitCode = 1
