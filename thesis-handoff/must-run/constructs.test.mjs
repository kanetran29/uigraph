/**
 * Checks that the construct-level count keeps each construct once across runs and ignores
 * constructs whose checks never landed. Run: node --test constructs.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedConstructs } from './constructs.mjs'

test('a construct confirmed in two runs counts once; an unconfirmed one not at all', () => {
  const runs = [
    { app: 'realworld', edges: [{ site: 'a.html:3', outcome: 'confirmed' }, { site: 'b.html:4', outcome: 'unreached' }] },
    { app: 'realworld', edges: [{ site: 'a.html:3', outcome: 'confirmed' }] },
    { app: 'mifos', edges: [{ site: 'a.html:3', outcome: 'confirmed' }] },
  ]
  assert.deepEqual([...confirmedConstructs(runs)].sort(), ['mifos:a.html:3', 'realworld:a.html:3'])
})

test('a check that landed elsewhere, did not navigate or was not rendered is reported as failed', async () => {
  const { failedChecks } = await import('./constructs.mjs')
  const runs = [{ app: 'kdash', edges: [
    { id: 'a', outcome: 'confirmed' }, { id: 'b', outcome: 'unreached' },
    { id: 'c', outcome: 'other-target' }, { id: 'd', outcome: 'no-navigation' }, { id: 'e', outcome: 'not-rendered' },
  ] }]
  assert.deepEqual(failedChecks(runs), ['kdash:c', 'kdash:d', 'kdash:e'])
})
