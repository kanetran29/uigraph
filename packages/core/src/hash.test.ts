import { describe, it, expect } from 'vitest'
import { stableStringify, fnv1a, hashValue } from './hash'

describe('stableStringify', () => {
  it('is invariant to object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('preserves array order', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]))
  })

  it('omits undefined values', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

describe('fnv1a / hashValue', () => {
  it('is deterministic', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
  })

  it('returns 16-char hex', () => {
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('hashes key-reordered objects identically', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }))
  })

  it('separates distinct values', () => {
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }))
  })
})
