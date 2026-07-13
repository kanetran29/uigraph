// Tests for the uigraph CLI handlers (milestone M4). Per docs/20-development-cycle.md
// these drive the command BODIES as plain functions — runMap/runDiff and the API
// router — never by spawning a process. runMap is exercised against the real
// sample-react-app golden fixture; the API server is tested both as a pure router
// and once end-to-end on an ephemeral port.

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph, Witness } from '@uigraph/core'
import { openStore, saveGraph } from '@uigraph/core/node'
import type { Server } from 'node:http'
import { assertProjectDir, CliError, dbPathFor, detectAdapter, formatDiff, formatDiffSinceLast, formatMapSummary, openStoreSafe, readSoundiness, resolveAdapter, runDiff, runDiffSinceLast, runGen, runKitInstall, runKitPrint, runMap, runWorkspaceAdd, runWorkspaceList, runWorkspaceRemove, type MapSummary } from './commands'
import { buildProgram } from './cli'
import { createConfiguredServer, handleApiRequest, registryConfig, resolveShotPath, singleConfig, startApiServer, type ServeConfig } from './server'
import { readRegistry, summarize } from '@uigraph/core/node'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

/** Seed a workspace dir's SQLite store with a base graph; returns the dir. */
function seedWorkspace(dir: string, g: UiGraph): string {
  const store = openStore(dbPathFor(dir))
  store.setBaseGraph(g)
  store.close()
  return dir
}

const SAMPLE_REACT = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))

const witness: Witness = { source: 'static', file: 'x.tsx', loc: { line: 1, col: 1 }, ruleId: 'test' }

function node(id: string): GraphNode {
  return { id, route: `/${id}`, componentPath: null, label: id.toUpperCase(), kind: 'screen' }
}

function edge(id: string, from: string, to: string): GraphEdge {
  return {
    id,
    from,
    to,
    event: 'navigate',
    guard: null,
    effect: 'navigate',
    modality: 'must',
    source: 'static',
    confidence: 1,
    witness,
  }
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): UiGraph {
  return {
    version: 0,
    meta: { adapter: '@uigraph/test', adapterVersion: '0.0.0', rulesetVersion: 'test' },
    nodes,
    edges,
  }
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const openServers: Server[] = []
afterEach(async () => {
  while (openServers.length > 0) {
    const s = openServers.pop()
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
  }
})

describe('runMap', () => {
  it('extracts the sample-react-app into a loadable uigraph.db with 9 nodes', async () => {
    const out = join(tempDir('uigraph-cli-map-'), 'uigraph.db')
    const summary = await runMap({ dir: SAMPLE_REACT, adapter: 'react', out })

    expect(existsSync(out)).toBe(true)
    const store = openStore(out)
    const reloaded = store.getBaseGraph()
    store.close()
    expect(reloaded?.nodes).toHaveLength(9)
    expect(summary.nodes).toBe(9)
    expect(summary.edges).toBe(reloaded?.edges.length)
    expect(summary.must + summary.may + summary.unknown).toBe(summary.edges)
  })

  it('persists the soundiness report into the store', async () => {
    const dir = tempDir('uigraph-cli-sound-')
    const summary = await runMap({ dir: SAMPLE_REACT, adapter: 'react', out: join(dir, 'uigraph.db') })
    expect(readSoundiness(dir).length).toBe(summary.soundiness)
  })

  it('records soundiness counts grouped by category', async () => {
    const summary = await runMap({ dir: SAMPLE_REACT, adapter: 'react', out: join(tempDir('uigraph-cli-bykind-'), 'uigraph.db') })
    const total = Object.values(summary.soundinessByKind).reduce((a, b) => a + b, 0)
    expect(total).toBe(summary.soundiness)
  })
})

describe('formatMapSummary (SOUNDINESS SUMMARY block)', () => {
  const base: MapSummary = { dbPath: '/x/uigraph.db', adapter: 'react', detected: false, nodes: 3, edges: 2, must: 1, may: 1, unknown: 0, soundiness: 0, soundinessByKind: {} }

  it('omits the SOUNDINESS SUMMARY when there are no notes', () => {
    expect(formatMapSummary(base)).not.toContain('SOUNDINESS SUMMARY')
  })

  it('prints a category-grouped summary with counts and a recommendation, sorted by count', () => {
    const out = formatMapSummary({ ...base, soundiness: 15, soundinessByKind: { 'dispatch-driven-nav': 12, 'inline-jsx-route': 3 } })
    expect(out).toContain('SOUNDINESS SUMMARY')
    expect(out).toContain('12 dispatch-driven-nav')
    expect(out).toContain('3 inline-jsx-route')
    expect(out).toMatch(/runtime-verify|annotate/)
    expect(out.indexOf('dispatch-driven-nav')).toBeLessThan(out.indexOf('inline-jsx-route'))
  })
})

describe('detectAdapter (framework inference from package.json contents)', () => {
  const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) =>
    JSON.stringify({ dependencies: deps, devDependencies: devDeps })

  it('detects next from a `next` dependency (wins over the react it pulls in)', () => {
    expect(detectAdapter(pkg({ next: '14.0.0', react: '18.0.0', 'react-dom': '18.0.0' }))).toEqual({ adapter: 'next' })
  })

  it('detects angular from an @angular/* dependency', () => {
    expect(detectAdapter(pkg({ '@angular/core': '17.0.0', '@angular/router': '17.0.0' }))).toEqual({ adapter: 'angular' })
  })

  it('detects vue from vue / vue-router', () => {
    expect(detectAdapter(pkg({ vue: '3.0.0', 'vue-router': '4.0.0' }))).toEqual({ adapter: 'vue' })
  })

  it('detects react from react-router (and from plain react)', () => {
    expect(detectAdapter(pkg({ react: '18.0.0', 'react-router-dom': '6.0.0' }))).toEqual({ adapter: 'react' })
    expect(detectAdapter(pkg({ react: '18.0.0' }))).toEqual({ adapter: 'react' })
  })

  it('reads devDependencies too', () => {
    expect(detectAdapter(pkg({}, { vue: '3.0.0' }))).toEqual({ adapter: 'vue' })
  })

  it('returns the candidate list when ambiguous (no clear single framework)', () => {
    const r = detectAdapter(pkg({ vue: '3.0.0', '@angular/core': '17.0.0' }))
    expect(r).not.toBeNull()
    expect('ambiguous' in r!).toBe(true)
    expect((r as { ambiguous: string[] }).ambiguous.sort()).toEqual(['angular', 'vue'])
  })

  it('returns null for no supported framework and for malformed JSON', () => {
    expect(detectAdapter(pkg({ lodash: '4.0.0' }))).toBeNull()
    expect(detectAdapter('not json {')).toBeNull()
  })
})

