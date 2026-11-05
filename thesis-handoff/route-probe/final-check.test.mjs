/**
 * Checks that final-check.mjs calls a graph unchanged only when its node count and both address sets match.
 * Run: node --test final-check.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareApp } from './final-check.mjs'

test('same counts and sets in another order are the same; one changed address is not', () => {
  const f = (n, inv, mis) => ({ counts: { extractorNodes: n }, invented: inv, missed: mis })
  assert.equal(compareApp(f(3, [], ['/a', '/b']), f(3, [], ['/b', '/a'])).same, true)
  assert.equal(compareApp(f(3, [], ['/a', '/b']), f(3, [], ['/a', '/c'])).same, false)
  assert.equal(compareApp(f(3, [], []), f(3, ['/x'], [])).same, false)
  assert.equal(compareApp(f(3, [], []), f(4, [], [])).same, false)
})
