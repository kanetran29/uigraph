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
import { dbPathFor, formatDiff, formatDiffSinceLast, readSoundiness, runDiff, runDiffSinceLast, runGen, runKitInstall, runKitPrint, runMap, runWorkspaceAdd, runWorkspaceList, runWorkspaceRemove } from './commands'
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
    const summary = await runVerify({ dir, appUrl: 'http://x', limit: 10, driver: async () => ({ confirmed: true, screenshot: 'shots/e.png' }) })
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
    // two may edges; the driver confirms a->b, never confirms a->c
    const g = graph(
      [node('a'), node('b'), node('c')],
      [
        { ...edge('e_ab', 'a', 'b'), modality: 'may', source: 'static', guard: 'x' },
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
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async (_p, appUrl, opts) => (opts?.capture ? { confirmed: true, landedUrl: `${appUrl}/b` } : { confirmed: false }) })
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
    const summary = await runVerify({ dir, appUrl: 'http://x', driver: async (_p, appUrl, opts) => (opts?.capture ? { confirmed: true, landedUrl: `${appUrl}/surprise` } : { confirmed: false }) })
    expect(summary.discoveredNodes).toBe(1)
    const merged = (await import('@uigraph/mcp')).loadMergedGraph({ dir })
    expect(merged.nodes.some((n) => n.route === '/surprise')).toBe(true)
    expect(merged.edges.some((e) => e.from === 'a' && e.source === 'runtime')).toBe(true)
  })
})
