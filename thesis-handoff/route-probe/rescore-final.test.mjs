// Checks that rescore-final.mjs scores exactly as scope-check.mjs did: fed the click targets each
// stored row predicted, it must reproduce every stored field of every row of every application.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { rescoreRow, summarise } from './rescore-final.mjs'

test('re-scoring the stored predictions reproduces the stored rows and totals', () => {
  for (const f of readdirSync('results').filter((x) => x.endsWith('.scope.json'))) {
    const before = JSON.parse(readFileSync(`results/${f}`, 'utf8'))
    const rows = before.rows.map((r) => {
      if (r.error) return r
      const clicks = r.predicted.map((route) => ({ to: route, confidence: r.approximated.includes(route) ? 0.5 : 1 }))
      const out = rescoreRow(r, clicks, (id) => id)
      assert.deepEqual(out, r, `${f} ${r.address}`)
      return out
    })
    const s = summarise(rows)
    for (const [k, v] of Object.entries(s)) assert.equal(v, before[k], `${f} ${k}`)
  }
})
