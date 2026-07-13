import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateGraph } from '@ui-graph/core'
import { extractNextGraph } from './index'

const dir = fileURLToPath(new URL('../test-fixtures/advanced-app', import.meta.url))

describe('extractNext — App Router advanced routing', () => {
  const { graph } = extractNextGraph(dir)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  it('satisfies the core invariants', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('route group is transparent — flat path, no group node, screen kind', () => {
    const pricing = byId.get('n_pricing')
    expect(pricing?.route).toBe('/pricing')
    expect(pricing?.kind).toBe('screen')
    expect([...byId.keys()].some((id) => id.includes('marketing'))).toBe(false)
  })

  it('dynamic segment becomes a :param route', () => {
    expect(byId.get('n_photo_id')?.route).toBe('/photo/:id')
  })

  it('intercepting route is a modal node overlaying the real route, with a distinct id', () => {
    const modal = byId.get('n_photo_id__intercept')
    expect(modal?.kind).toBe('modal')
    expect(modal?.route).toBe('/photo/:id')
    expect(byId.get('n_photo_id')?.kind).toBe('screen')
  })

  it('parallel @slot routes become distinct slot nodes encoding parentPath + slot', () => {
    const team = byId.get('n_dashboard__slot_team_members')
    const analytics = byId.get('n_dashboard__slot_analytics')
    expect(team?.kind).toBe('route')
    expect(analytics?.kind).toBe('route')
    expect(team?.route).toBe('/dashboard/members')
    expect(analytics?.route).toBe('/dashboard')
  })
})
