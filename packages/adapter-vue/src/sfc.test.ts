import { describe, it, expect } from 'vitest'
import { splitSfc, parseTemplateElements, eventHandlers, stringAttr, boundAttr } from './sfc'

describe('splitSfc', () => {
  it('extracts the root template and merges script blocks', () => {
    const sfc = splitSfc(`<template>\n  <h1>Hi</h1>\n</template>\n<script setup lang="ts">\nconst x = 1\n</script>`)
    expect(sfc.template).toContain('<h1>Hi</h1>')
    expect(sfc.script).toContain('const x = 1')
  })

  it('matches the root template across a nested <template v-if>', () => {
    const sfc = splitSfc(`<template>\n  <div>\n    <template v-if="ok"><span>a</span></template>\n  </div>\n</template>\n<script>export default {}</script>`)
    expect(sfc.template).toContain('<span>a</span>')
    expect(sfc.template).not.toContain('<script')
  })

  it('merges both <script> and <script setup> blocks', () => {
    const sfc = splitSfc(`<template><p>x</p></template>\n<script>export const meta = 1</script>\n<script setup>const y = 2</script>`)
    expect(sfc.script).toContain('export const meta = 1')
    expect(sfc.script).toContain('const y = 2')
  })
})

describe('parseTemplateElements', () => {
  it('tokenizes elements with raw attribute keys and inner text', () => {
    const els = parseTemplateElements('<button data-testid="x" @click="go">Save</button>', 0)
    const btn = els.find((e) => e.tag === 'button')
    expect(btn?.attrs.get('data-testid')).toBe('x')
    expect(btn?.attrs.get('@click')).toBe('go')
    expect(btn?.text).toBe('Save')
  })

  it('reads plain and bound attributes', () => {
    const [el] = parseTemplateElements('<router-link to="/a" :to="b">go</router-link>', 0)
    expect(stringAttr(el!, 'to')).toBe('/a')
    expect(boundAttr(el!, 'to')).toBe('b')
  })

  it('strips event modifiers and collects handlers', () => {
    const [el] = parseTemplateElements('<form @submit.prevent="save"><input /></form>', 0)
    expect(eventHandlers(el!)).toEqual([{ event: 'submit', expr: 'save' }])
  })
})
