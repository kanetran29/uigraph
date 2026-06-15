import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareFingerprint, fingerprintSources, type Fingerprint } from './fingerprint'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uigraph-fp-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function write(rel: string, content: string): void {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

describe('fingerprintSources', () => {
  it('includes only source files and ignores node_modules/dist/etc + non-source', () => {
    write('a.tsx', '1')
    write('b.vue', '2')
    write('c.test.ts', '3')
    write('d.css', '4')
    write('node_modules/x.ts', '5')
    write('dist/y.js', '6')
    const { files } = fingerprintSources(dir)
    expect(Object.keys(files).sort()).toEqual(['a.tsx', 'b.vue', 'c.test.ts'])
  })

  it('is deterministic — same content yields the same hash regardless of write order', () => {
    write('z.ts', 'z')
    write('a.ts', 'a')
    const h1 = fingerprintSources(dir).hash
    const dir2 = mkdtempSync(join(tmpdir(), 'uigraph-fp2-'))
    writeFileSync(join(dir2, 'a.ts'), 'a')
    writeFileSync(join(dir2, 'z.ts'), 'z')
    const h2 = fingerprintSources(dir2).hash
    rmSync(dir2, { recursive: true, force: true })
    expect(h1).toBe(h2)
  })

  it('hash changes when a file changes or is added', () => {
    write('a.ts', 'a')
    const h1 = fingerprintSources(dir).hash
    write('a.ts', 'a2')
    const h2 = fingerprintSources(dir).hash
    expect(h2).not.toBe(h1)
    write('b.ts', 'b')
    expect(fingerprintSources(dir).hash).not.toBe(h2)
  })

  it('does not follow symlinks (no cycle/escape)', () => {
    write('a.ts', 'a')
    try {
      symlinkSync(dir, join(dir, 'loop'))
    } catch {
      return
    }
    const { files } = fingerprintSources(dir)
    expect(Object.keys(files)).toEqual(['a.ts'])
  })

  it('does not read the clock or RNG', () => {
    write('a.ts', 'a')
    const now = Date.now
    const rand = Math.random
    Date.now = () => {
      throw new Error('clock read')
    }
    Math.random = () => {
      throw new Error('rng read')
    }
    try {
      expect(() => fingerprintSources(dir)).not.toThrow()
    } finally {
      Date.now = now
      Math.random = rand
    }
  })
})

describe('compareFingerprint', () => {
  const stored: Fingerprint = { projectDir: '/p', adapter: 'react', hash: 'h', mappedAt: 't', files: { 'a.ts': 'A', 'b.ts': 'B', 'gone.ts': 'G' } }
  it('reports fresh when nothing changed', () => {
    const d = compareFingerprint(stored, { hash: 'h', files: { 'a.ts': 'A', 'b.ts': 'B', 'gone.ts': 'G' } })
    expect(d).toEqual({ stale: false, changed: [], added: [], removed: [] })
  })
  it('reports changed / added / removed, sorted', () => {
    const d = compareFingerprint(stored, { hash: 'x', files: { 'a.ts': 'A2', 'b.ts': 'B', 'new.ts': 'N' } })
    expect(d.stale).toBe(true)
    expect(d.changed).toEqual(['a.ts'])
    expect(d.added).toEqual(['new.ts'])
    expect(d.removed).toEqual(['gone.ts'])
  })
})
