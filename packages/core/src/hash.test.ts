import { describe, it, expect } from 'vitest'
import { stableStringify, fnv1a, hashValue, canonicalEdgeTag } from './hash'

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

describe('canonicalEdgeTag', () => {
  it('is deterministic and a 6-char hex tag', () => {
    expect(canonicalEdgeTag('click', null)).toBe(canonicalEdgeTag('click', null))
    expect(canonicalEdgeTag('click', null)).toMatch(/^[0-9a-f]{6}$/)
  })

  it('collapses leading/trailing whitespace on the event (isomorphic dupe)', () => {
    expect(canonicalEdgeTag(' click ', null)).toBe(canonicalEdgeTag('click', null))
  })

  it('collapses internal whitespace runs in the guard (isomorphic dupe)', () => {
    expect(canonicalEdgeTag('submit', 'x  >  0')).toBe(canonicalEdgeTag('submit', 'x > 0'))
  })

  it('normalizes mixed whitespace (tabs/newlines) the same as spaces', () => {
    expect(canonicalEdgeTag('submit', 'x\t>\n0')).toBe(canonicalEdgeTag('submit', 'x > 0'))
  })

  it('keeps genuinely distinct guards distinct (does not over-collapse)', () => {
    expect(canonicalEdgeTag('submit', 'x > 0')).not.toBe(canonicalEdgeTag('submit', 'x < 0'))
  })

  it('keeps distinct events distinct', () => {
    expect(canonicalEdgeTag('click', null)).not.toBe(canonicalEdgeTag('submit', null))
  })

  it('treats a null guard and a whitespace-only guard alike (both = no guard)', () => {
    expect(canonicalEdgeTag('click', null)).toBe(canonicalEdgeTag('click', '   '))
    expect(canonicalEdgeTag('click', '   ')).toBe(canonicalEdgeTag('click', ''))
  })
})
