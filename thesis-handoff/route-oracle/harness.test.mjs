// Regression tests for the measurement harness, each pinned to a defect a panel found in it.
//
// The harness scripts are command-line programs that read a corpus, so these tests run them on
// fixtures built in a temporary directory: a graph written to a SQLite database, the source
// lines its witnesses cite, a result file. Each test says which finding it is the proof of.
//
// Run from the repository root, naming the file (a bare `vitest run` would also pick up the two
// older test scripts here, which are not vitest files):
//   pnpm -s exec vitest run thesis-handoff/route-oracle/harness.test.mjs
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { lostGuard, namedGuards } from './guard-resolve.mjs'
import { extractorStamp } from './provenance.mjs'
import { conversion, judgedSites, pct1 } from './report-counts.mjs'
import { MUTANTS, applyMutant, mutationProblems } from './sweep-mutants.mjs'
import { readingProblems } from './tier-reading.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

let counter = 0
/** A fresh directory under the test's temporary root. */
function dir(name = 'd') {
  const d = path.join(TMP, `${name}-${counter += 1}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** Writes `files` ({ relative path: text }) under `root`. */
function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
}

/** Writes `graph` to a harness database at `file`, where the scripts read it from. */
function writeGraph(file, graph) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('create table docs (key text primary key, json text)')
  db.prepare('insert into docs values (?, ?)').run('graph', JSON.stringify(graph))
  db.close()
}

/** Runs a harness script under node, or under tsx for the ones that import the TypeScript packages. */
function run(script, args, { tsx = false, cwd = HERE, env = {} } = {}) {
  const [cmd, pre] = tsx ? ['pnpm', ['-s', 'exec', 'tsx']] : ['node', []]
  return execFileSync(cmd, [...pre, path.join(HERE, script), ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } })
}

/** The failure of a script that is expected to refuse: its exit status and everything it printed. */
function refusal(script, args, opts) {
  try {
    run(script, args, opts)
  } catch (e) {
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
  return null
}

const macro = (tex, name) => new RegExp(`\\\\newcommand\\{\\\\${name}\\}\\{([^}]*)\\}`).exec(tex)?.[1]

describe('witness-check (code panel 24): a must witness whose destination it cannot read is not clean', () => {
  /** A one-line template per witness, and a must edge from /a to each node the line is said to reach. */
  function fixture() {
    const app = dir('app')
    put(app, {
      'src/a.html': [
        `<a [routerLink]="'/sm-landing'">read as a literal</a>`,
        `<a [routerLink]="getTarget()">a method, unreadable</a>`,
        `<a [routerLink]="'/elsewhere'">a literal that disagrees</a>`,
      ].join('\n'),
    })
    const witness = (line) => ({ file: 'src/a.html', loc: { line }, ruleId: 'ng.router-link', modality: 'must', source: 'static' })
    const edge = (to, line) => ({ from: 'a', to, event: 'click', modality: 'must', source: 'static', witness: witness(line) })
    const graph = {
      nodes: [
        { id: 'a', kind: 'screen', route: '/a' }, { id: 'sm', kind: 'screen', route: '/sm-landing' },
        { id: 'w', kind: 'screen', route: '/workloads' }, { id: 'x', kind: 'screen', route: '/here' },
      ],
      edges: [edge('sm', 1), edge('w', 2), edge('x', 3)],
    }
    const db = path.join(app, 'uigraph.db')
    writeGraph(db, graph)
    const out = path.join(app, 'out.json')
    run('witness-check.mjs', [app, db, '--json', out])
    return JSON.parse(fs.readFileSync(out, 'utf8'))
  }

  it('reads a quoted string literal in a bound [routerLink] and compares it with the edge', () => {
    const r = fixture()
    // The literal that agrees is clean and the one that disagrees is a mismatch; before the
    // literal was read both were skipped and counted clean.
    expect(r.tally.TARGET_MISMATCH).toBe(1)
    expect(r.mustBad.map((f) => f.at)).toEqual(['src/a.html:3'])
  })

  it('records a target it cannot read as its own verdict and counts the edge apart from the failures', () => {
    const r = fixture()
    expect(r.tally.TARGET_UNREAD).toBe(1)
    expect(r.mustUnread).toBe(1)
    // One edge fails; the unread one is neither a failure nor counted as clean by the failure count.
    expect(r.mustEdges).toBe(3)
    expect(r.mustClean).toBe(2)
  })
})

describe('witness-check (review of code panel 24): a commands array with no literal segment names no address', () => {
  /** Four must edges, each citing a dynamic or half-dynamic array, and the result the check writes for them. */
  function fixture() {
    const app = dir('app')
    put(app, {
      'src/a.html': [
        `<a [routerLink]="[target]">no literal at all</a>`,
        `<a [routerLink]="['/', id]">only a root and a parameter</a>`,
        `<a [routerLink]="['/workloads', id]">a literal head</a>`,
      ].join('\n'),
      'src/a.ts': `this.router.navigate([target])\n`,
    })
    const edge = (to, file, line, ruleId) => ({ from: 'a', to, event: 'click', modality: 'must', source: 'static', witness: { file, loc: { line }, ruleId, modality: 'must', source: 'static' } })
    const db = path.join(app, 'uigraph.db')
    writeGraph(db, {
      nodes: [{ id: 'a', kind: 'screen', route: '/a' }, { id: 'w', kind: 'screen', route: '/workloads' }, { id: 'wid', kind: 'screen', route: '/workloads/:id' }],
      edges: [edge('w', 'src/a.html', 1, 'ng.router-link'), edge('w', 'src/a.html', 2, 'ng.router-link'), edge('wid', 'src/a.html', 3, 'ng.router-link'), edge('w', 'src/a.ts', 1, 'ng.navigate')],
    })
    const out = path.join(app, 'out.json')
    run('witness-check.mjs', [app, db, '--json', out])
    return JSON.parse(fs.readFileSync(out, 'utf8'))
  }

  it('records such an array as unread instead of letting `/:param` agree with any one-segment destination', () => {
    const r = fixture()
    // `/:param` matched /workloads, so before the fix all four edges passed and none was unread.
    expect(r.tally.TARGET_UNREAD).toBe(3)
    expect(r.mustUnread).toBe(3)
    expect(r.mustBad).toEqual([])
  })

  it('still reads an array with a literal head as an address, and compares it', () => {
    const r = fixture()
    expect(r.findings.filter((f) => f.at === 'src/a.html:3')).toEqual([])
  })
})

describe('must-witness (code panel 24 and 30)', () => {
  const APPS = ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']
  function witnessDir() {
    const d = dir('witness')
    for (const app of APPS) {
      const body = { mustEdges: 10, mustClean: 10, mustUnread: app === 'k8sdash' ? 4 : 0, sitesCited: 100, mergedSites: 25, destinationsChecked: true }
      fs.writeFileSync(path.join(d, `${app}.json`), JSON.stringify(body))
    }
    return d
  }

  it('emits the number of unread edges beside the violations', () => {
    const d = witnessDir()
    const tex = path.join(d, 'out.tex')
    run('must-witness.mjs', ['--dir', d, '--tex', tex])
    const out = fs.readFileSync(tex, 'utf8')
    expect(macro(out, 'MustWitnessViolations')).toBe('0')
    expect(macro(out, 'MustWitnessUnread')).toBe('4')
  })

  it('refuses a witness result that did not count its unread edges', () => {
    const d = witnessDir()
    const f = path.join(d, 'mifos.json')
    const r = JSON.parse(fs.readFileSync(f, 'utf8'))
    delete r.mustUnread
    fs.writeFileSync(f, JSON.stringify(r))
    const refused = refusal('must-witness.mjs', ['--dir', d, '--tex', path.join(d, 'out.tex')])
    expect(refused?.output).toMatch(/mifos.*could not read/)
  })

  it('names the merged share for what it counts, which is citations', () => {
    const d = witnessDir()
    const tex = path.join(d, 'out.tex')
    run('must-witness.mjs', ['--dir', d, '--tex', tex])
    const out = fs.readFileSync(tex, 'utf8')
    expect(macro(out, 'WitnessMergedCitationShareAll')).toBe('25.0\\,\\%')
    expect(macro(out, 'WitnessMergedCitationShareMax')).toBe('25.0\\,\\%')
    expect(macro(out, 'WitnessMergedCitationShareRealworld')).toBe('25.0\\,\\%')
    expect(out).not.toMatch(/WitnessMergedShare/)
  })
})

describe('tier-reading gate (code panel 8 and 32)', () => {
  const graph = (to) => ({
    nodes: [{ id: 'a', kind: 'screen', route: '/a' }, { id: 'b', kind: 'screen', route: '/b' }, { id: 'c', kind: 'screen', route: '/c' }],
    edges: [
      { from: 'a', to: 'b', modality: 'must', witness: { file: 'x.html', loc: { line: 3 }, modality: 'must' } },
      ...(to ? [{ from: 'a', to, modality: 'must', witness: { file: 'x.html', loc: { line: 3 }, modality: 'must' } }] : []),
    ],
  })
  const reading = (targets, extra = []) => ({
    sites: [{ app: 'app', site: 'x.html:3', targets, verdict: 'must' }, ...extra],
  })

  it('accepts a reading whose targets are the destinations of the must edges citing the construct', () => {
    expect(readingProblems(reading(['/b']), 'app', graph())).toEqual([])
  })

  it('refuses a listed construct that now reaches a destination the reading does not record', () => {
    const problems = readingProblems(reading(['/b']), 'app', graph('c'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/x\.html:3.*\[\/b\].*\[\/b, \/c\]/)
  })

  it('refuses a recorded target that no must edge reaches', () => {
    expect(readingProblems(reading(['/b', '/c']), 'app', graph())).toHaveLength(1)
  })

  it('refuses a listed construct that no longer earns must, so the reading cannot go stale', () => {
    const stale = reading(['/b'], [{ app: 'app', site: 'gone.html:9', targets: ['/b'], verdict: 'must' }])
    expect(readingProblems(stale, 'app', graph()).join()).toMatch(/gone\.html:9 is listed but earns no must edge/)
  })

  it('refuses a must construct the reading does not list', () => {
    expect(readingProblems({ sites: [] }, 'app', graph()).join()).toMatch(/does not list, e\.g\. x\.html:3/)
  })

  it('on a graph the reading was not made on, tolerates fewer constructs and fewer targets but not more', () => {
    const wider = reading(['/b', '/c'], [{ app: 'app', site: 'gone.html:9', targets: ['/b'], verdict: 'must' }])
    expect(readingProblems(wider, 'app', graph(), { exact: false })).toEqual([])
    expect(readingProblems(reading(['/b']), 'app', graph('c'), { exact: false })).toHaveLength(1)
  })

  describe('a construct that attribution demotes from must to may (review of code panel 8)', () => {
    /** The graph the reading is made on: attribution holds the construct at may, so it earns no must edge. */
    const attributed = () => ({ ...graph(), edges: graph().edges.map((e) => ({ ...e, modality: 'may', witness: { ...e.witness, modality: 'may' } })) })
    const unattributed = { sites: [{ app: 'app', site: 'x.html:3', targets: ['/b'], verdict: 'must-unattributed' }] }

    it('can be listed so that the exact check on the attributed graph and the subset check on the unattributed graph both pass', () => {
      // Listed as `must` the exact check refuses it as earning no must edge, and unlisted the subset check refuses it.
      expect(readingProblems(unattributed, 'app', attributed())).toEqual([])
      expect(readingProblems(unattributed, 'app', graph(), { exact: false })).toEqual([])
      expect(readingProblems(reading(['/b']), 'app', attributed()).join()).toMatch(/x\.html:3 is listed but earns no must edge/)
      expect(readingProblems({ sites: [] }, 'app', graph(), { exact: false }).join()).toMatch(/does not list/)
    })

    it('is refused on the attributed graph if it earns a must edge there after all, and on the subset check if it reaches an unrecorded address', () => {
      expect(readingProblems(unattributed, 'app', graph()).join()).toMatch(/x\.html:3 is listed as must only without attribution but earns a must edge here/)
      expect(readingProblems(unattributed, 'app', graph('c'), { exact: false }).join()).toMatch(/x\.html:3.*\[\/b\].*\[\/b, \/c\]/)
    })
  })
})

describe('graph-census (code panel 8 and 32): the census refuses a tier its reading does not describe', () => {
  const APPS = { realworld: '.', alfresco: 'projects/aca-content', ghostfolio: 'apps/client', k8sdash: 'modules/web', bitwarden: 'apps/web', mifos: '.' }

  /** A corpus of six one-edge graphs, each with the single must construct x.html:3 reaching /b, and the reading that lists them. */
  function corpus({ extraTarget, readingTargets = ['/b'], extraRow } = {}) {
    const root = dir('census')
    for (const [slug, sub] of Object.entries(APPS)) {
      const w = { file: 'x.html', loc: { line: 3 }, modality: 'must' }
      const edges = [{ from: 'a', to: 'b', modality: 'must', witness: w }]
      if (extraTarget && slug === 'k8sdash') edges.push({ from: 'a', to: 'c', modality: 'must', witness: w })
      writeGraph(path.join(root, slug, sub, 'uigraph.db'), {
        nodes: [{ id: 'a', kind: 'screen', route: '/a' }, { id: 'b', kind: 'screen', route: '/b' }, { id: 'c', kind: 'screen', route: '/c' }],
        edges,
      })
    }
    const sites = Object.keys(APPS).map((app) => ({ app, site: 'x.html:3', targets: readingTargets, verdict: 'must' }))
    const readingFile = path.join(root, 'reading.json')
    fs.writeFileSync(readingFile, JSON.stringify({ sites: extraRow ? [...sites, extraRow] : sites }))
    return { root, readingFile }
  }
  const census = (c, ...more) => run('graph-census.mjs', ['--corpus', c.root, '--reading', c.readingFile, ...more])

  it('passes when every listed construct reaches the destinations its reading records', () => {
    expect(() => census(corpus())).not.toThrow()
  })

  it('refuses a listed construct that has come to reach another destination', () => {
    const c = corpus({ extraTarget: true })
    const refused = refusal('graph-census.mjs', ['--corpus', c.root, '--reading', c.readingFile])
    expect(refused?.output).toMatch(/k8sdash: x\.html:3: the reading says it reaches \[\/b\] but the must edges citing it reach \[\/b, \/c\]/)
  })

  it('refuses a listed construct that earns no must edge, unless the graph is one the reading was not made on', () => {
    const c = corpus({ extraRow: { app: 'mifos', site: 'gone.html:9', targets: ['/b'], verdict: 'must' } })
    expect(refusal('graph-census.mjs', ['--corpus', c.root, '--reading', c.readingFile])?.output).toMatch(/mifos: gone\.html:9 is listed but earns no must edge/)
    expect(() => census(c, '--reading-subset')).not.toThrow()
  })

  it('passes both censuses for a construct that only the graph without attribution holds at must', () => {
    // Attribution holds x.html:3 at may; without it the construct earns must. One reading has to satisfy the exact
    // census of the attributed corpus and the subset census of the plain one, which a `must` row cannot.
    const build = (modality) => {
      const root = dir('census')
      for (const [slug, sub] of Object.entries(APPS)) {
        const w = { file: 'x.html', loc: { line: 3 }, modality }
        writeGraph(path.join(root, slug, sub, 'uigraph.db'), {
          nodes: [{ id: 'a', kind: 'screen', route: '/a' }, { id: 'b', kind: 'screen', route: '/b' }],
          edges: [{ from: 'a', to: 'b', modality, witness: w }],
        })
      }
      return root
    }
    const readingFile = path.join(dir('reading'), 'reading.json')
    fs.writeFileSync(readingFile, JSON.stringify({ sites: Object.keys(APPS).map((app) => ({ app, site: 'x.html:3', targets: ['/b'], verdict: 'must-unattributed' })) }))
    expect(() => run('graph-census.mjs', ['--corpus', build('may'), '--reading', readingFile])).not.toThrow()
    expect(() => run('graph-census.mjs', ['--corpus', build('must'), '--reading', readingFile, '--reading-subset'])).not.toThrow()
  })
})

describe('scope-ablation (code panel 25 and prose panel 1)', () => {
  const level = (sites, pairs) => ({ sites, pairs, edges: 0, nodes: 0, mean: 0 })
  const row = (slug, screens, full, cls, extra) => ({
    slug, screens, classOnly: 0, fullOnly: 0, classOnlySites: 0, fullOnlySites: 0, ...extra,
    levels: { owned: level(1, 1), nesting: level(1, 1), rooted: level(1, 1), outlet: level(1, 1), full, class: cls },
  })
  /** The arguments that re-emit the tables from `rows` without extracting anything. */
  function fromArgs(rows) {
    const d = dir('ablation')
    fs.writeFileSync(path.join(d, 'rows.json'), JSON.stringify({ rows }))
    return { args: ['--corpus', d, '--out', path.join(d, 'out'), '--from', path.join(d, 'rows.json'), '--tex', path.join(d, 'out.tex')], tex: path.join(d, 'out.tex') }
  }
  function emit(rows) {
    const { args, tex } = fromArgs(rows)
    run('scope-ablation.mjs', args, { tsx: true })
    return fs.readFileSync(tex, 'utf8')
  }

  it('states the call graph as full against class, in sites, pairs and the site sets that differ', () => {
    const out = emit([
      row('realworld', 10, level(39, 183), level(39, 192), { classOnly: 9 }),
      row('mifos', 605, level(1312, 43113), level(1308, 43000), { fullOnly: 120, classOnly: 7, fullOnlySites: 5, classOnlySites: 1 }),
    ])
    expect(macro(out, 'AblationCallGraphNetSites')).toBe('4')
    expect(macro(out, 'AblationCallGraphNetPairs')).toBe('104')
    expect(macro(out, 'AblationCallGraphAddedSites')).toBe('5')
    expect(macro(out, 'AblationCallGraphRemovedSites')).toBe('1')
    expect(macro(out, 'AblationCallGraphNetShare')).toBe('0.3\\,\\%')
  })

  it('refuses rows measured before the site sets were compared', () => {
    const r = row('realworld', 10, level(39, 183), level(39, 183))
    delete r.fullOnlySites
    const refused = refusal('scope-ablation.mjs', fromArgs([r]).args, { tsx: true })
    expect(refused?.output).toMatch(/call graph's contribution cannot be stated/)
  })

  it('writes the width table from the full level, so it cannot disagree with the ablation', () => {
    const out = emit([
      row('realworld', 10, level(39, 183), level(39, 192)),
      row('mifos', 605, level(1312, 43113), level(1308, 43113), { fullOnlySites: 4 }),
    ])
    expect(out).toContain('realworld & 10 & 39 & 183 & 4.69 & 390 \\\\')
    expect(out).toContain('mifos & 605 & 1312 & 43113 & 32.86 & 793760 \\\\')
    expect(macro(out, 'BaselineApps')).toBe('2')
    expect(macro(out, 'BaselineFactorMax')).toBe('18.4')
    expect(macro(out, 'BaselineFactorMin')).toBe('2.1')
    expect(macro(out, 'BaselineSharpest')).toBe('mifos')
    expect(macro(out, 'BaselineSharpestAttributed')).toBe('43113')
    expect(macro(out, 'BaselineSharpestTrivial')).toBe('793760')
    expect(macro(out, 'BaselineBluntest')).toBe('realworld')
    expect(macro(out, 'BaselineBluntestShare')).toBe('47\\,\\%')
    expect(macro(out, 'BaselineMeanScopeMin')).toBe('4.7')
    expect(macro(out, 'BaselineMeanScopeMax')).toBe('32.9')
    expect(out).toContain('\\newcommand{\\TabScopeBaseline}{%')
  })
})

describe('provenance stamp (code panel 31)', () => {
  /** A repository laid out as this one is, with the data files a generator reads committed. */
  function repo() {
    const r = dir('repo')
    const git = (...args) => execFileSync('/usr/bin/git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    put(r, {
      'packages/core/src/a.ts': 'export const a = 1\n',
      'packages/core/package.json': '{"name":"core"}\n',
      'thesis-handoff/route-oracle/run.mjs': 'export {}\n',
      'thesis-handoff/route-oracle/package.json': '{"dependencies":{"ts-morph":"28.0.0"}}\n',
      'thesis-handoff/route-oracle/package-lock.json': '{"lockfileVersion":3}\n',
      'thesis-handoff/route-oracle/results-must/tier-reading.json': '{"sites":[]}\n',
      'thesis-handoff/route-oracle/results-must/review.json': '{}\n',
      'thesis-handoff/route-oracle/results-must/mutation-sweep.json': '{}\n',
      'thesis-handoff/route-oracle/ground-truth/realworld.json': '{}\n',
      'thesis-handoff/route-oracle/corpus.json': '{}\n',
      'thesis-handoff/route-oracle/round-two-graphs/realworld.json.gz': 'x',
    })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
    return { r, sha: git('rev-parse', '--short', 'HEAD').trim() }
  }
  const stamp = (sha, harness) => `% Extractor ${sha}, packages/ clean, harness ${harness} when generated.`

  it('is clean on a committed tree', () => {
    const { r, sha } = repo()
    expect(extractorStamp(r)).toBe(stamp(sha, 'clean'))
  })

  it.each([
    'results-must/tier-reading.json', 'results-must/review.json', 'results-must/mutation-sweep.json',
    'ground-truth/realworld.json', 'corpus.json', 'round-two-graphs/realworld.json.gz',
    'package.json', 'package-lock.json',
  ])('is dirty when %s, which a generator reads, is edited', (rel) => {
    const { r, sha } = repo()
    fs.appendFileSync(path.join(r, 'thesis-handoff/route-oracle', rel), 'edited')
    expect(extractorStamp(r)).toBe(stamp(sha, 'with uncommitted changes'))
  })

  it('is dirty when a new data file appears in a directory the harness reads', () => {
    const { r, sha } = repo()
    put(r, { 'thesis-handoff/route-oracle/ground-truth/alfresco.json': '{}\n' })
    expect(extractorStamp(r)).toBe(stamp(sha, 'with uncommitted changes'))
  })

  it('is dirty when a script is added in a new directory', () => {
    const { r, sha } = repo()
    put(r, { 'thesis-handoff/route-oracle/new-dir/tool.mjs': 'export {}\n' })
    expect(extractorStamp(r)).toBe(stamp(sha, 'with uncommitted changes'))
  })

  it('stays clean when only a generated result changes', () => {
    const { r, sha } = repo()
    put(r, { 'thesis-handoff/route-oracle/results-census/census.json': '{}\n' })
    expect(extractorStamp(r)).toBe(stamp(sha, 'clean'))
  })

  it('is dirty when a file under packages/ that is not code is edited (review of code panel 31)', () => {
    const { r, sha } = repo()
    fs.appendFileSync(path.join(r, 'packages/core/package.json'), ' ')
    expect(extractorStamp(r)).toBe(`% Extractor ${sha}, packages/ with uncommitted changes, harness clean when generated.`)
  })

  it('is dirty when a new non-code file appears under packages/', () => {
    const { r, sha } = repo()
    put(r, { 'packages/core/vitest.config.json': '{}\n' })
    expect(extractorStamp(r)).toBe(`% Extractor ${sha}, packages/ with uncommitted changes, harness clean when generated.`)
  })

  it('stays clean when a run of the extractor leaves a graph database under packages/', () => {
    const { r, sha } = repo()
    put(r, { 'packages/core/uigraph.db': 'x', 'packages/core/test-fixtures/app/uigraph-mutate.db': 'x', 'packages/core/uigraph.db-journal': 'x' })
    expect(extractorStamp(r)).toBe(stamp(sha, 'clean'))
  })
})

describe('REMOVE_GUARD detection (code panel 33)', () => {
  const change = (before, after) => `/a -> /b: guard ${before}->${after}, modality may->may`

  it('reads a factory called with arguments as the name the extractor prints for it', () => {
    expect(namedGuards('canActivate: [organizationPermissionsGuard(canAccessSettingsTab), organizationIsUnmanaged],'))
      .toEqual({ names: ['organizationPermissionsGuard()', 'organizationIsUnmanaged'], complete: true })
    expect(namedGuards('canActivate: [f(a, b), a.b(c)],')).toEqual({ names: ['f()', 'a.b()'], complete: true })
  })

  it('does not call a list complete when an element is written from a hash or a position', () => {
    expect(namedGuards('canActivate: [() => inject(X).ok(), A],')).toEqual({ names: ['A'], complete: false })
  })

  it('does not name a chained call, which the extractor prints with only its last callee (review of code panel 33)', () => {
    // The extractor writes `roleGuard('admin').and(authGuard)` as `roleGuard('admin').and()`; naming it
    // `roleGuard()` would score a real loss of that guard WRONG and exclude the mutant.
    expect(namedGuards(`canActivate: [roleGuard('admin').and(authGuard)],`)).toEqual({ names: [], complete: false })
    expect(namedGuards('canActivate: [factory(a, b).x(c), A],')).toEqual({ names: ['A'], complete: false })
    expect(namedGuards('canActivate: [a.b(c)(d)],')).toEqual({ names: [], complete: false })
  })

  it('counts the lost guard only when the removed list names it', () => {
    expect(lostGuard([change('x,y', 'x')], ['y'])).toBe(true)
    // The edge lost y; the list removed z. That is some other change, not a detection.
    expect(lostGuard([change('x,y', 'x')], ['z'])).toBe(false)
    expect(lostGuard([change('x,y', 'x')], null)).toBe(true)
  })

  it('still counts guards rather than looking them up', () => {
    expect(lostGuard([change('f(),f(),f()', 'f(),f()')], ['f()'])).toBe(true)
    expect(lostGuard([change('x', 'x,y')], ['y'])).toBe(false)
    expect(lostGuard([change('null', 'x')], ['x'])).toBe(false)
  })

  it('stores every guard change of a mutant and the harness version that stored it', () => {
    // A route five screens link to, so removing its guard changes five edges where 1.7.0 kept four.
    const app = dir('mutapp')
    put(app, {
      'src/app.routes.ts': [
        `import { Routes } from '@angular/router'`,
        `import { HomeComponent } from './home.component'`,
        `import { AdminComponent } from './admin.component'`,
        `import { AdminGuard } from './admin.guard'`,
        `export const routes: Routes = [`,
        ...['', 'a', 'b', 'c', 'd'].map((p) => `  { path: '${p}', component: HomeComponent },`),
        `  { path: 'admin', component: AdminComponent, canActivate: [AdminGuard] },`,
        `]`,
      ].join('\n'),
      'src/home.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'app-home', template: '<a routerLink="/admin">admin</a>' })\nexport class HomeComponent {}\n`,
      'src/admin.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'app-admin', template: '<a routerLink="/">home</a>' })\nexport class AdminComponent {}\n`,
      'src/admin.guard.ts': `import { Injectable } from '@angular/core'\n@Injectable()\nexport class AdminGuard { canActivate() { return true } }\n`,
    })
    const git = (...args) => execFileSync('/usr/bin/git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
    const out = path.join(app, 'rq4.json')
    const cli = `pnpm -s --dir ${ROOT} exec tsx ${path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts')}`
    run('mutate.mjs', [app, app, '--quota', '8', '--json', out], { env: { UIGRAPH_MAP: cli } })
    const r = JSON.parse(fs.readFileSync(out, 'utf8'))
    const guard = r.results.find((x) => x.kind === 'REMOVE_GUARD')
    // Not '1.8.0' alone: run-all.mjs is at 1.8.0 too, and the thesis prints this string as \HarnessVersionMutation.
    expect(r.harnessVersion).toBe('mutate 1.8.0')
    expect(guard.verdict).toBe('DETECTED')
    expect(guard.delta.guardChanged).toHaveLength(5)
  }, 180000)

  describe('scores a removal by whether the lost guard is one the removed list names (review of code panel 33)', () => {
    /**
     * An application whose route file guards /admin with `[AdminGuard]`, mapped by a stand-in for the
     * extractor: with the guard list in the source the edge into /admin carries `before`, and with it
     * removed `after`. The stand-in lets a removal lose a guard other than the one removed, which no
     * route file the real extractor reads makes it do.
     */
    function removal(before, after) {
      const app = dir('guardapp')
      put(app, {
        'src/app.routes.ts': [
          `export const routes: Routes = [`,
          `  { path: 'admin', component: AdminComponent, canActivate: [AdminGuard] },`,
          `]`,
        ].join('\n'),
      })
      const mapper = path.join(dir('mapper'), 'map.mjs')
      put(path.dirname(mapper), {
        'map.mjs': [
          `import { DatabaseSync } from 'node:sqlite'`,
          `import fs from 'node:fs'`,
          `const arg = (n) => process.argv[process.argv.indexOf(n) + 1]`,
          `const guarded = fs.readFileSync(arg('map') + '/src/app.routes.ts', 'utf8').includes('canActivate')`,
          `const graph = {`,
          `  nodes: [{ id: 'home', kind: 'screen', route: '/', label: 'HomeComponent' }, { id: 'admin', kind: 'screen', route: '/admin', label: 'AdminComponent' }],`,
          `  edges: [{ from: 'home', to: 'admin', event: 'click', guard: guarded ? process.env.BEFORE : process.env.AFTER, modality: 'may', witness: { file: 'src/home.html', loc: { line: 1 } } }],`,
          `}`,
          `fs.rmSync(arg('--out'), { force: true })`,
          `const db = new DatabaseSync(arg('--out'))`,
          `db.exec('create table docs (key text primary key, json text)')`,
          `db.prepare('insert into docs values (?, ?)').run('graph', JSON.stringify(graph))`,
          `db.close()`,
        ].join('\n'),
      })
      const git = (...args) => execFileSync('/usr/bin/git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
      git('init', '-q')
      git('add', '-A')
      git('commit', '-q', '-m', 'init')
      const out = path.join(app, 'rq4.json')
      run('mutate.mjs', [app, app, '--quota', '8', '--json', out], { env: { UIGRAPH_MAP: `node ${mapper}`, BEFORE: before, AFTER: after } })
      return JSON.parse(fs.readFileSync(out, 'utf8')).results.find((x) => x.kind === 'REMOVE_GUARD')
    }

    it('calls it WRONG when the edge loses some other guard', () => {
      // The list removed is [AdminGuard]; the edge went from AdminGuard,OtherGuard to AdminGuard, so it lost OtherGuard.
      const guard = removal('AdminGuard,OtherGuard', 'AdminGuard')
      expect(guard.delta.guardChanged).toHaveLength(1)
      expect(guard.verdict).toBe('WRONG')
    })

    it('calls it DETECTED when the edge loses the guard the list names', () => {
      expect(removal('AdminGuard,OtherGuard', 'OtherGuard').verdict).toBe('DETECTED')
    })
  })
})

