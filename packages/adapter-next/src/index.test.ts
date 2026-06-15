import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { detectNext } from './index'

const nextApp = fileURLToPath(new URL('../../../examples/sample-next-app', import.meta.url))
const reactApp = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))

describe('detectNext', () => {
  it('is true for a Next project (next dependency + next.config + app/)', () => {
    expect(detectNext(nextApp)).toBe(true)
  })
  it('is false for a plain react-router project', () => {
    expect(detectNext(reactApp)).toBe(false)
  })
})
