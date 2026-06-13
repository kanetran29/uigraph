import { describe, it, expect } from 'vitest'
import { controlNodeId, routeToNodeId } from './ids'

describe('controlNodeId', () => {
  it('is deterministic and prefixed c_<screen>__', () => {
    const sel = { strategy: 'role-name' as const, value: 'button|Save' }
    const id = controlNodeId('n_a', sel)
    expect(id).toBe(controlNodeId('n_a', { ...sel }))
    expect(id.startsWith('c_n_a__')).toBe(true)
  })

  it('distinct selector value -> distinct id', () => {
    expect(controlNodeId('n_a', { strategy: 'testid', value: 'x' })).not.toBe(controlNodeId('n_a', { strategy: 'testid', value: 'y' }))
  })

  it('nth participates in the id (disambiguates identical selectors)', () => {
    const base = { strategy: 'role-name' as const, value: 'radio|plan' }
    expect(controlNodeId('n_a', base)).not.toBe(controlNodeId('n_a', { ...base, nth: 1 }))
  })

  it('screen participates (same selector on two screens -> different ids)', () => {
    const sel = { strategy: 'testid' as const, value: 'x' }
    expect(controlNodeId('n_a', sel)).not.toBe(controlNodeId('n_b', sel))
  })

  it('routeToNodeId still maps route patterns to stable ids', () => {
    expect(routeToNodeId('/products/:id')).toBe('n_products_id')
  })
})