describe('compare.mjs (prose panel 3 and 6)', () => {
  const RAW_CLASSES = { realworld: ['ATTRIBUTION_SHARED', 'ATTRIBUTION_SHARED'], bitwarden: ['CONVERTED_MUST', 'CONVERTED_MUST', 'CONVERTED_MUST', 'ATTRIBUTION_SHARED'] }
  const AFTER_CLASSES = { realworld: ['CONVERTED_MUST', 'CONVERTED_MAY'], bitwarden: ['CONVERTED_MUST', 'CONVERTED_MAY', 'CONVERTED_MAY', 'ATTRIBUTION_SHARED'] }
  const DIAG = { realworld: { 'service (not in this version)': 0 }, bitwarden: { 'scoped; target resolves': 1 } }

  /** One run directory: results.json, raw/<slug>.L.json for every application, and the diagnosis. */
  function run1(label, classes, withDiag, over = {}) {
    const d = dir(label)
    const results = Object.entries(classes).map(([slug, cls]) => {
      const must = cls.filter((c) => c === 'CONVERTED_MUST').length
      fs.mkdirSync(path.join(d, 'raw'), { recursive: true })
      fs.writeFileSync(path.join(d, 'raw', `${slug}.L.json`), JSON.stringify({ rows: cls.map((c, i) => ({ at: `f.ts:${i + 1}`, cls: c })) }))
      if (withDiag) fs.writeFileSync(path.join(d, 'raw', `${slug}.diag.json`), JSON.stringify(DIAG[slug] ?? {}))
      const tally = Object.fromEntries([...new Set(cls)].map((c) => [c, cls.filter((x) => x === c).length]))
      return { slug, totalConstructs: cls.length, conversion: must / cls.length, loss: { constructs: cls.length, tally }, graph: { edges: 10 }, testB: { mustClean: 1, mustEdges: 1 }, ...over }
    })
    fs.writeFileSync(path.join(d, 'results.json'), JSON.stringify({ provenance: { extractor: { sha: 'abc' }, harnessVersion: 'x' }, results }))
    return d
  }

  it('counts the applications whose conversion falls, names them, and counts the must-to-may moves', () => {
    const before = run1('before', RAW_CLASSES, false)
    const after = run1('after', AFTER_CLASSES, true)
    const tex = path.join(before, 'out.tex')
    run('compare.mjs', [before, after, '--tex', tex])
    const out = fs.readFileSync(tex, 'utf8')
    expect(macro(out, 'AttrAppsGained')).toBe('1')
    expect(macro(out, 'AttrAppsFell')).toBe('1')
    expect(macro(out, 'AttrFellWhere')).toBe('bitwarden')
    expect(macro(out, 'AttrDemoted')).toBe('2')
    // Moving from must to may leaves the converted classes, so nothing regressed.
    expect(macro(out, 'AttrRegressed')).toBe('0')
  })

  it('prints a conversion from the counts, not from the ratio results.json already rounded (prose 38)', () => {
    // 1 of 26 is 3.846 %: the plot prints 3.8, and rounding the stored 0.0385 a second time gave 3.9 here.
    const same = { realworld: ['CONVERTED_MUST', ...Array(25).fill('LAZY_BOUNDARY')] }
    const before = run1('before', same, false, { conversion: 0.0385 })
    const after = run1('after', same, true, { conversion: 0.0385 })
    const tex = path.join(before, 'out.tex')
    run('compare.mjs', [before, after, '--tex', tex])
    const out = fs.readFileSync(tex, 'utf8')
    expect(out).toContain('realworld & 3.8\\% & 3.8\\% & +0.0 &')
    expect(out).not.toContain('3.9')
    expect(pct1(1, 26)).toBe('3.8')
  })

  it('counts the remaining constructs the diagnosis gives no reason for', () => {
    const before = run1('before', RAW_CLASSES, false)
    const after = run1('after', AFTER_CLASSES, true)
    const tex = path.join(before, 'out.tex')
    run('compare.mjs', [before, after, '--tex', tex])
    const out = fs.readFileSync(tex, 'utf8')
    expect(macro(out, 'AttrRemaining')).toBe('1')
    expect(macro(out, 'AttrRemainingUnexplained')).toBe('1')
  })
})

