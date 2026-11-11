/**
 * Checks the expected answers and the per-kind tally of score-rima.mjs on a small fixture.
 * Run: node --test score-rima.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { expected, compare } from './score-rima.mjs'

test('a miss of class e expects spurious, any other miss real, an extra its verdict, an unread pair spurious', () => {
  assert.deepEqual(expected({ kind: 'miss', verdict: 'e' }), { kind: 'miss', answer: 'spurious' })
  assert.deepEqual(expected({ kind: 'miss', verdict: 'f' }), { kind: 'miss', answer: 'real' })
  assert.deepEqual(expected({ kind: 'extra', verdict: 'real' }), { kind: 'real', answer: 'real' })
  assert.deepEqual(expected({ kind: 'extra', verdict: 'spurious' }), { kind: 'spurious', answer: 'spurious' })
  assert.deepEqual(expected(undefined), { kind: 'decoy', answer: 'spurious' })
})

test('items are tallied per kind; unclear is undecided, a missing answer unanswered', () => {
  const items = [
    { id: 'a', app: 'x', from: '/a', to: '/b' },
    { id: 'b', app: 'x', from: '/b', to: '/a' },
    { id: 'c', app: 'x', from: '/c', to: '/a' },
    { id: 'd', app: 'x', from: '/d', to: '/a' },
    { id: 'e', app: 'x', from: '/e', to: '/a' },
  ]
  const adj = [
    { slug: 'x', kind: 'extra', from: '/a', to: '/b', verdict: 'real' },
    { slug: 'x', kind: 'extra', from: '/b', to: '/a', verdict: 'real' },
    { slug: 'x', kind: 'miss', from: '/c', to: '/a', verdict: 'e' },
    { slug: 'x', kind: 'extra', from: '/d', to: '/a', verdict: 'spurious' },
  ]
  const verdicts = { a: { verdict: 'real' }, b: { verdict: 'unclear' }, c: { verdict: 'real', reason: 'link at f.html:3' }, e: { verdict: 'spurious' } }
  const r = compare(items, verdicts, adj)
  assert.deepEqual(r.real, { items: 2, agree: 1, disagree: 0, undecided: 1, unanswered: 0 })
  assert.deepEqual(r.miss, { items: 1, agree: 0, disagree: 1, undecided: 0, unanswered: 0 })
  assert.deepEqual(r.spurious, { items: 1, agree: 0, disagree: 0, undecided: 0, unanswered: 1 })
  assert.deepEqual(r.decoy, { items: 1, agree: 1, disagree: 0, undecided: 0, unanswered: 0 })
  assert.deepEqual(r.rows.find((x) => x.id === 'c'), { id: 'c', app: 'x', from: '/c', to: '/a', kind: 'miss', expected: 'spurious', reader: 'real', reason: 'link at f.html:3' })
})
