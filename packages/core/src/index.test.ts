import { describe, it, expect } from 'vitest'
import { CORE_VERSION } from './index'

describe('@uigraph/core', () => {
  it('exposes a package version', () => {
    expect(CORE_VERSION).toBe('0.1.0')
  })
})
