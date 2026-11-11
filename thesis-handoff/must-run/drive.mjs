import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const LOG_PORT = 4599;
const POLL_MS = 50;
const VALUE_FLAGS = new Set(['edges', 'base', 'out', 'login', 'settle', 'wait']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'content-type',
};
const records = [];

/**
 * Reports a fatal input problem on stderr and exits with code 2, so callers can tell bad usage from a negative measurement.
 */
function fail(message) {
  console.error(message);
  process.exit(2);
}

/**
 * Parses the command line into an options object and validates required flags and numeric values, failing fast on anything malformed.
 */
function parseArgs(argv) {
  const opts = { hash: false, settle: 1500, wait: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'hash') opts.hash = true;
    else if (VALUE_FLAGS.has(name) && i + 1 < argv.length) opts[name] = argv[++i];
    else fail(`Bad or incomplete flag: ${arg}`);
  }
  for (const name of ['edges', 'base', 'out']) {
    if (!opts[name]) fail(`Missing required flag --${name}`);
  }
  opts.settle = Number(opts.settle);
  opts.wait = Number(opts.wait);
  if (!Number.isFinite(opts.settle) || !Number.isFinite(opts.wait)) fail('--settle and --wait must be numbers');
  opts.base = opts.base.replace(/\/+$/, '');
  return opts;
}

/**
 * Reads and parses a JSON file, exiting with code 2 when it is missing or invalid since the measurement cannot proceed without it.
 */
function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return fail(`Cannot read ${label} file ${path}: ${err.message}`);
  }
}

/**
 * Handles one request to the log server: answers CORS preflights and stores each POSTed JSON record with its arrival time.
 */
async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method === 'POST' && req.url === '/log') {
    try {
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (record && typeof record === 'object') records.push({ at: Date.now(), record });
    } catch {
      // malformed bodies are dropped; the router log is best effort
    }
  }
  res.writeHead(204, CORS);
  res.end();
}

/**
 * Starts the log server on the fixed loopback port and resolves once it is listening, so the app can post events from the first navigation.
 */
function startServer() {
  const server = createServer(handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(LOG_PORT, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Resolves after the given delay, used for polling and for the post-load settle period.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the NavigationEnd records that arrived at or after the given time, in arrival order, so each step only sees its own navigations.
 */
function navEnds(since) {
  const found = [];
  for (const { at, record } of records) {
    if (at >= since && record.type === 'NavigationEnd') found.push(record);
  }
  return found;
}

/**
 * Polls until a NavigationEnd record newer than the given time exists or the timeout elapses, returning the first such record or null.
 */
async function waitForNav(since, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = navEnds(since);
    if (found.length > 0) return found[0];
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

/**
 * Normalises a route pattern to a leading slash and no trailing slash (except root) so patterns compare reliably; non-strings give null.
 */
function norm(pattern) {
  if (typeof pattern !== 'string') return null;
  let p = pattern.startsWith('/') ? pattern : `/${pattern}`;
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  return p;
}

/**
 * Builds the absolute URL for an app path, inserting the hash prefix when the app uses hash routing.
 */
function appUrl(base, hash, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return hash ? `${base}/#${p}` : base + p;
}

/**
 * Executes the optional login steps once, in order, so every edge is then checked in an authenticated session.
 */
async function runLogin(page, login, base, hash) {
  await page.goto(appUrl(base, hash, login.url), { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (const step of login.steps || []) {
    if ('fill' in step) await page.fill(step.fill, step.value);
    else if ('click' in step) await page.click(step.click);
    else if ('waitFor' in step) await page.waitForSelector(step.waitFor);
  }
}

/**
 * Checks one edge at runtime: loads the source screen, clicks the marked element and classifies where the router ended up.
 */
async function checkEdge(page, edge, opts) {
  const result = (outcome, landed = null, detail = null) => ({ ...edge, outcome, landed, detail });
  const t0 = Date.now();
  try {
    await page.goto(appUrl(opts.base, opts.hash, edge.fromUrl), { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    return result('unreached', null, err.message);
  }
  const first = await waitForNav(t0, opts.wait);
  if (first) await sleep(opts.settle);
  const ends = navEnds(t0);
  const landedFrom = ends.length > 0 ? norm(ends[ends.length - 1].pattern) : null;
  if (landedFrom !== norm(edge.from)) return result('unreached', landedFrom);

  const target = page.locator(`[data-must-site="${edge.id}"]`);
  if ((await target.count()) === 0 || !(await target.first().isVisible())) return result('not-rendered');

  const t1 = Date.now();
  try {
    await target.first().click({ timeout: 5000 });
  } catch (err) {
    return result('not-rendered', null, err.message);
  }
  const hit = await waitForNav(t1, opts.wait);
  if (!hit) return result('no-navigation');
  const landed = norm(hit.pattern);
  return landed === norm(edge.to) ? result('confirmed', landed) : result('other-target', landed);
}

/**
 * Runs the whole measurement: starts the log server and browser, optionally logs in, checks every edge, writes the results file and prints the counts.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const edges = readJson(opts.edges, 'edges');
  if (!Array.isArray(edges)) fail('Edges file must contain a JSON array');
  const login = opts.login ? readJson(opts.login, 'login') : null;

  const startedAt = new Date().toISOString();
  const counts = { confirmed: 0, 'other-target': 0, 'no-navigation': 0, 'not-rendered': 0, unreached: 0 };
  const results = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    if (login) await runLogin(page, login, opts.base, opts.hash);
    for (const edge of edges) {
      const result = await checkEdge(page, edge, opts);
      counts[result.outcome]++;
      results.push(result);
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
  writeFileSync(opts.out, JSON.stringify({ base: opts.base, hash: opts.hash, startedAt, edges: results, counts }, null, 2));
  console.log(JSON.stringify(counts));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
