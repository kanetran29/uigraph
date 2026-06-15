import { describe, it, expect } from 'vitest'
import { parseStored } from './CollapsibleSection'

describe('parseStored', () => {
  it('falls back when the key is absent', () => {
    expect(parseStored(null, true)).toBe(true)
    expect(parseStored(null, false)).toBe(false)
  })
  it("reads '1' as open and '0' as closed", () => {
    expect(parseStored('1', false)).toBe(true)
    expect(parseStored('0', true)).toBe(false)
  })
  it('treats any other stored value as closed (guards a future value format)', () => {
    expect(parseStored('', true)).toBe(false)
    expect(parseStored('yes', true)).toBe(false)
  })
})
