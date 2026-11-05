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
