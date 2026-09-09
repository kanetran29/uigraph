import { describe, it, expect } from 'vitest'
import { attachScreenshots, type ScreenShots } from './screens'
import { graph, node } from './fixtures'

const shot = (path: string): ScreenShots[string] => ({ path, ts: '2026-01-01T00:00:00Z', base: 'h', source: 'landing' })

describe('attachScreenshots', () => {
  const base = graph([node('a'), node('b')], [])

  it('sets node.screenshot to the shot path for nodes that have one', () => {
    const out = attachScreenshots(base, { a: shot('shots/a.jpg') })
    expect(out.nodes.find((n) => n.id === 'a')?.screenshot).toBe('shots/a.jpg')
    expect('screenshot' in (out.nodes.find((n) => n.id === 'b') as object)).toBe(false)
  })

  it('ignores shot ids that are not in the graph', () => {
    const out = attachScreenshots(base, { ghost: shot('shots/ghost.jpg') })
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(out.nodes.every((n) => n.screenshot === undefined)).toBe(true)
  })

  it('the sidecar is the only source: a screenshot carried by an incoming node (overlay/migrated) is dropped or replaced', () => {
    const tainted = graph([node('a', { screenshot: 'shots/other.jpg' }), node('b', { screenshot: 'shots/a.jpg' })], [])
    const out = attachScreenshots(tainted, { a: shot('shots/a.jpg') })
    expect(out.nodes.find((n) => n.id === 'a')?.screenshot).toBe('shots/a.jpg')
    expect('screenshot' in (out.nodes.find((n) => n.id === 'b') as object)).toBe(false)
  })

  it('is pure: the input graph is not mutated', () => {
    attachScreenshots(base, { a: shot('shots/a.jpg') })
    expect(base.nodes.find((n) => n.id === 'a')?.screenshot).toBeUndefined()
  })
})
