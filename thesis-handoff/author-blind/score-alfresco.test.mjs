/**
 * Checks the per-pair comparison of score-alfresco.mjs on a small fixture: reference screens
 * (a list, or ALL for the shell) against the screens the reader ticked.
 * Run: node --test score-alfresco.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { compare } from './score-alfresco.mjs'

test('pairs are counted in both directions, shell sites apart, unsure sites counted', () => {
  const truth = {
    screens: ['/a', '/b', '/c'],
    sites: [
      { site: 'f.html:1', screens: 'ALL' },
      { site: 'g.ts:2', screens: ['/a', '/b'] },
      { site: 'h.ts:3', screens: ['/c'] },
    ],
  }
  const items = [
    { id: 'x', file: 'f.html', line: 1 },
    { id: 'y', file: 'g.ts', line: 2 },
    { id: 'z', file: 'h.ts', line: 3 },
  ]
  const verdicts = {
    x: { screens: ['/a', '/b', '/c'], sure: 'sure' },
    y: { screens: ['/a', '/c'], sure: 'unsure', reason: 'caller unclear' },
    z: { screens: ['/c'], sure: 'sure' },
  }
  const r = compare(items, verdicts, truth)
  assert.deepEqual(r.all, { sites: 3, refPairs: 6, agree: 5, refOnly: 1, readerOnly: 1, exact: 2, unsure: 1, unanswered: 0 })
  assert.deepEqual(r.nonShell, { sites: 2, refPairs: 3, agree: 2, refOnly: 1, readerOnly: 1, exact: 1, unsure: 1, unanswered: 0 })
  assert.deepEqual(r.rows.find((x) => x.id === 'y'), { id: 'y', site: 'g.ts:2', shell: false, refOnly: ['/b'], readerOnly: ['/c'], sure: 'unsure', reason: 'caller unclear' })
})

test('an item without the sure answer is unanswered', () => {
  const truth = { screens: ['/a'], sites: [{ site: 'f.html:1', screens: ['/a'] }] }
  const r = compare([{ id: 'x', file: 'f.html', line: 1 }], { x: { screens: ['/a'] } }, truth)
  assert.equal(r.all.unanswered, 1)
})
