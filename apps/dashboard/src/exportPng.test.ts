import { describe, it, expect } from 'vitest'
import type { UiGraph } from '@ui-graph/core'
import { pngFilename } from './exportPng'

function graph(adapter: string): UiGraph {
  return { version: 0, meta: { adapter, adapterVersion: '1', rulesetVersion: '1' }, nodes: [], edges: [] }
}

describe('pngFilename', () => {
  const d = new Date('2026-06-15T10:00:00Z')
  it('builds uigraph-<slug>-<date>.png from the adapter', () => {
    expect(pngFilename(graph('react'), d)).toBe('uigraph-react-2026-06-15.png')
  })
  it('lowercases + slugifies a multi-word adapter', () => {
    expect(pngFilename(graph('React Router v5'), d)).toBe('uigraph-react-router-v5-2026-06-15.png')
  })
  it('falls back to "graph" when the adapter is empty', () => {
    expect(pngFilename(graph(''), d)).toBe('uigraph-graph-2026-06-15.png')
  })
})
