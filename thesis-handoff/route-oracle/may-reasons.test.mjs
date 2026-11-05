// Tests for the may-reason census (may-reasons.mjs) on a fixture graph.
//
// Run from the repository root:
//   pnpm -s exec vitest run --maxWorkers=2 thesis-handoff/route-oracle/may-reasons.test.mjs
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { census, countApp, equivalence, macros } from './may-reasons.mjs'

const HERE = import.meta.dirname
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'may-reasons-test-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

/** A static witness at line `line` of `f.ts`, may with `reasons`, or must when `reasons` is null. */
const w = (line, reasons, file = 'f.ts') => ({ source: 'static', file, loc: { line, col: 1 }, ruleId: 'r', modality: reasons ? 'may' : 'must', ...(reasons ? { reasons } : {}) })
/** An edge led by `witness` that also cites `merged`. */
const edge = (witness, ...merged) => ({ id: `e${Math.random()}`, witness, mergedWitnesses: merged.length ? merged : undefined })

const fixture = {
  edges: [
    // line 1: two may witnesses with the same single reason -> sole 'branch'
    edge(w(1, ['under a branch']), w(1, ['under a branch'])),
    // line 2: reasons differ across its witnesses -> union, no sole
    edge(w(2, ['in a callback']), w(2, ['guard'])),
    // line 3: one witness with two reasons -> no sole; a tool reason
    edge(w(3, ['catch-all', 'under a branch'])),
    // line 4: a must witness and a may one -> not may-only
    edge(w(4, null), w(4, ['under a branch'])),
    // line 5: reached only as a merged witness of an edge led by another construct
    edge(w(9, null), w(5, ['same screen'])),
    // line 7: a dynamic-target witness is neither may nor must, so it opens no construct
    edge({ source: 'static', file: 'f.ts', loc: { line: 7, col: 1 }, ruleId: 'r', modality: 'unknown' }),
    // line 6: template condition, sole
    edge(w(6, ['structural directive'])),
    edge(w(8, ['handler not read', 'under a branch'])),
    edge(w(10, ['handler not read'])),
    edge(w(11, ['no outlet or component found', 'same screen'])),
  ],
}

describe('the may-reason census', () => {
  const r = countApp('realworld', fixture)

  it('counts a construct once however many witnesses it has, and excludes one that also witnesses a must edge', () => {
    expect(r.total).toBe(8)
  })

  it('counts a family once per construct whose union holds it, and sole when every witness has exactly that one reason', () => {
    expect(r.any).toMatchObject({ branch: 3, async: 1, guard: 1, target: 1, template: 1, sameScreen: 2, attribution: 1, reader: 2 })
    expect(r.sole).toMatchObject({ branch: 1, template: 1, async: 0, guard: 0, target: 0, sameScreen: 1, reader: 1, attribution: 0 })
  })

  it('splits application semantics, tool uncertainty and the rest', () => {
    expect(r).toMatchObject({ app: 3, tool: 4, neither: 1 })
  })

  it('counts application-any, tool-only and both apart from the three-way split', () => {
    expect(r).toMatchObject({ appAny: 5, toolOnly: 2, both: 2 })
  })

  it('adds applications and builds macros', () => {
    const c = census({ realworld: fixture, mifos: fixture })
    expect(c.totals.total).toBe(16)
    const text = macros(c).join('\n')
    expect(text).toContain('\\newcommand{\\MayOnlyConstructs}{16}')
    expect(text).toContain('\\newcommand{\\MayOnlyConstructsMifos}{8}')
    expect(text).toContain('\\newcommand{\\MayFamBranchAny}{6}')
    expect(text).toContain('\\newcommand{\\MayFamBranchSole}{2}')
    expect(text).toContain('\\newcommand{\\MayAppSemantics}{6}')
    expect(text).toContain('\\newcommand{\\MayToolOnly}{4}')
    expect(text).toContain('\\newcommand{\\MayAppAny}{10}')
    expect(text).toContain('\\newcommand{\\MayBoth}{4}')
    expect(text).toContain('\\newcommand{\\TabMayReasons}')
  })

  it('refuses a reason it does not know', () => {
    expect(() => countApp('realworld', { edges: [edge(w(1, ['a brand new reason']))] })).toThrow(/unknown may reason/)
  })

  it('refuses a may witness without reasons', () => {
    const bare = { ...w(1, ['under a branch']) }
    delete bare.reasons
    expect(() => countApp('realworld', { edges: [edge(bare)] })).toThrow(/no reasons/)
  })

  it('finds a flagged graph equal to the corpus graph once its reasons are deleted, and sees any other difference', () => {
    const stripped = JSON.parse(JSON.stringify(fixture, (k, v) => (k === 'reasons' ? undefined : v)))
    expect(equivalence(fixture, stripped)).toMatchObject({ identical: true, textIdentical: true, mayWithoutReasons: 0 })
    const changed = JSON.parse(JSON.stringify(stripped))
    changed.edges[0].witness.modality = 'must'
    expect(equivalence(fixture, changed).identical).toBe(false)
  })

  it('refuses an unknown application', () => {
    expect(() => census({ nowhere: fixture })).toThrow(/unknown application/)
  })

  it('exits non-zero from the command line on an unknown reason, and writes the macros otherwise', () => {
    let n = 0
    const db = (name, graph) => {
      const p = path.join(TMP, `${name}${n++}.db`)
      const d = new DatabaseSync(p)
      d.exec('create table docs (key text primary key, json text not null)')
      d.prepare('insert into docs values (?, ?)').run('graph', JSON.stringify(graph))
      d.close()
      return p
    }
    const run = (g, tex) => {
      try {
        return { code: 0, out: execFileSync('node', ['--no-warnings', path.join(HERE, 'may-reasons.mjs'), '--db', `realworld=${db('rw', g)}`, '--tex', tex, '--out', path.join(TMP, 'out')], { encoding: 'utf8', stdio: 'pipe' }) }
      } catch (e) {
        return { code: e.status, out: String(e.stderr) }
      }
    }
    const good = run(fixture, path.join(TMP, 'good.tex'))
    expect(good.code).toBe(0)
    expect(fs.readFileSync(path.join(TMP, 'good.tex'), 'utf8')).toContain('\\newcommand{\\MayOnlyConstructs}{8}')
    expect(fs.existsSync(path.join(TMP, 'out', 'may-reasons.json'))).toBe(true)
    const bad = run({ edges: [edge(w(1, ['mystery']))] }, path.join(TMP, 'bad.tex'))
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/unknown may reason/)
    expect(fs.existsSync(path.join(TMP, 'bad.tex'))).toBe(false)
  })
})