describe('expansion-check (prose panel 32)', () => {
  it('counts the applications on which the library materialises a larger set than the query', () => {
    // An edge out of a node that is no screen: the query walks screens only, the library every node.
    const d = dir('exp')
    const db = path.join(d, 'corpus', 'app', 'uigraph.db')
    writeGraph(db, {
      nodes: [{ id: 's', kind: 'screen', route: '/s' }, { id: 't', kind: 'screen', route: '/t' }, { id: 'u', kind: 'unplaced' }],
      edges: [
        { from: 's', to: 't', event: 'click', modality: 'must' },
        { from: 'u', to: 't', event: 'click', modality: 'may' },
      ],
    })
    const tex = run('expansion-check.mts', [db, '--tex'], { tsx: true })
    expect(macro(tex, 'ExpansionApps')).toBe('1')
    expect(macro(tex, 'ExpansionLibraryLarger')).toBe('1')
  })
})

describe('to-plots (prose panel 38 and 39)', () => {
  const ledger = (tally) => ({ constructs: Object.values(tally).reduce((a, b) => a + b, 0), tally })
  const app = (slug, tally) => ({ slug, totalConstructs: ledger(tally).constructs, conversion: 0, loss: ledger(tally), testC: { coverage: 1 } })
  const write = (name, results) => {
    const f = path.join(dir('plots'), name)
    fs.writeFileSync(f, JSON.stringify({ provenance: { extractor: { sha: 'abc' }, harnessVersion: 'x', label: name }, results }))
    return f
  }

  it('draws a conversion from the counts, so 2 of 1344 is 0.1 and not 0.2', () => {
    const mifos = app('mifos', { CONVERTED_MUST: 2, ATTRIBUTION_SHARED: 1342 })
    // The ratio results.json stores is rounded to four places already; 0.0015 doubles to 0.2 if rounded again.
    mifos.conversion = 0.0015
    const tex = run('to-plots.mjs', [write('b.json', [mifos]), write('a.json', [mifos])])
    expect(tex).toContain('(mifos,0.1)')
    expect(tex).not.toContain('(mifos,0.2)')
  })

  it('draws every outcome, so the bars of the loss plot reach 100 per cent', () => {
    const gf = app('ghostfolio', { CONVERTED_MUST: 55, ATTRIBUTION_SHARED: 72, ACCOUNTED_DYNAMIC: 50, EXCLUDED_NAMED_OUTLET: 7, QUERY_ONLY: 14 })
    const tex = run('to-plots.mjs', [write('b.json', [gf]), write('a.json', [gf])])
    const bar = (label) => Number(new RegExp(`\\\\addplot\\[[^\\]]*\\] coordinates \\{\\(([0-9.]+),ghostfolio\\)\\};\\n\\\\addlegendentry\\{${label}\\}`).exec(tex)?.[1])
    const total = ['Converted', 'Attribution', 'Node defects', 'Other losses', 'Dynamic or unplaced', 'Excluded'].map(bar)
    expect(total.every(Number.isFinite)).toBe(true)
    expect(Math.round(total.reduce((a, b) => a + b, 0))).toBe(100)
    expect(bar('Dynamic or unplaced')).toBe(Number((100 * 50 / 198).toFixed(1)))
  })

  it('refuses a ledger holding an outcome no series draws', () => {
    const odd = app('ghostfolio', { CONVERTED_MUST: 1, SOMETHING_NEW: 2 })
    const refused = refusal('to-plots.mjs', [write('b.json', [odd]), write('a.json', [odd])])
    expect(refused?.output).toMatch(/ghostfolio.*SOMETHING_NEW/)
  })
})

