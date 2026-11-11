/**
 * Checks the reader verdict, the tier 1 parse and the per-kind tally of score-notoken.mjs on a small fixture.
 * Run: node --test score-notoken.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readerVerdict, tier1, compare } from './score-notoken.mjs'

test('reader verdict: both yes is real, any no is spurious, otherwise undecided', () => {
  assert.equal(readerVerdict({ target: 'yes', shown: 'yes' }), 'real')
  assert.equal(readerVerdict({ target: 'no', shown: 'unsure' }), 'spurious')
  assert.equal(readerVerdict({ target: 'yes', shown: 'unsure' }), 'undecided')
  assert.equal(readerVerdict(undefined), 'unanswered')
})

test('tier 1 holds only the pairs listed under its heading', () => {
  const md = '## Tier 1 — x\n\n1. [ ] **k8sdash** `/login` → `/overview`\n   - AI verdict: **real**\n## Tier 2 — y\n2. [ ] **mifos** `/a` → `/b` (both tools)\n'
  assert.deepEqual([...tier1(md)], ['k8sdash /login /overview'])
})

test('real items and decoys are tallied apart, with the items seen in tier 1 counted', () => {
  const items = [
    { id: 'a', app: 'x', from: '/a', to: '/b' },
    { id: 'b', app: 'x', from: '/b', to: '/a' },
    { id: 'c', app: 'x', from: '/c', to: '/a' },
  ]
  const read = [
    { slug: 'x', from: '/a', to: '/b', verdict: 'real' },
    { slug: 'x', from: '/b', to: '/a', verdict: 'real' },
    { slug: 'x', from: '/c', to: '/a', verdict: 'spurious' },
  ]
  const verdicts = { a: { target: 'yes', shown: 'yes' }, b: { target: 'yes', shown: 'no', reason: 'not on /b' }, c: { target: 'no', shown: 'no' } }
  const r = compare(items, verdicts, read, new Set(['x /a /b']))
  assert.deepEqual(r.real, { items: 2, agree: 1, disagree: 1, undecided: 0, unanswered: 0, seen: 1, seenAgree: 1 })
  assert.deepEqual(r.decoy, { items: 1, agree: 1, disagree: 0, undecided: 0, unanswered: 0, seen: 0, seenAgree: 0 })
  assert.equal(r.rows.find((x) => x.id === 'b').reason, 'not on /b')
})
