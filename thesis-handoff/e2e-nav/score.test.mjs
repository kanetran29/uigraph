/**
 * Checks score.mjs against the redirect rule of PREREGISTRATION.txt: a redirected navigation is
 * kept in its own bucket and compared on the target it asked for, not the one it landed on.
 * Run: node --test score.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { score } from './score.mjs'

/**
 * Writes a scorer input directory: a graph with screens /a, /b, /c/:id and /c/:id/general and
 * edges /a->/b and /a->/c/:id/general, an empty ledger, and the same log twice.
 */
function fixture(ends) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-score-'))
  const screen = (id, route) => ({ id, route, kind: 'screen', componentPath: `src/${id}.ts` })
  const graph = {
    nodes: [screen('a', '/a'), screen('b', '/b'), screen('c', '/c/:id'), screen('cg', '/c/:id/general')],
    edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'cg' }],
  }
  writeFileSync(join(dir, 'graph.json.gz'), gzipSync(JSON.stringify(graph)))
  writeFileSync(join(dir, 'soundiness.json.gz'), gzipSync('[]'))
  const log = ends.map((e) => JSON.stringify({ type: 'NavigationEnd', trigger: 'imperative', ...e })).join('\n')
  writeFileSync(join(dir, 'navlog-run1.jsonl'), log)
  writeFileSync(join(dir, 'navlog-run2.jsonl'), log)
  return dir
}

test('a redirected navigation is compared on its pre-redirect target', () => {
  const r = score(fixture([
    { fromPattern: '/a', url: '/b', urlAfterRedirects: '/b', pattern: '/b' },
    { fromPattern: '/a', url: '/c/7', urlAfterRedirects: '/c/7/general', pattern: '/c/:id/general' },
    { fromPattern: '/b', url: '/', urlAfterRedirects: '/a', pattern: '/a' },
  ]))
  assert.equal(r.pairs, 3)
  assert.equal(r.redirect, 2)
  assert.equal(r.hit, 1)
  assert.equal(r.miss, 2)
  assert.equal(r.missRedirect, 1)
  assert.equal(r.other, 1)
  assert.equal(r.hitAfterRedirects, 2)
})

test('a url that differs only in its query is not a redirect', () => {
  const r = score(fixture([
    { fromPattern: '/a', url: '/b?x=1', urlAfterRedirects: '/b', pattern: '/b' },
  ]))
  assert.equal(r.redirect, 0)
  assert.equal(r.hit, 1)
})

test('a comparison graph is scored on the same pairs', () => {
  const dir = fixture([
    { fromPattern: '/a', url: '/b', urlAfterRedirects: '/b', pattern: '/b' },
    { fromPattern: '/a', url: '/c/7/general', urlAfterRedirects: '/c/7/general', pattern: '/c/:id/general' },
  ])
  const screen = (id, route) => ({ id, route, kind: 'screen' })
  const noattr = { nodes: [screen('a', '/a'), screen('b', '/b'), screen('cg', '/c/:id/general')], edges: [{ from: 'a', to: 'b' }] }
  writeFileSync(join(dir, 'graph-noattr.json.gz'), gzipSync(JSON.stringify(noattr)))
  const r = score(dir)
  assert.equal(r.hit, 2)
  assert.deepEqual(r.variants, { noattr: { hit: 1, graphPairs: 1 } })
})
