/**
 * Checks the head-to-head estimators on a built application.
 * Run: node --test score.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bounds, mergeReadings, pool, rates, scoreApp, wilson } from './score.mjs'

test('a stratum is estimated from its sample and each tool counts the shared stratum', () => {
  // 10 shared pairs (all 4 read real), 20 only theirs (1 of 4 read real), 40 only ours (3 of 4 real).
  const v = (stratum, verdict) => ({ stratum, verdict })
  const verdicts = [
    ...Array(4).fill(v('both', 'real')),
    v('theirs', 'real'), v('theirs', 'spurious'), v('theirs', 'spurious'), v('theirs', 'unclear'),
    v('ours', 'real'), v('ours', 'real'), v('ours', 'real'), v('ours', 'spurious'),
  ]
  const s = scoreApp({ both: 10, theirsOnly: 20, oursOnly: 40 }, verdicts)
  assert.equal(s.strata.theirs.est, 5)
  assert.equal(s.strata.ours.est, 30)
  assert.deepEqual([s.theirs.pairs, s.theirs.real], [30, 15])
  assert.deepEqual([s.ours.pairs, s.ours.real], [50, 40])
  assert.equal(s.all, 45)
  assert.deepEqual(rates(s.theirs, s.all), { precision: 0.5, recall: 15 / 45 })
  assert.deepEqual([pool([s, s]).ours.pairs, pool([s, s]).ours.real], [100, 80])
})

test('an empty stratum estimates nothing, and a missing reading is an error', () => {
  const s = scoreApp({ both: 0, theirsOnly: 0, oursOnly: 3 }, [{ stratum: 'ours', verdict: 'real' }])
  assert.equal(s.theirs.pairs, 0)
  assert.equal(rates(s.theirs, s.all).precision, null)
  assert.throws(() => mergeReadings({ a: { pairs: [{ from: '/x', to: '/y', stratum: 'both' }] } }, [], []), /no reading/)
  const [lo, hi] = wilson(5, 10)
  assert.ok(lo < 0.5 && hi > 0.5)
})

test('a hand correction supplies a reading the readers mislabelled', () => {
  const reading = { a: { pairs: [{ from: '/x', to: '/y', stratum: 'ours' }] } }
  const out = mergeReadings(reading, [{ slug: 'a', from: '/z', to: '/y', verdict: 'real' }], [], { _note: '', 'a|/x|/y': { verdict: 'spurious', site: 's:1', reason: 'r' } })
  assert.equal(out[0].verdict, 'spurious')
  assert.equal(out[0].corrected, true)
})

test('a split only-ours stratum is estimated part by part, and bounds bracket the estimate', () => {
  const v = (stratum, verdict) => ({ stratum, verdict })
  const s = scoreApp({ both: 4, theirsOnly: 4, oursOnly: 30, oursShell: 20, oursOther: 10 }, [
    v('both', 'real'), v('both', 'real'), v('theirs', 'real'), v('theirs', 'spurious'),
    v('oursShell', 'spurious'), v('oursShell', 'spurious'), v('oursOther', 'real'), v('oursOther', 'real'),
  ])
  assert.equal(s.ours.pairs, 34)
  assert.equal(s.ours.real, 4 + 0 + 10)
  const b = bounds([s])
  const r = rates(s.ours, s.all).recall
  assert.ok(b.ours.recall[0] <= r && r <= b.ours.recall[1])
  assert.ok(b.theirs.precision[0] <= rates(s.theirs, s.all).precision)
})

test('with unclearAsReal an unclear verdict counts as real, for the sensitivity scenario', () => {
  const v = (stratum, verdict) => ({ stratum, verdict })
  const verdicts = [v('both', 'real'), v('theirs', 'real'), v('theirs', 'unclear'), v('theirs', 'spurious'), v('theirs', 'spurious'), v('ours', 'unclear')]
  const strata = { both: 2, theirsOnly: 20, oursOnly: 10 }
  assert.equal(scoreApp(strata, verdicts).strata.theirs.est, 5)
  const s = scoreApp(strata, verdicts, { unclearAsReal: true })
  assert.equal(s.strata.theirs.est, 10)
  assert.equal(s.strata.ours.est, 10)
  assert.equal(s.strata.theirs.unclear, 1)
})
