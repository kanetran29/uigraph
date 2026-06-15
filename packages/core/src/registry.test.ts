import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyRegistry, findWorkspace, makeId, readRegistry, removeWorkspace, slugify, summarize, upsertWorkspace, writeRegistry, type Registry } from './registry'

const AT = '2026-01-01T00:00:00Z'

describe('slugify / makeId (pure)', () => {
  it('slugifies, lowercasing + collapsing punctuation, with a fallback', () => {
    expect(slugify('My App')).toBe('my-app')
    expect(slugify('  weird/.name!! ')).toBe('weird-name')
    expect(slugify('')).toBe('workspace')
  })
  it('mints a stable dir-hash suffix only on collision', () => {
    expect(makeId('app', '/a', new Set())).toBe('app')
    const second = makeId('app', '/b', new Set(['app']))
    expect(second).not.toBe('app')
    expect(makeId('app', '/b', new Set(['app']))).toBe(second)
  })
})

describe('upsert / remove / find (pure)', () => {
  it('adds a new workspace keyed by dir, basename-free name supplied by caller', () => {
    const reg = upsertWorkspace(emptyRegistry(), '/Users/x/shop', 'shop', 'next', AT)
    expect(reg.workspaces).toHaveLength(1)
    expect(reg.workspaces[0]).toMatchObject({ id: 'shop', dir: '/Users/x/shop', adapter: 'next', addedAt: AT })
  })
  it('upserting the same dir preserves id + addedAt, updates name/adapter', () => {
    let reg = upsertWorkspace(emptyRegistry(), '/Users/x/shop', 'shop', 'next', AT)
    reg = upsertWorkspace(reg, '/Users/x/shop', 'Shop Renamed', 'react', '2026-02-02T00:00:00Z')
    expect(reg.workspaces).toHaveLength(1)
    expect(reg.workspaces[0]).toMatchObject({ id: 'shop', name: 'Shop Renamed', adapter: 'react', addedAt: AT })
  })
  it('removes by id or by dir; an absent key is a no-op', () => {
    const reg = upsertWorkspace(upsertWorkspace(emptyRegistry(), '/a', 'a', 'react', AT), '/b', 'b', 'vue', AT)
    expect(removeWorkspace(reg, 'a').workspaces.map((w) => w.id)).toEqual(['b'])
    expect(removeWorkspace(reg, '/b').workspaces.map((w) => w.id)).toEqual(['a'])
    expect(removeWorkspace(reg, 'nope').workspaces).toHaveLength(2)
  })
  it('finds by opaque id only', () => {
    const reg = upsertWorkspace(emptyRegistry(), '/a', 'a', 'react', AT)
    expect(findWorkspace(reg, 'a')?.dir).toBe('/a')
    expect(findWorkspace(reg, '/a')).toBeUndefined()
  })
})

describe('summarize (client-safe)', () => {
  it('omits the absolute dir and reports availability', () => {
    const reg = upsertWorkspace(emptyRegistry(), '/a', 'a', 'react', AT)
    const s = summarize(reg, () => true)[0]!
    expect(s).toEqual({ id: 'a', name: 'a', adapter: 'react', available: true })
    expect(Object.keys(s)).not.toContain('dir')
  })
})

describe('registry IO (UIGRAPH_HOME)', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'uigraph-home-'))
    process.env.UIGRAPH_HOME = home
  })
  afterEach(() => {
    delete process.env.UIGRAPH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('returns an empty registry when the file is absent', () => {
    expect(readRegistry()).toEqual(emptyRegistry())
  })
  it('round-trips through write/read', () => {
    const reg: Registry = upsertWorkspace(emptyRegistry(), '/Users/x/shop', 'shop', 'next', AT)
    writeRegistry(reg)
    expect(readRegistry()).toEqual(reg)
  })
})
