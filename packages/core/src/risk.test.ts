import { describe, it, expect } from 'vitest'
import { classifyEffectRisk } from './risk'

describe('classifyEffectRisk', () => {
  it('flags destructive verbs in an effect string', () => {
    expect(classifyEffectRisk('api:DELETE /orders/1')).toBe(true)
    expect(classifyEffectRisk('state:removeItem')).toBe(true)
    expect(classifyEffectRisk('pay')).toBe(true)
    expect(classifyEffectRisk('api:POST /purchase')).toBe(true)
    expect(classifyEffectRisk('submit-order')).toBe(true)
    expect(classifyEffectRisk('logout')).toBe(true)
    expect(classifyEffectRisk('state:resetCart')).toBe(true)
  })

  it('does not flag benign or empty effects', () => {
    expect(classifyEffectRisk('navigate')).toBe(false)
    expect(classifyEffectRisk('state:openModal')).toBe(false)
    expect(classifyEffectRisk(null)).toBe(false)
    expect(classifyEffectRisk(undefined)).toBe(false)
    expect(classifyEffectRisk('')).toBe(false)
  })

  it('avoids substring false positives like "payload" or "removalRequested"', () => {
    expect(classifyEffectRisk('api:POST /payload')).toBe(false)
    expect(classifyEffectRisk('state:removalRequested')).toBe(false)
    expect(classifyEffectRisk('deletedDraftRestored')).toBe(false)
  })
})
