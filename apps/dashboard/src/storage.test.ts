import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStored, removeStored, writeStored } from './storage'

// The dashboard test env has no real localStorage; install a Map-backed stub so the
// helpers' behaviour is testable independent of the environment.
function installStub(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
}

describe('storage', () => {
  beforeEach(installStub)
  afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'))

  it('round-trips a written value and reads null when absent', () => {
    expect(readStored('k')).toBeNull()
    writeStored('k', 'v')
    expect(readStored('k')).toBe('v')
  })

  it('removes a key', () => {
    writeStored('k', 'v')
    removeStored('k')
    expect(readStored('k')).toBeNull()
  })

  it('does not throw when localStorage access throws (private mode / quota)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(readStored('k')).toBeNull()
    expect(() => writeStored('k', 'v')).not.toThrow()
    expect(() => removeStored('k')).not.toThrow()
  })
})