describe('to-latex (prose panel 38): the conversion table rounds the counts once, as the figure does', () => {
  const SLUGS = ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']

  /** A results.json of the six applications, each with `must` of `all` constructs converted and a stale stored ratio. */
  function results(must, all) {
    const d = dir('tables')
    fs.mkdirSync(path.join(d, 'raw'))
    const rows = SLUGS.map((slug) => {
      fs.writeFileSync(path.join(d, 'raw', `${slug}.C.json`), JSON.stringify({ comparison: { declaredScreens: 1, graphNodes: 1, matched: 1, coverage: 1, extraNodes: [] }, blindSpots: [] }))
      const tally = { CONVERTED_MUST: must, LAZY_BOUNDARY: all - must }
      return { slug, totalConstructs: all, conversion: +(must / all).toFixed(4), graph: { nodes: 1, must: 1, may: 1 }, loss: { constructs: all, tally } }
    })
    const file = path.join(d, 'results.json')
    fs.writeFileSync(file, JSON.stringify({ provenance: { extractor: { sha: '0123456789abcdef' }, harnessVersion: 'x', startedAt: '2026-01-01T00:00:00Z' }, results: rows }))
    return file
  }

  it('prints 3.8 for 1 of 26, where rounding the stored 0.0385 again printed 3.9', () => {
    const out = run('to-latex.mjs', [results(1, 26)])
    expect(out).toContain('realworld & 26 & 1 & 1 & 1 & 3.8\\% \\\\')
    expect(out).not.toContain('3.9')
  })
})

