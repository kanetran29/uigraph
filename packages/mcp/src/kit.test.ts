import { describe, it, expect } from 'vitest'
import { kitManifest, listKit, readKitFile, readKitAll } from './kit'
import { TOOLS } from './server'

describe('agent kit', () => {
  it('lists exactly the tools the server exposes (single source of truth)', () => {
    const manifest = kitManifest().tools.slice().sort()
    const served = TOOLS.map((t) => t.name).sort()
    expect(manifest).toEqual(served)
  })

  it('documents every manifest tool in the tools guide', () => {
    const guide = readKitFile('guides/00-tools.md')
    for (const tool of kitManifest().tools) expect(guide).toContain(tool)
  })

  it('has a readable file for every manifest entry', () => {
    for (const f of listKit()) expect(readKitFile(f.path).length).toBeGreaterThan(0)
  })

  it('readKitAll concatenates every file in manifest order', () => {
    const all = readKitAll()
    for (const f of listKit()) expect(all).toContain(`<!-- ${f.path} -->`)
    expect(all).toContain('Golden invariant')
  })

  it('refuses a path that escapes the kit directory', () => {
    expect(() => readKitFile('../../package.json')).toThrow(/escapes/)
  })
})
