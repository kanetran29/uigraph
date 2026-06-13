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
import { dbPathFor, formatDiff, readSoundiness, runDiff, runMap } from './commands'
import { handleApiRequest, resolveShotPath, startApiServer } from './server'
import { mkdirSync, writeFileSync } from 'node:fs'

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
