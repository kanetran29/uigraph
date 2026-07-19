import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateContract, matchContract, itemMatches, globToRegExp } from './gate.mjs'

const node = (over = {}) => ({
  id: 'c_products_clear_0', route: null, componentPath: 'src/pages/ProductsIndex.tsx',
  label: 'Clear filter', kind: 'control', parent: 'n_products_index',
  control: { element: 'button', controlType: 'button' }, ...over,
})
const emptyDiff = () => ({
  addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [], changedEdges: [],
})

test('itemMatches: exact, substring (~), nested control', () => {
  const spec = { kind: 'control', 'label~': 'clear filter', 'parent~': 'products', control: { controlType: 'button' } }
  assert.equal(itemMatches(spec, node()), true)
  assert.equal(itemMatches(spec, node({ label: 'Reset' })), false)
  assert.equal(itemMatches({ ...spec, control: { controlType: 'input' } }, node()), false)
})

test('matchContract: pass when every expected item matches', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { addedNodes: [{ 'label~': 'clear' }], forbidRemovals: true } }
  const diff = { ...emptyDiff(), addedNodes: [node()] }
  const res = matchContract(contract, diff)
  assert.equal(res.pass, true)
  assert.equal(res.results[0].matched, 'c_products_clear_0')
})

test('matchContract: fail when an expected node is absent', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { addedNodes: [{ 'label~': 'clear' }] } }
  const res = matchContract(contract, emptyDiff())
  assert.equal(res.pass, false)
  assert.equal(res.results[0].matched, null)
})

test('matchContract: forbidRemovals flags any removal', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { forbidRemovals: true } }
  const diff = { ...emptyDiff(), removedNodes: [node({ id: 'n_gone' })] }
  const res = matchContract(contract, diff)
  assert.equal(res.pass, false)
  assert.deepEqual(res.removalViolations, ['n_gone'])
})

test('matchContract: uncovered additions warn, fail only under strict', () => {
  const extra = node({ id: 'c_surprise', label: 'Surprise' })
  const diff = { ...emptyDiff(), addedNodes: [extra] }
  const loose = matchContract({ ticket: 'T', requirement: 'r', expect: {} }, diff)
  assert.equal(loose.pass, true)
  assert.deepEqual(loose.uncovered.nodes, ['c_surprise'])
  const strict = matchContract({ ticket: 'T', requirement: 'r', expect: { strict: true } }, diff)
  assert.equal(strict.pass, false)
})

test('matchContract: an already-claimed node cannot satisfy a second expectation', () => {
  const spec = { 'label~': 'clear' }
  const contract = { ticket: 'T', requirement: 'r', expect: { addedNodes: [spec, spec] } }
  const oneMatch = matchContract(contract, { ...emptyDiff(), addedNodes: [node()] })
  assert.equal(oneMatch.pass, false)
  assert.equal(oneMatch.results[1].matched, null)
  const twoMatches = matchContract(contract, { ...emptyDiff(), addedNodes: [node(), node({ id: 'c_products_clear_1' })] })
  assert.equal(twoMatches.pass, true)
})

test('validateContract: catches missing fields and bad pattern mode', () => {
  assert.deepEqual(validateContract({ ticket: 'T', requirement: 'r', expect: {} }), [])
  assert.ok(validateContract({}).some((e) => e.startsWith('ticket')))
  const bad = { ticket: 'T', requirement: 'r', expect: {}, code: { patterns: [{ mode: 'maybe', astGrep: 'pattern: x' }] } }
  assert.ok(validateContract(bad).some((e) => e.includes('mode')))
})

test('validateContract: unknown top-level or expect/code keys are flagged as typos, absent keys are not', () => {
  const okExpect = { ticket: 'T', requirement: 'r', expect: { forbidRemovals: true } }
  assert.deepEqual(validateContract(okExpect), [])
  const typoExpect = { ticket: 'T', requirement: 'r', expect: { forbidRemoval: true } }
  assert.ok(validateContract(typoExpect).some((e) => e === 'expect.forbidRemoval: unknown key (typo?)'))
  const typoTop = { ticket: 'T', requirement: 'r', expect: {}, bogus: 1 }
  assert.ok(validateContract(typoTop).some((e) => e === 'bogus: unknown key (typo?)'))
  const typoCode = { ticket: 'T', requirement: 'r', expect: {}, code: { impactAllows: [] } }
  assert.ok(validateContract(typoCode).some((e) => e === 'code.impactAllows: unknown key (typo?)'))
})

test('globToRegExp: ** crosses slashes, * does not', () => {
  assert.equal(globToRegExp('examples/**').test('examples/a/b.ts'), true)
  assert.equal(globToRegExp('examples/*.ts').test('examples/a/b.ts'), false)
  assert.equal(globToRegExp('examples/*.ts').test('examples/a.ts'), true)
  assert.equal(globToRegExp('file?.ts').test('file?.ts'), true)
  assert.equal(globToRegExp('abc?.ts').test('ab.ts'), false)
})

import { renderReport } from './gate.mjs'

test('renderReport: one line per verdict with status and PASS/FAIL banner', () => {
  const md = renderReport({
    ticket: 'GAU-1',
    verdicts: [
      { name: 'check-cmd', status: 'green', detail: 'exit 0' },
      { name: 'graph-match', status: 'red', detail: '1 expected node unmatched' },
      { name: 'verify', status: 'skip', detail: 'fail-fast' },
    ],
  })
  assert.ok(md.includes('# Gate report — GAU-1'))
  assert.ok(md.includes('RED'))
  assert.ok(md.includes('graph-match'))
  assert.ok(md.includes('skip'))
})

import { parseAstGrepSpec, containmentViolations } from './gate.mjs'

test('parseAstGrepSpec: rule vs pattern prefixes', () => {
  assert.deepEqual(parseAstGrepSpec('rule: rules/x.yml'), { type: 'rule', value: 'rules/x.yml' })
  assert.deepEqual(parseAstGrepSpec('pattern: setId($_)'), { type: 'pattern', value: 'setId($_)' })
})

test('containmentViolations: files outside every allow glob leak', () => {
  const allow = ['examples/sample-gauntlet-react/**']
  assert.deepEqual(containmentViolations(['examples/sample-gauntlet-react/src/a.tsx'], allow), [])
  assert.deepEqual(containmentViolations(['packages/core/src/ir.ts'], allow), ['packages/core/src/ir.ts'])
})
