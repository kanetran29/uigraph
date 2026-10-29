/**
 * Boots one built Angular application in a headless browser and asks the
 * framework itself which routes it declares. Serves the build output over a
 * local static server with the single-page fallback a router needs, loads the
 * root address, injects in-page.js and writes the result as JSON.
 *
 * Usage: node probe.mjs --slug <name> --dist <dir> --out <file> [--wait <ms>]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = fileURLToPath(new URL('.', import.meta.url))

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
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = next && !next.startsWith('--') ? next : true
  }
  return out
}

/**
 * Serves a directory over HTTP, falling back to index.html for any address that
 * names no file, which is what lets a client-side router own the URL space.
 */
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
    const inRoot = candidate.startsWith(root)
    const file = inRoot && existsSync(candidate) && extname(candidate) ? candidate : nearestIndex(root, urlPath)
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
 * The index.html that owns an address. A build with a base href puts its own
 * index under that prefix, so the fallback walks up from the address rather
 * than always answering with the one at the root.
 */
function nearestIndex(root, urlPath) {
  const parts = urlPath.split('/').filter(Boolean)
  for (let i = parts.length; i >= 0; i -= 1) {
    const candidate = join(root, ...parts.slice(0, i), 'index.html')
    if (candidate.startsWith(root) && existsSync(candidate)) return candidate
  }
  return join(root, 'index.html')
}

/**
 * Loads the application's root address, waits for it to bootstrap and runs the
 * in-page probe. Console messages and page errors are collected either way,
 * because an application that failed to boot must not be read as one with no
 * routes.
 */
async function run({ slug, dist, waitMs, base }) {
  const { server, port } = await serve(dist)
  const origin = `http://127.0.0.1:${port}${base || ''}`
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)))

  let result
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(Number(waitMs) || 6000)
    const booted = await page.evaluate(() => ({
      hasNg: typeof globalThis.ng === 'object' && globalThis.ng !== null,
      bodyChars: document.body ? document.body.innerText.length : 0,
      outlets: document.querySelectorAll('router-outlet').length,
    }))
    await page.addScriptTag({ content: readFileSync(join(HERE, 'in-page.js'), 'utf8') })
    result = await page.evaluate(() => globalThis.__uigraphProbe({}))
    result.booted = booted
  } catch (e) {
    result = { ok: false, reason: 'driver-error', message: String(e && e.message || e) }
  } finally {
    await browser.close()
    server.close()
  }
  return { slug, origin, consoleErrors, pageErrors, ...result }
}

const a = args(process.argv.slice(2))
if (!a.dist || !a.out) {
  console.error('usage: node probe.mjs --slug <name> --dist <dir> --out <file> [--wait <ms>]')
  process.exit(2)
}
const out = await run({ slug: a.slug || 'app', dist: a.dist, waitMs: a.wait, base: a.base })
writeFileSync(a.out, JSON.stringify(out, null, 2))
const n = Array.isArray(out.routes) ? out.routes.length : 0
console.log(`${out.slug}: ok=${out.ok} routes=${n} lazyFailures=${(out.lazyFailures || []).length} pageErrors=${out.pageErrors.length}`)
if (!out.ok) {
  console.error(`  reason: ${out.reason}`, out.diagnostics || out.message || '')
  process.exit(1)
}
