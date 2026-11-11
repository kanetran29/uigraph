/**
 * Checks the tally of score-h2h.mjs on a small fixture: per group (mifos, Rima et al.'s subjects)
 * and per AI verdict, with unclear on either side counted as undecided.
 * Run: node --test score-h2h.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { compare } from './score-h2h.mjs'

test('answers are tallied per group and per AI verdict', () => {
  const items = [
    { id: 'a', app: 'mifos', from: '/a', to: '/b' },
    { id: 'b', app: 'mifos', from: '/b', to: '/a' },
    { id: 'c', app: 'mifos', from: '/c', to: '/a' },
    { id: 'd', app: 'heroes-angular', from: '/d', to: '/a' },
    { id: 'e', app: 'heroes-angular', from: '/e', to: '/a' },
  ]
  const read = [
    { slug: 'mifos', from: '/a', to: '/b', verdict: 'real' },
    { slug: 'mifos', from: '/b', to: '/a', verdict: 'spurious' },
    { slug: 'mifos', from: '/c', to: '/a', verdict: 'unclear' },
    { slug: 'heroes-angular', from: '/d', to: '/a', verdict: 'real' },
    { slug: 'heroes-angular', from: '/e', to: '/a', verdict: 'spurious' },
  ]
  const verdicts = { a: { verdict: 'real' }, b: { verdict: 'real', reason: 'x' }, c: { verdict: 'spurious' }, d: { verdict: 'unclear' } }
  const r = compare(items, verdicts, read)
  assert.deepEqual(r.mifos.all, { items: 3, agree: 1, disagree: 1, undecided: 1, unanswered: 0 })
  assert.deepEqual(r.mifos.real, { items: 1, agree: 1, disagree: 0, undecided: 0, unanswered: 0 })
  assert.deepEqual(r.mifos.spurious, { items: 1, agree: 0, disagree: 1, undecided: 0, unanswered: 0 })
  assert.deepEqual(r.rima.all, { items: 2, agree: 0, disagree: 0, undecided: 1, unanswered: 1 })
  assert.equal(r.rows.find((x) => x.id === 'b').reason, 'x')
})
