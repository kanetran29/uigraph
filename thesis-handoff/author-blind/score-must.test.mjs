/**
 * Checks the reader-tier rule and the per-kind tally of score-must.mjs on a small fixture.
 * Run: node --test score-must.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readerTier, compare } from './score-must.mjs'

test('reader tier: both yes is must, any no is may, otherwise undecided', () => {
  assert.equal(readerTier({ target: 'yes', always: 'yes' }), 'must')
  assert.equal(readerTier({ target: 'yes', always: 'no' }), 'may')
  assert.equal(readerTier({ target: 'unsure', always: 'yes' }), 'undecided')
  assert.equal(readerTier(undefined), 'unanswered')
})

test('must items and decoys are tallied apart', () => {
  const items = [
    { id: 'a', app: 'x', file: 'f.html', line: 1 },
    { id: 'b', app: 'x', file: 'f.html', line: 2 },
    { id: 'c', app: 'x', file: 'g.html', line: 3 },
  ]
  const verdicts = { a: { target: 'yes', always: 'yes' }, b: { target: 'yes', always: 'no' }, c: { target: 'yes', always: 'yes' } }
  const r = compare(items, verdicts, new Set(['x:f.html:1', 'x:f.html:2']))
  assert.deepEqual(r.must, { items: 2, agree: 1, disagree: 1, undecided: 0, unanswered: 0 })
  assert.deepEqual(r.decoy, { items: 1, agree: 0, disagree: 1, undecided: 0, unanswered: 0 })
})