describe('resolveAdapter (explicit vs auto-detect, actionable errors)', () => {
  it('honors an explicit adapter without reading package.json', () => {
    expect(resolveAdapter('/does/not/matter', 'angular')).toEqual({ adapter: 'angular', detected: false })
  })

  it('auto-detects from the project package.json when --adapter is omitted', () => {
    const dir = tempDir('uigraph-detect-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { vue: '3.0.0', 'vue-router': '4.0.0' } }))
    expect(resolveAdapter(dir)).toEqual({ adapter: 'vue', detected: true })
  })

  it('errors with the candidates listed when detection is ambiguous', () => {
    const dir = tempDir('uigraph-detect-ambig-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { vue: '3.0.0', '@angular/core': '17.0.0' } }))
    expect(() => resolveAdapter(dir)).toThrow(CliError)
    expect(() => resolveAdapter(dir)).toThrow(/ambiguous/)
    expect(() => resolveAdapter(dir)).toThrow(/--adapter/)
  })

  it('errors actionably when there is no package.json', () => {
    expect(() => resolveAdapter(tempDir('uigraph-detect-nopkg-'))).toThrow(/no package.json/)
  })

  it('errors actionably when no supported framework is found', () => {
    const dir = tempDir('uigraph-detect-none-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '4.0.0' } }))
    expect(() => resolveAdapter(dir)).toThrow(/could not detect/)
  })
})

describe('runMap auto-detection + formatMapSummary empty-graph guidance', () => {
  it('runMap with no --adapter auto-detects react and flags it as detected', async () => {
    const dir = tempDir('uigraph-map-autodetect-')
    cpSync(SAMPLE_REACT, dir, { recursive: true })
    const summary = await runMap({ dir, out: join(tempDir('uigraph-map-autodetect-out-'), 'g.db'), register: false })
    expect(summary.adapter).toBe('react')
    expect(summary.detected).toBe(true)
    expect(formatMapSummary(summary)).toContain('auto-detected from package.json')
  })

  it('formatMapSummary prints empty-graph guidance pointing at verify when 0 edges', () => {
    const base: MapSummary = { dbPath: '/x/uigraph.db', adapter: 'react', detected: false, nodes: 2, edges: 0, must: 0, may: 0, unknown: 0, soundiness: 0, soundinessByKind: {} }
    const out = formatMapSummary(base)
    expect(out).toContain('NO EDGES EXTRACTED')
    expect(out).toMatch(/dispatch-driven|dynamic/)
    expect(out).toContain('uigraph verify')
  })

  it('empty-graph guidance references the SOUNDINESS SUMMARY when notes exist', () => {
    const base: MapSummary = { dbPath: '/x/uigraph.db', adapter: 'react', detected: false, nodes: 2, edges: 0, must: 0, may: 0, unknown: 0, soundiness: 3, soundinessByKind: { 'dispatch-driven-nav': 3 } }
    expect(formatMapSummary(base)).toContain('see the SOUNDINESS SUMMARY above')
  })

  it('omits empty-graph guidance when edges exist', () => {
    const base: MapSummary = { dbPath: '/x/uigraph.db', adapter: 'react', detected: false, nodes: 2, edges: 1, must: 1, may: 0, unknown: 0, soundiness: 0, soundinessByKind: {} }
    expect(formatMapSummary(base)).not.toContain('NO EDGES EXTRACTED')
  })
})

describe('runDiff / formatDiff', () => {
  it('reports an added edge between two graphs', () => {
    const dir = tempDir('uigraph-cli-diff-')
    const aPath = join(dir, 'a.json')
    const bPath = join(dir, 'b.json')
    saveGraph(aPath, graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    saveGraph(bPath, graph([node('a'), node('b')], [edge('e_ab', 'a', 'b'), edge('e_ba', 'b', 'a')]))

    const diff = runDiff({ a: aPath, b: bPath })
    expect(diff.addedEdges.map((e) => e.id)).toEqual(['e_ba'])
    expect(formatDiff(diff)).toContain('+ edge e_ba')
  })

  it('reports a changed edge field', () => {
    const dir = tempDir('uigraph-cli-diff2-')
    const aPath = join(dir, 'a.json')
    const bPath = join(dir, 'b.json')
    const e1 = edge('e_ab', 'a', 'b')
    const e2: GraphEdge = { ...e1, event: 'click', modality: 'may', confidence: 0.5 }
    saveGraph(aPath, graph([node('a'), node('b')], [e1]))
    saveGraph(bPath, graph([node('a'), node('b')], [e2]))

    const diff = runDiff({ a: aPath, b: bPath })
    expect(diff.changedEdges).toHaveLength(1)
    expect(diff.changedEdges[0]?.fields.sort()).toEqual(['confidence', 'event', 'modality'])
    expect(formatDiff(diff)).toContain('~ edge e_ab')
  })

  it('reports no differences for identical graphs', () => {
    const dir = tempDir('uigraph-cli-diff3-')
    const aPath = join(dir, 'a.json')
    const bPath = join(dir, 'b.json')
    const g = graph([node('a')], [])
    saveGraph(aPath, g)
    saveGraph(bPath, g)
    expect(formatDiff(runDiff({ a: aPath, b: bPath }))).toBe('No differences.')
  })
})

describe('runDiffSinceLast / formatDiffSinceLast (temporal "since last map" diff)', () => {
  // Seed a workspace db with two successive maps (g1 @ t1 rotated to previous, g2 @ t2 current).
  function seedTwoMaps(prefix: string, g1: UiGraph, t1: string, g2: UiGraph, t2: string): string {
    const dir = tempDir(prefix)
    const store = openStore(dbPathFor(dir))
    const fp = (mappedAt: string) => ({ projectDir: dir, adapter: 'react', hash: 'h', files: {}, mappedAt })
    store.setBaseGraph(g1)
    store.setFingerprint(fp(t1))
    store.snapshotCurrentAsPrevious()
    store.setBaseGraph(g2)
    store.setFingerprint(fp(t2))
    store.close()
    return dir
  }
  // Seed a single map (no rotation) at the given timestamp.
  function seedOneMap(prefix: string, g: UiGraph, at: string): string {
    const dir = seedWorkspace(tempDir(prefix), g)
    const store = openStore(dbPathFor(dir))
    store.setFingerprint({ projectDir: dir, adapter: 'react', hash: 'h', files: {}, mappedAt: at })
    store.close()
    return dir
  }

  it('no-current: a never-mapped workspace', () => {
    const r = runDiffSinceLast(tempDir('uigraph-since-empty-'))
    expect(r.state).toBe('no-current')
    expect(formatDiffSinceLast(r)).toMatch(/uigraph map/)
  })

  it('no-prior: mapped exactly once', () => {
    const r = runDiffSinceLast(seedOneMap('uigraph-since-one-', graph([node('a')], []), '2026-02-02T00:00:00Z'))
    expect(r.state).toBe('no-prior')
    expect(formatDiffSinceLast(r)).toMatch(/no previous|re-map/i)
  })

  it('ok + added edge: reports the delta, both timestamps, and the reused per-change body', () => {
    const g1 = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])
    const g2 = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b'), edge('e_ba', 'b', 'a')])
    const r = runDiffSinceLast(seedTwoMaps('uigraph-since-add-', g1, 'T1', g2, 'T2'))
    expect(r.state).toBe('ok')
    expect(r.diff?.addedEdges.map((e) => e.id)).toEqual(['e_ba'])
    const out = formatDiffSinceLast(r)
    expect(out).toContain('previous: T1')
    expect(out).toContain('current:  T2')
    expect(out).toContain('+ edge e_ba')
  })

  it('ok + no changes: identical re-map shows both timestamps and "No changes"', () => {
    const g1 = graph([node('a')], [])
    const r = runDiffSinceLast(seedTwoMaps('uigraph-since-same-', g1, 'T1', g1, 'T2'))
    expect(r.state).toBe('ok')
    expect(formatDiffSinceLast(r)).toContain('No changes to the proven UI graph')
  })

  it('renders an unknown previous timestamp when the prior graph predated fingerprinting', () => {
    const dir = tempDir('uigraph-since-unknown-')
    const store = openStore(dbPathFor(dir))
    store.setBaseGraph(graph([node('a')], []))
    store.snapshotCurrentAsPrevious()
    store.setBaseGraph(graph([node('a'), node('b')], []))
    store.setFingerprint({ projectDir: dir, adapter: 'react', hash: 'h', files: {}, mappedAt: 'T2' })
    store.close()
    const r = runDiffSinceLast(dir)
    expect(r.previousMappedAt).toBeNull()
    expect(formatDiffSinceLast(r)).toContain('previous: unknown')
  })

  it('runMap rotation: a second map over the same dir leaves a previous to compare against', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-since-remap-'))
    cpSync(SAMPLE_REACT, dir, { recursive: true })
    await runMap({ dir, adapter: 'react', register: false })
    await runMap({ dir, adapter: 'react', register: false })
    const r = runDiffSinceLast(dir)
    expect(r.state).toBe('ok')
    // two distinct map timestamps -> rotation captured the first map as previous
    expect(r.previousMappedAt).not.toBeNull()
    expect(r.previousMappedAt).not.toBe(r.currentMappedAt)
  })
})

describe('runGen (codegen)', () => {
  it('renders a Playwright spec for a planned path from the workspace db', () => {
    const dir = seedWorkspace(tempDir('uigraph-cli-gen-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    const sum = runGen({ dir, from: 'a', to: 'b', baseUrl: 'http://x' })
    expect(sum.legs).toBe(1)
    expect(sum.spec).toContain("import { test, expect } from '@playwright/test'")
    expect(sum.spec).toContain('await page.goto(')
    expect(sum.spec).toContain('toHaveURL("http://x/b")')
  })

  it('throws on an unsupported framework', () => {
    const dir = seedWorkspace(tempDir('uigraph-cli-gen2-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    expect(() => runGen({ dir, from: 'a', to: 'b', framework: 'cypress' })).toThrow(/unsupported framework/)
  })
})

describe('runVerify (Tier-3 runner)', () => {
  it('attempts worklist targets via a driver and records observations (confirmed -> runtime edge)', async () => {
    const { runVerify } = await import('./runner')
    // a -> b is a may edge (uncertain) -> a verify target.
    const g = graph([node('a'), node('b')], [{ ...edge('e_ab', 'a', 'b'), source: 'static', modality: 'may', guard: 'x' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-verify-'), g)
    const summary = await runVerify({ dir, appUrl: 'http://x', limit: 10, driver: async () => ({ confirmed: true, screenshot: 'shots/e.png', evidence: { kind: 'url-assert', url: 'http://x/b' } as const }) })
    expect(summary.attempted).toBe(1)
    expect(summary.confirmed).toBe(1)
    // the observation was recorded + (confirmed) folds into a runtime edge on read
    const store = openStore(dbPathFor(dir))
    const obs = store.getObservations()
    store.close()
    expect(obs).toHaveLength(1)
    expect(obs[0]?.outcome).toBe('confirmed')
    expect(obs[0]?.screenshot).toBe('shots/e.png')
  })

  it('verify --all drives must-static proofs and flags a refuted proven edge', async () => {
    const { runVerify } = await import('./runner')
    const g = graph([node('a'), node('b')], [{ ...edge('e_ab', 'a', 'b'), source: 'static' as const, modality: 'must' as const }])
    const dir = seedWorkspace(tempDir('uigraph-cli-all-'), g)
    const none = await runVerify({ dir, appUrl: 'http://x', driver: async () => ({ confirmed: false }) })
    expect(none.attempted).toBe(0)
    const sweep = await runVerify({ dir, appUrl: 'http://x', includeProven: true, driver: async () => ({ confirmed: false }) })
    expect(sweep.attempted).toBe(1)
    expect(sweep.refutedProven).toBe(1)
    const ok = await runVerify({ dir, appUrl: 'http://x', includeProven: true, driver: async () => ({ confirmed: true, evidence: { kind: 'url-assert', url: 'http://x/b' } as const }) })
    expect(ok.confirmed).toBe(1)
    expect(ok.refutedProven).toBe(0)
  })

  it('records NOTHING for an undrivable plan — never a false refutation', async () => {
    const { runVerify } = await import('./runner')
    const g = graph([node('a'), node('b')], [{ ...edge('e_ab', 'a', 'b'), source: 'static', modality: 'may', guard: 'x' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-undrivable-'), g)
    const summary = await runVerify({ dir, appUrl: 'http://x', limit: 10, driver: async () => ({ confirmed: false, undrivable: true }) })
    expect(summary.confirmed).toBe(0)
    expect(summary.refuted).toBe(0)
    const store = openStore(dbPathFor(dir))
    expect(store.getObservations()).toHaveLength(0)
    store.close()
  })

  it('until-done never parks a target the limit excluded from attempts', async () => {
    const { runVerifyUntilDone } = await import('./runner')
    const g = graph(
      [node('a'), node('b'), node('c'), node('d')],
      [
        { ...edge('e_ab', 'a', 'b'), source: 'static' as const, modality: 'may' as const, guard: 'x' },
        { ...edge('e_ac', 'a', 'c'), source: 'static' as const, modality: 'may' as const, guard: 'y' },
        { ...edge('e_ad', 'a', 'd'), source: 'static' as const, modality: 'may' as const, guard: 'z' },
      ],
    )
    const dir = seedWorkspace(tempDir('uigraph-cli-limitpark-'), g)
    // limit 1: only the top-ranked target is attempted each round; driver never confirms
    await runVerifyUntilDone({ dir, appUrl: 'http://x', limit: 1, maxRounds: 1, parkTries: 1, driver: async () => ({ confirmed: false }) })
    const store = openStore(dbPathFor(dir))
    const parkedInRound = store.getParkedEdges().filter((p) => p.reason.includes('attempts'))
    store.close()
    expect(parkedInRound.length).toBeLessThanOrEqual(1)
  })

  it('records a refuted observation when the driver does not confirm', async () => {
    const { runVerify } = await import('./runner')
    const g = graph([node('a'), node('b')], [{ ...edge('e_ab', 'a', 'b'), source: 'static', modality: 'may', guard: 'x' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-verify2-'), g)
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async () => ({ confirmed: false }) })
    expect(summary.refuted).toBe(1)
  })
})

describe('handleApiRequest (pure router)', () => {
  function workspace(): string {
    return seedWorkspace(tempDir('uigraph-cli-api-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
  }

  it('GET /api/graph returns the merged graph', () => {
    const dir = workspace()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/graph', body: undefined })
    expect(res.status).toBe(200)
    expect((res.body as UiGraph).nodes).toHaveLength(2)
  })

  it('GET /api/soundiness returns [] when no report exists', () => {
    const dir = workspace()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/soundiness', body: undefined })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('POST /api/overlay applies an overlay edit and surfaces it in /api/graph', () => {
    const dir = workspace()
    const post = handleApiRequest(
      { dir },
      { method: 'POST', path: '/api/overlay', body: { op: { kind: 'addEdge', edge: edge('e_ba', 'b', 'a') } } },
    )
    expect(post.status).toBe(200)

    const after = handleApiRequest({ dir }, { method: 'GET', path: '/api/graph', body: undefined })
    const merged = after.body as UiGraph
    const added = merged.edges.find((e) => e.id === 'e_ba')
    expect(added?.source).toBe('manual')
  })

  it('returns 404 for an unknown route', () => {
    const dir = workspace()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/nope', body: undefined })
    expect(res.status).toBe(404)
  })

  it('returns 400 when an overlay edit is structurally malformed', () => {
    const dir = workspace()
    const { event: _event, ...malformed } = edge('e_bad', 'a', 'b')
    const res = handleApiRequest(
      { dir },
      { method: 'POST', path: '/api/overlay', body: { op: { kind: 'addEdge', edge: malformed } } },
    )
    expect(res.status).toBe(400)
  })
})

describe('recall-first read routes (state / cases / frontier)', () => {
  // a -> b proven (static must); a -> u_a unknown (dynamic sink) -> a is on the frontier.
  function workspace(): string {
    const u: GraphNode = { id: 'u_a', route: null, componentPath: null, label: 'dyn', kind: 'unknown' }
    return seedWorkspace(
      tempDir('uigraph-cli-recall-'),
      graph([node('a'), node('b'), u], [edge('e_ab', 'a', 'b'), { ...edge('e_au', 'a', 'u_a'), modality: 'unknown' }]),
    )
  }

  it('GET /api/state/:id returns the state + its trust-tiered cases (404 on unknown id)', () => {
    const dir = workspace()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/state/a', body: undefined })
    expect(res.status).toBe(200)
    const body = res.body as { id: string; cases: { toNode: string; trustTier: string }[] }
    expect(body.id).toBe('a')
    expect(body.cases.find((c) => c.toNode === 'b')?.trustTier).toBe('proven')
    expect(body.cases.find((c) => c.toNode === 'u_a')?.trustTier).toBe('unknown')
    expect(handleApiRequest({ dir }, { method: 'GET', path: '/api/state/nope', body: undefined }).status).toBe(404)
  })

  it('GET /api/cases applies from / minTier query filters', () => {
    const dir = workspace()
    const all = handleApiRequest({ dir }, { method: 'GET', path: '/api/cases', body: undefined, query: new URLSearchParams() })
    expect((all.body as { total: number }).total).toBe(2)
    const proven = handleApiRequest({ dir }, { method: 'GET', path: '/api/cases', body: undefined, query: new URLSearchParams({ minTier: 'proven' }) })
    const body = proven.body as { total: number; cases: { trustTier: string }[] }
    expect(body.total).toBe(1)
    expect(body.cases[0]?.trustTier).toBe('proven')
    const fromB = handleApiRequest({ dir }, { method: 'GET', path: '/api/cases', body: undefined, query: new URLSearchParams({ from: 'b' }) })
    expect((fromB.body as { total: number }).total).toBe(0)
  })

  it('GET /api/frontier returns the known-unknowns, with an optional state filter', () => {
    const dir = workspace()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/frontier', body: undefined })
    const ids = (res.body as { nodes: { id: string }[] }).nodes.map((n) => n.id)
    expect(ids).toContain('a')
    const filtered = handleApiRequest({ dir }, { method: 'GET', path: '/api/frontier', body: undefined, query: new URLSearchParams({ state: 'a' }) })
    expect((filtered.body as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual(['a'])
  })
})

describe('GET /api/changes (temporal diff over the serve API)', () => {
  it('returns state no-prior for a one-map workspace', () => {
    const dir = seedWorkspace(tempDir('uigraph-changes-one-'), graph([node('a')], []))
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/changes', body: undefined })
    expect(res.status).toBe(200)
    expect((res.body as { state: string }).state).toBe('no-prior')
  })

  it('returns the diff + both timestamps for a two-map workspace', () => {
    const dir = tempDir('uigraph-changes-two-')
    const store = openStore(dbPathFor(dir))
    const fp = (mappedAt: string) => ({ projectDir: dir, adapter: 'react', hash: 'h', files: {}, mappedAt })
    store.setBaseGraph(graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    store.setFingerprint(fp('T1'))
    store.snapshotCurrentAsPrevious()
    store.setBaseGraph(graph([node('a'), node('b')], [edge('e_ab', 'a', 'b'), edge('e_ba', 'b', 'a')]))
    store.setFingerprint(fp('T2'))
    store.close()
    const res = handleApiRequest({ dir }, { method: 'GET', path: '/api/changes', body: undefined })
    const body = res.body as { state: string; diff: { addedEdges: { id: string }[] }; previousMappedAt: string; currentMappedAt: string }
    expect(body.state).toBe('ok')
    expect(body.diff.addedEdges.map((e) => e.id)).toEqual(['e_ba'])
    expect(body.previousMappedAt).toBe('T1')
    expect(body.currentMappedAt).toBe('T2')
  })
})

describe('resolveShotPath (proposal evidence screenshots)', () => {
  it('resolves an existing shot and rejects traversal / non-shot / missing paths', () => {
    const dir = tempDir('uigraph-cli-shots-')
    mkdirSync(join(dir, 'shots'))
    writeFileSync(join(dir, 'shots', 'n_root.jpeg'), 'jpegbytes')
    expect(resolveShotPath(dir, '/api/shots/n_root.jpeg')).toBe(join(dir, 'shots', 'n_root.jpeg'))
    expect(resolveShotPath(dir, '/api/shots/missing.jpeg')).toBeNull()
    expect(resolveShotPath(dir, '/api/shots/..%2f..%2fui-graph.json')).toBeNull()
    expect(resolveShotPath(dir, '/api/graph')).toBeNull()
  })
})

describe('startApiServer (end-to-end on an ephemeral port)', () => {
  it('serves GET /api/graph as JSON over HTTP', async () => {
    const dir = seedWorkspace(tempDir('uigraph-cli-http-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))

    const { server, url } = await startApiServer({ dir, port: 0 })
    openServers.push(server)

    const res = await fetch(`${url}/api/graph`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as UiGraph
    expect(body.nodes).toHaveLength(2)
    expect(body.edges.map((e) => e.id)).toEqual(['e_ab'])
  })
})

describe('multi-workspace serve (registry routing + security boundary)', () => {
  // Two seeded workspaces behind a synthetic ServeConfig: 'a' has 2 nodes, 'b' has 1.
  function twoWorkspaceConfig(): { config: ServeConfig; dirA: string; dirB: string } {
    const dirA = seedWorkspace(tempDir('uigraph-ws-a-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    const dirB = seedWorkspace(tempDir('uigraph-ws-b-'), graph([node('c')], []))
    const byId: Record<string, string> = { a: dirA, b: dirB }
    const config: ServeConfig = {
      resolveDir: (ws) => (ws === null ? dirA : (byId[ws] ?? null)),
      workspaces: () => [
        { id: 'a', name: 'A', adapter: 'react', available: true },
        { id: 'b', name: 'B', adapter: 'next', available: true },
      ],
    }
    return { config, dirA, dirB }
  }

  it('routes ?ws to the matching workspace graph, defaults null ws to the first', async () => {
    const { config } = twoWorkspaceConfig()
    const server = createConfiguredServer(config)
    openServers.push(server)
    const { port } = await new Promise<{ port: number }>((resolve) =>
      server.listen(0, () => resolve({ port: (server.address() as { port: number }).port })),
    )
    const base = `http://localhost:${port}`

    const ga = (await (await fetch(`${base}/api/graph?ws=a`)).json()) as UiGraph
    const gb = (await (await fetch(`${base}/api/graph?ws=b`)).json()) as UiGraph
    const gDefault = (await (await fetch(`${base}/api/graph`)).json()) as UiGraph
    expect(ga.nodes).toHaveLength(2)
    expect(gb.nodes).toHaveLength(1)
    expect(gDefault.nodes).toHaveLength(2)
  })

  it('serves the built dashboard (static index + SPA fallback) alongside the ?ws-routed API', async () => {
    const { config } = twoWorkspaceConfig()
    const staticDir = tempDir('uigraph-static-')
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>uigraph dashboard</title>')
    const server = createConfiguredServer(config, staticDir)
    openServers.push(server)
    const { port } = await new Promise<{ port: number }>((resolve) =>
      server.listen(0, () => resolve({ port: (server.address() as { port: number }).port })),
    )
    const base = `http://localhost:${port}`

    const index = await fetch(base)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('uigraph dashboard')
    const spa = await fetch(`${base}/some/spa/route`)
    expect(await spa.text()).toContain('uigraph dashboard')
    const ws = (await (await fetch(`${base}/api/workspaces`)).json()) as unknown[]
    expect(ws).toHaveLength(2)
    const gb = (await (await fetch(`${base}/api/graph?ws=b`)).json()) as UiGraph
    expect(gb.nodes).toHaveLength(1)
  })

  it('dash serves multiple projects: its <dir> argument is optional (registry mode)', () => {
    const dash = buildProgram().commands.find((c) => c.name() === 'dash')
    expect(dash).toBeDefined()
    expect(dash?.registeredArguments[0]?.required).toBe(false)
  })

  it('GET /api/workspaces returns client-safe summaries with NO absolute dir', async () => {
    const { config } = twoWorkspaceConfig()
    const server = createConfiguredServer(config)
    openServers.push(server)
    const { port } = await new Promise<{ port: number }>((resolve) =>
      server.listen(0, () => resolve({ port: (server.address() as { port: number }).port })),
    )
    const list = (await (await fetch(`http://localhost:${port}/api/workspaces`)).json()) as Array<Record<string, unknown>>
    expect(list.map((w) => w.id)).toEqual(['a', 'b'])
    expect(list.every((w) => !('dir' in w))).toBe(true)
  })

  it('404s an unknown ws id and a traversal-shaped ws id (opaque id never builds a path)', async () => {
    const { config } = twoWorkspaceConfig()
    const server = createConfiguredServer(config)
    openServers.push(server)
    const { port } = await new Promise<{ port: number }>((resolve) =>
      server.listen(0, () => resolve({ port: (server.address() as { port: number }).port })),
    )
    const base = `http://localhost:${port}`
    expect((await fetch(`${base}/api/graph?ws=nope`)).status).toBe(404)
    expect((await fetch(`${base}/api/graph?ws=${encodeURIComponent('../../etc/passwd')}`)).status).toBe(404)
  })

  it('singleConfig regression: ignores ?ws, serves the one dir, empty switcher list', () => {
    const dir = seedWorkspace(tempDir('uigraph-ws-single-'), graph([node('a')], []))
    const config = singleConfig(dir)
    expect(config.resolveDir(null)).toBe(dir)
    expect(config.resolveDir('anything')).toBe(dir)
    expect(config.workspaces()).toEqual([])
  })
})

describe('workspace registry CLI (UIGRAPH_HOME isolated)', () => {
  let home: string
  afterEach(() => {
    delete process.env.UIGRAPH_HOME
    if (home) rmSync(home, { recursive: true, force: true })
  })
  function isolatedHome(): void {
    home = tempDir('uigraph-home-')
    process.env.UIGRAPH_HOME = home
  }
  // A throwaway copy of the react fixture so default-path runMap writes its db into temp, never the repo.
  function fixtureCopy(): string {
    const dst = tempDir('uigraph-fixture-')
    cpSync(SAMPLE_REACT, dst, { recursive: true })
    return dst
  }

  it('runMap auto-registers the workspace under its canonical dir', async () => {
    isolatedHome()
    await runMap({ dir: fixtureCopy(), adapter: 'react' })
    const reg = readRegistry()
    expect(reg.workspaces).toHaveLength(1)
    expect(reg.workspaces[0]?.adapter).toBe('react')
    expect(summarize(reg, () => true)[0]).not.toHaveProperty('dir')
  })

  it('--no-register (register:false) leaves the registry empty', async () => {
    isolatedHome()
    await runMap({ dir: fixtureCopy(), adapter: 'react', register: false })
    expect(readRegistry().workspaces).toHaveLength(0)
  })

  it('--out (custom db path) does not auto-register', async () => {
    isolatedHome()
    await runMap({ dir: SAMPLE_REACT, adapter: 'react', out: join(tempDir('uigraph-out-'), 'g.db') })
    expect(readRegistry().workspaces).toHaveLength(0)
  })

  it('add then remove round-trips through the registry; registryConfig resolves the live db', async () => {
    isolatedHome()
    const dir = seedWorkspace(tempDir('uigraph-ws-reg-'), graph([node('a')], []))
    const e = runWorkspaceAdd(dir, 'react', 'My App')
    expect(runWorkspaceList().entries.map((w) => w.id)).toContain(e.id)
    expect(registryConfig().resolveDir(e.id)).toBe(e.dir)
    runWorkspaceRemove(e.id)
    expect(runWorkspaceList().entries).toHaveLength(0)
    expect(registryConfig().resolveDir(e.id)).toBeNull()
  })
})

describe('runKit (agent kit)', () => {
  it('print emits the kit including the golden invariant and tool names', () => {
    const out = runKitPrint()
    expect(out).toContain('Golden invariant')
    expect(out).toContain('reconciliation loop')
    expect(out).toContain('report_observation')
  })

  it('install copies the kit files under .uigraph/kit/', () => {
    const dir = tempDir('uigraph-cli-kit-')
    const { written } = runKitInstall({ dir })
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((p) => existsSync(p))).toBe(true)
    expect(existsSync(join(dir, '.uigraph', 'kit', 'SKILL.md'))).toBe(true)
  })

  it('install --claude drops a single SKILL.md skill', () => {
    const dir = tempDir('uigraph-cli-kit-claude-')
    const { written } = runKitInstall({ dir, claude: true })
    expect(written).toEqual([join(dir, '.claude', 'skills', 'uigraph', 'SKILL.md')])
    expect(existsSync(written[0]!)).toBe(true)
  })
})

describe('runVerifyUntilDone (autonomous 100%-accounted loop)', () => {
  it('drives, parks the undrivable remainder, and reaches loopDone within the round cap', async () => {
    const { runVerifyUntilDone } = await import('./runner')
    // two may edges; a->b is direct-nav (confirmable by goto), a->c is guarded
    // (parked — a bare goto must not witness it, per the Tier-3 soundness fix)
    const g = graph(
      [node('a'), node('b'), node('c')],
      [
        { ...edge('e_ab', 'a', 'b'), modality: 'may', source: 'static', guard: null },
        { ...edge('e_ac', 'a', 'c'), modality: 'may', source: 'static', guard: 'y' },
      ],
    )
    const dir = seedWorkspace(tempDir('uigraph-cli-untildone-'), g)
    const s = await runVerifyUntilDone({
      dir,
      appUrl: 'http://x',
      maxRounds: 5,
      parkTries: 2,
      driver: async (plan) => ({ confirmed: plan.legs.some((l) => l.action.kind === 'goto') && JSON.stringify(plan).includes('/b') }),
    })
    expect(s.loopDone).toBe(true)
    expect(s.accountedRatio).toBe(1)
    // honest: not everything was runtime-verified — a->c got parked, not faked
    expect(s.runtimeRatio).toBeLessThan(1)
    expect(s.parkedEdges).toBeGreaterThanOrEqual(1)
    expect(s.rounds).toBeLessThanOrEqual(5)

    // the park is auditable + the proven graph was never edited to fake it
    const store = openStore(dbPathFor(dir))
    const parked = store.getParkedEdges()
    store.close()
    expect(parked.some((p) => p.edgeId === 'e_ac' && p.by === 'runner')).toBe(true)
  })

  it('terminates even when the driver never confirms anything (no infinite loop)', async () => {
    const { runVerifyUntilDone } = await import('./runner')
    const g = graph([node('a'), node('b')], [{ ...edge('e_ab', 'a', 'b'), modality: 'unknown', source: 'static' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-untildone2-'), g)
    const s = await runVerifyUntilDone({ dir, appUrl: 'http://x', maxRounds: 4, parkTries: 2, driver: async () => ({ confirmed: false }) })
    expect(s.loopDone).toBe(true)
    expect(s.rounds).toBeLessThanOrEqual(4)
    expect(s.runtimeRatio).toBe(0)
    expect(s.accountedRatio).toBe(1)
  })
})

describe('runVerify — dynamic-sink resolution (capture mode)', () => {
  const uNode = (id: string): GraphNode => ({ id, route: null, componentPath: null, label: 'dynamic', kind: 'unknown' })

  it('captures the real landing, mints a CONCRETE edge, and never reports from->u_sink', async () => {
    const { runVerify } = await import('./runner')
    const g = graph(
      [node('a'), node('b'), uNode('u_a')],
      [{ ...edge('e_au', 'a', 'u_a'), modality: 'unknown', source: 'static' }],
    )
    const dir = seedWorkspace(tempDir('uigraph-cli-dyn-'), g)
    // capture driver lands on /b (node 'b')
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async (_p, appUrl, opts) => (opts?.capture ? { confirmed: true, landedUrl: `${appUrl}/b`, evidence: { kind: 'url-change', startUrl: `${appUrl}/a`, landedUrl: `${appUrl}/b` } as const } : { confirmed: false }) })
    expect(summary.resolvedDynamic).toBe(1)

    const store = openStore(dbPathFor(dir))
    const obs = store.getObservations()
    const merged = (await import('@uigraph/mcp')).loadMergedGraph({ dir })
    store.close()
    // a CONCRETE runtime edge a->b was minted; NO observation ever targeted the u_ sink
    expect(merged.edges.some((e) => e.from === 'a' && e.to === 'b' && e.source === 'runtime')).toBe(true)
    expect(obs.every((o) => o.to !== 'u_a')).toBe(true)
  })

  it('parks the u_ edge (specific reason) when no navigation fires', async () => {
    const { runVerify } = await import('./runner')
    const g = graph([node('a'), uNode('u_a')], [{ ...edge('e_au', 'a', 'u_a'), modality: 'unknown', source: 'static' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-dyn2-'), g)
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async () => ({ confirmed: false }) })
    expect(summary.parkedDynamic).toBe(1)
    const store = openStore(dbPathFor(dir))
    const parked = store.getParkedEdges()
    store.close()
    expect(parked[0]?.edgeId).toBe('e_au')
    expect(parked[0]?.reason).toMatch(/did not fire|no URL change/)
  })

  it('discovers an undeclared landing as a new node, then mints the edge', async () => {
    const { runVerify } = await import('./runner')
    const g = graph([node('a'), uNode('u_a')], [{ ...edge('e_au', 'a', 'u_a'), modality: 'unknown', source: 'static' }])
    const dir = seedWorkspace(tempDir('uigraph-cli-dyn3-'), g)
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async (_p, appUrl, opts) => (opts?.capture ? { confirmed: true, landedUrl: `${appUrl}/surprise`, evidence: { kind: 'url-change', startUrl: `${appUrl}/a`, landedUrl: `${appUrl}/surprise` } as const } : { confirmed: false }) })
    expect(summary.discoveredNodes).toBe(1)
    const merged = (await import('@uigraph/mcp')).loadMergedGraph({ dir })
    expect(merged.nodes.some((n) => n.route === '/surprise')).toBe(true)
    expect(merged.edges.some((e) => e.from === 'a' && e.source === 'runtime')).toBe(true)
  })
})

describe('crash-safety: input validation + actionable errors (no raw stacks)', () => {
  it('assertProjectDir: rejects a missing dir with a CliError that names the path', () => {
    const missing = join(tmpdir(), 'uigraph-does-not-exist-' + Date.now())
    expect(() => assertProjectDir(missing)).toThrow(CliError)
    expect(() => assertProjectDir(missing)).toThrow(/directory not found/)
    expect(() => assertProjectDir(missing)).toThrow(missing)
  })

  it('assertProjectDir: rejects a file passed where a directory is expected', () => {
    const dir = tempDir('uigraph-notadir-')
    const file = join(dir, 'a-file.txt')
    writeFileSync(file, 'x')
    expect(() => assertProjectDir(file)).toThrow(CliError)
    expect(() => assertProjectDir(file)).toThrow(/not a directory/)
  })

  it('runMap: a missing project dir is a CliError, not a raw ENOENT', async () => {
    const missing = join(tmpdir(), 'uigraph-map-missing-' + Date.now())
    await expect(runMap({ dir: missing, adapter: 'react', register: false, out: join(tempDir('uigraph-out-'), 'g.db') })).rejects.toThrow(CliError)
  })

  it('openStoreSafe: a corrupt database is an actionable CliError, not a raw sqlite stack', () => {
    const dir = tempDir('uigraph-corrupt-')
    const dbPath = join(dir, 'uigraph.db')
    writeFileSync(dbPath, 'this is not a sqlite database, just garbage bytes')
    let thrown: unknown
    try {
      openStoreSafe(dbPath)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CliError)
    expect((thrown as Error).message).toContain('cannot open workspace database')
    expect((thrown as Error).message).toContain(dbPath)
    expect((thrown as Error).message).toMatch(/corrupt|locked/)
  })

  it('runMap: a corrupt output db surfaces as a CliError (downstream throw is wrapped, never raw)', async () => {
    const dir = tempDir('uigraph-map-corrupt-')
    const out = join(dir, 'out.db')
    writeFileSync(out, 'not a database')
    await expect(runMap({ dir, adapter: 'react', register: false, out })).rejects.toThrow(CliError)
  })

  it('runGen: an unwritable --out path (parent is a file) is an actionable CliError', () => {
    const dir = seedWorkspace(tempDir('uigraph-gen-out-'), graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    const fileParent = join(dir, 'afile')
    writeFileSync(fileParent, 'x')
    expect(() => runGen({ dir, from: 'a', to: 'b', out: join(fileParent, 'spec.ts') })).toThrow(CliError)
    expect(() => runGen({ dir, from: 'a', to: 'b', out: join(fileParent, 'spec.ts') })).toThrow(/cannot create output directory/)
  })

  it('runKitInstall: an unwritable target (parent is a file) is an actionable CliError', () => {
    const dir = tempDir('uigraph-kit-out-')
    const fileParent = join(dir, 'afile')
    writeFileSync(fileParent, 'x')
    expect(() => runKitInstall({ dir: fileParent })).toThrow(CliError)
    expect(() => runKitInstall({ dir: fileParent })).toThrow(/cannot create output directory/)
  })
})

describe('runLogin (manual session capture)', () => {
  /** A scripted LoginBrowser that records the call sequence. */
  function fakeBrowser(calls: string[], failSave = false) {
    return {
      newContext: async () => ({
        newPage: async () => ({
          goto: async (url: string) => {
            calls.push(`goto:${url}`)
          },
        }),
        storageState: async (opts: { path: string }) => {
          calls.push(`save:${opts.path}`)
          if (failSave) throw new Error('disk full')
          return {}
        },
      }),
      close: async () => {
        calls.push('close')
      },
    }
  }

  it('opens the app, waits for the user, then saves the session and closes', async () => {
    const { runLogin } = await import('./runner')
    const calls: string[] = []
    await runLogin({
      appUrl: 'http://x/login',
      out: 'auth.json',
      launcher: async () => fakeBrowser(calls),
      waitForUser: async () => {
        calls.push('user-logged-in')
      },
    })
    expect(calls).toEqual(['goto:http://x/login', 'user-logged-in', 'save:auth.json', 'close'])
  })

  it('always closes the browser, even when saving fails', async () => {
    const { runLogin } = await import('./runner')
    const calls: string[] = []
    await expect(
      runLogin({ appUrl: 'http://x', out: 'a.json', launcher: async () => fakeBrowser(calls, true), waitForUser: async () => {} }),
    ).rejects.toThrow('disk full')
    expect(calls[calls.length - 1]).toBe('close')
  })
})
