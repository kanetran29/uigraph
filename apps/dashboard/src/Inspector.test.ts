import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GraphNode } from '@ui-graph/core'
import { Inspector } from './Inspector'

/** Static-render the inspector for a node selection (no DOM needed; i18n falls back to en). */
function html(node: GraphNode): string {
  return renderToStaticMarkup(createElement(Inspector, { selection: { kind: 'node', node } }))
}

const home: GraphNode = { id: 'n_home', route: '/', componentPath: 'src/Home.tsx', label: 'Home', kind: 'screen' }

describe('Inspector: screen screenshot', () => {
  it('renders the shot as a thumbnail that links to the full-size image when the node has one', () => {
    const out = html({ ...home, screenshot: 'shots/n_home.jpg' })
    expect(out).toContain('<img class="inspector-shot" src="/api/shots/n_home.jpg"')
    expect(out).toContain('href="/api/shots/n_home.jpg"')
    expect(out).toContain('target="_blank"')
  })

  it('renders no image at all when the node has no screenshot (offline sample shape)', () => {
    expect(html(home)).not.toContain('<img')
  })
})