describe('mutation sweep: the mutants are data that must apply to the adapter as it stands', () => {
  const SRC = path.join(ROOT, 'packages', 'adapter-angular', 'src')

  it('applies every mutant exactly once, so a rule that moved is found here and not by a run that tests nothing', () => {
    expect(mutationProblems(MUTANTS, (f) => fs.readFileSync(path.join(SRC, f), 'utf8'))).toEqual([])
  })

  it('refuses a find string that is gone, occurs twice or changes nothing, and an id used twice', () => {
    const files = { 'a.ts': 'x = 1\nx = 1\ny = 2\n' }
    const problems = mutationProblems([
      { id: 'a', rule: 'gone', file: 'a.ts', find: 'z = 3', replace: 'z = 4' },
      { id: 'b', rule: 'twice', file: 'a.ts', find: 'x = 1', replace: 'x = 2' },
      { id: 'c', rule: 'same', file: 'a.ts', find: 'y = 2', replace: 'y = 2' },
      { id: 'c', rule: 'again', file: 'a.ts', find: 'y = 2', replace: 'y = 3' },
    ], (f) => files[f])
    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toMatch(/gone.*occurs 0 times/)
    expect(problems.join('\n')).toMatch(/twice.*occurs 2 times/)
  })

  it('keeps the 72 mutants of the first sweep, the three that split a term, and gives each caller and each token its own', () => {
    const ids = MUTANTS.map((m) => m.id)
    for (let i = 1; i <= 72; i += 1) expect(ids).toContain(String(i))
    expect(ids).toEqual(expect.arrayContaining(['59a', '59b', '59c']))
    expect(MUTANTS.filter((m) => m.rule.startsWith('capMay:'))).toHaveLength(7)
    expect(MUTANTS.filter((m) => m.rule.startsWith('logical assignment:'))).toHaveLength(3)
  })

  it('applies a replacement literally, whatever `$` it holds', () => {
    expect(applyMutant({ find: 'a', replace: '$&b' }, 'a')).toBe('$&b')
    expect(applyMutant({ find: ['a', 'c'], replace: ['1', '2'] }, 'a c')).toBe('1 2')
  })

  it('checks the list from the command line without running a suite', () => {
    expect(run('mutation-sweep.mjs', ['--dry-run'])).toMatch(/each applies exactly once/)
  })

  describe('sweep-to-latex reads what the sweep writes', () => {
    const killed = (id) => ({ id, rule: 'r', file: 'f', result: 'Tests  1 failed | 379 passed (380)', survived: false, killedBy: 't' })
    const sweep = (extra) => {
      const f = path.join(dir('sweep'), 'sweep.json')
      fs.writeFileSync(f, JSON.stringify({ commit: 'abc1234', baseline: 'Tests  380 passed (380)', mutants: [killed('1'), killed('2')], ...extra }))
      return f
    }

    it('states the counts and the commit when every mutant was killed', () => {
      const out = run('sweep-to-latex.mjs', ['--in', sweep()])
      expect(out).toMatch(/SweepMutants\}\{2\}.*SweepAdded\}\{0\}.*SweepCommit\}\{abc1234\}/)
    })

    it('refuses a mutant that survived, one with no recorded outcome, and a partial run', () => {
      expect(refusal('sweep-to-latex.mjs', ['--in', sweep({ mutants: [killed('1'), { ...killed('2'), survived: true }] })])?.output).toMatch(/rules no test covers: 2/)
      expect(refusal('sweep-to-latex.mjs', ['--in', sweep({ mutants: [killed('1'), { ...killed('2'), survived: null }] })])?.output).toMatch(/rules no test covers: 2/)
      expect(refusal('sweep-to-latex.mjs', ['--in', sweep({ partial: true })])?.output).toMatch(/partial run/)
    })
  })
})

describe('report-counts (prose panel 38, and the round-two soundness table)', () => {
  it('takes a percentage from the counts and prints it as the figure does', () => {
    // 54,766 of the n/d with d up to 1500 differ between rounding the ratio twice and rounding the counts once.
    expect(pct1(1, 26)).toBe('3.8')
    expect(pct1(14, 17)).toBe('82.4')
    expect(conversion({ loss: { constructs: 26, tally: { CONVERTED_MUST: 1 } } }).toFixed(1)).toBe('3.8')
    expect(conversion({ loss: null })).toBeNull()
  })

  it('leaves out of the judged sites those the check reached no verdict on, so the clean share counts neither as a failure', () => {
    // 10 sites: 4 clean, 3 over-approximated, 2 unread must targets, 1 mismatch. The unread were counted as judged and not clean.
    const b = { sites: 10, clean: 4, tally: { OVER_APPROX: 3, TARGET_UNREAD: 2, TARGET_MISMATCH: 1 } }
    expect(judgedSites(b)).toBe(5)
    expect(judgedSites({ sites: 10, tally: {} })).toBe(10)
  })
})
