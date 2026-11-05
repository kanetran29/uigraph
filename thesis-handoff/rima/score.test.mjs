/**
 * Checks score.mjs against the counting rules of PREREGISTRATION.txt on a built reference and graph.
 * Run: node --test score.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { referencePairs, scoreSubject } from './score.mjs'

const screen = (id, route) => ({ id, route, kind: 'screen' })

/** A graph with screens /a, /b and /c/:id, an edge /a -> /b and an edge from the top scope to /c/:id. */
const graph = {
  nodes: [screen('a', '/a'), screen('b', '/b'), screen('c', '/c/:id'), { id: 'top', kind: 'scope', scope: { kind: 'top' } }],
  edges: [{ from: 'a', to: 'b' }, { from: 'top', to: 'c' }],
}

/** An entry of the main ground-truth schema. */
const entry = (starts, terminal, external = null) => ({
  expectedIntent: { startRouteFullPaths: starts, terminalRoutePath: terminal, terminalExternalUrl: external },
  expectedPlan: {},
})

/** An entry of the petclinic schema: start routes as preconditions, terminal as a url. */
const clinic = (start, terminalUrl) => ({
  expectedIntent: {},
  expectedPlan: { preConditions: [{ type: 'navigate-to-route', url: start }], terminalUrl },
})

const gt = {
  entries: [
    entry(['/a'], '/b'),
    entry(['/b'], '/c/7'),
    entry(['/a'], '/a'),
    entry(['/a'], null, 'https://example.org'),
    entry(['/b'], '/zzz'),
    clinic('/c/:ownerId', '/a'),
    clinic('/a', 'assert-no-crash'),
    entry(['/a/'], '/b'),
  ],
}

test('reference pairs: one per start route, same, external and no-terminal entries excluded and counted', () => {
  const r = referencePairs(gt)
  assert.deepEqual(r.classes, { nav: 5, same: 1, external: 1, noterminal: 1 })
  assert.deepEqual(r.pairs.map((p) => p.join(' ')).sort(), ['/a /b', '/b /c/7', '/b /zzz', '/c/:ownerId /a'])
})

test('pairs match through scope expansion and parameters; an unmatched route is its own miss class', () => {
  const s = scoreSubject(gt, { full: graph })
  assert.equal(s.pairs, 4)
  assert.equal(s.levels.full.hit, 2)
  assert.deepEqual(s.levels.full.missed.map((m) => `${m.from} ${m.to} ${m.why}`).sort(), ['/b /zzz route', '/c/:ownerId /a pair'])
})

test('extra pairs exclude reference pairs and self pairs, and record whether only the top scope reaches them', () => {
  const s = scoreSubject(gt, { full: graph })
  assert.deepEqual(s.extras, [{ from: '/a', to: '/c/:id', top: true }])
  assert.equal(s.selfPairs, 1)
  assert.equal(s.routes, 5)
  assert.equal(s.routesHeld, 4)
})

test('the adjudication sample keeps every item up to the cap and a fixed seeded subset above it', async () => {
  const { sample } = await import('./adjudication-input.mjs')
  const items = Array.from({ length: 50 }, (_, i) => ({ from: `/s${String(i).padStart(2, '0')}`, to: '/t' }))
  assert.equal(sample(items.slice(0, 40)).length, 40)
  const a = sample(items)
  assert.equal(a.length, 40)
  assert.deepEqual(a, sample([...items].reverse()))
  assert.deepEqual(a, [...a].sort((x, y) => `${x.from} ${x.to}`.localeCompare(`${y.from} ${y.to}`)))
})

test('verdicts: the gate overrides the reader, and a pair with no reading is an error', async () => {
  const { merge } = await import('./verdicts.mjs')
  const input = { app: { misses: [{ from: '/a', to: '/b' }], extras: [{ from: '/a', to: '/c', top: false }, { from: '/b', to: '/c', top: true }] } }
  const runs = [{ slug: 'app', readers: [{ kind: 'miss', from: '/a', to: '/b', verdict: 'b' }, { kind: 'extra', from: '/a', to: '/c', verdict: 'spurious' }, { kind: 'extra', from: '/b', to: '/c', verdict: 'real' }], gateItems: [{ kind: 'extra', from: '/a', to: '/c', verdict: 'real' }] }]
  const out = merge(runs, input)
  assert.deepEqual(out.map((x) => `${x.kind} ${x.from} ${x.to} ${x.verdict} ${x.gated}`), ['miss /a /b b false', 'extra /a /c real true', 'extra /b /c real false'])
  assert.throws(() => merge([{ slug: 'app', readers: runs[0].readers.slice(1), gateItems: [] }], input), /no reading/)
})

test('verdicts: a hand correction replaces the merged verdict and an unknown pair is refused', async () => {
  const { merge, applyCorrections } = await import('./verdicts.mjs')
  const input = { app: { misses: [], extras: [{ from: '/a', to: '/c', top: false }, { from: '/a', to: '/d', top: false }] } }
  const out = merge([{ slug: 'app', readers: [{ kind: 'extra', from: '/a', to: '/c', verdict: 'real' }, { kind: 'extra', from: '/a', to: '/d', verdict: 'real' }], gateItems: [] }], input)
  applyCorrections(out, { _note: 'x', 'app extra /a /c': { verdict: 'spurious', site: 'f:1', reason: 'r' }, 'app extra /a /d': { verdict: 'real', site: 'g:2', reason: 'r2' } })
  assert.deepEqual(out.map((x) => `${x.verdict} ${x.corrected} ${x.site}`), ['spurious verdict f:1', 'real site g:2'])
  assert.throws(() => applyCorrections(out, { 'app extra /x /y': { verdict: 'real', site: '', reason: '' } }), /unknown pair/)
})

test('per-start reading: an entry whose terminal is a start route yields a pair from each other start', () => {
  const g = { entries: [entry(['/a', '/b', '/c/1'], '/b'), entry(['/a'], '/b')] }
  assert.deepEqual(referencePairs(g).pairs.map((p) => p.join(' ')), ['/a /b'])
  assert.deepEqual(referencePairs(g, { perStart: true }).pairs.map((p) => p.join(' ')).sort(), ['/a /b', '/c/1 /b'])
})
