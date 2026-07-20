import { describe, it, expect } from 'vitest'
import { controlNodeId, routeToNodeId, edgeId } from './ids'

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

  it('hashes idKey over value when present (an i18n-resolved name stays stable under a translation-copy edit)', () => {
    const before = { strategy: 'role-name' as const, value: 'button|Open menu', idKey: 'button|header.openMenuAria' }
    const afterCopyEdit = { strategy: 'role-name' as const, value: 'button|Ouvrir le menu', idKey: 'button|header.openMenuAria' }
    expect(controlNodeId('n_a', before)).toBe(controlNodeId('n_a', afterCopyEdit))
  })

  it('a genuinely different idKey still yields a different id (not vacuously stable)', () => {
    const a = { strategy: 'role-name' as const, value: 'button|Open menu', idKey: 'button|header.openMenuAria' }
    const b = { strategy: 'role-name' as const, value: 'button|Close menu', idKey: 'button|header.closeMenuAria' }
    expect(controlNodeId('n_a', a)).not.toBe(controlNodeId('n_a', b))
  })

  it('routeToNodeId still maps route patterns to stable ids', () => {
    expect(routeToNodeId('/products/:id')).toBe('n_products_id')
  })
})

describe('edgeId', () => {
  it('collapses isomorphic edges differing only in whitespace to one id', () => {
    expect(edgeId('n_a', 'n_b', ' click ', 'x  >  0')).toBe(edgeId('n_a', 'n_b', 'click', 'x > 0'))
  })

  it('keeps genuinely distinct guards on the same pair distinct', () => {
    expect(edgeId('n_a', 'n_b', 'submit', 'x > 0')).not.toBe(edgeId('n_a', 'n_b', 'submit', 'x < 0'))
  })

  it('endpoints participate in the id', () => {
    expect(edgeId('n_a', 'n_b', 'click', null)).not.toBe(edgeId('n_a', 'n_c', 'click', null))
  })
})
