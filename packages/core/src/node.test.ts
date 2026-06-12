import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGraph, saveGraph, loadOverlay, saveOverlay } from './node'
import { emptyOverlay } from './overlay'
import { edge, graph, node } from './fixtures'

describe('graph IO roundtrip', () => {
  it('saves and loads a valid graph unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-'))
    try {
      const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b')])
      const p = join(dir, 'nested', 'ui-graph.json')
      saveGraph(p, g)
      expect(loadGraph(p)).toEqual(g)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects loading an invalid graph', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-'))
    try {
      const bad = graph([node('a')], [edge('e1', 'a', 'missing')])
      const p = join(dir, 'bad.json')
      saveGraph(p, bad)
      expect(() => loadGraph(p)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('saves and loads an overlay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-'))
    try {
      const ov = emptyOverlay('abc123')
      const p = join(dir, 'overlay.json')
      saveOverlay(p, ov)
      expect(loadOverlay(p)).toEqual(ov)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
