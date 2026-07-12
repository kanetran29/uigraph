// Locating a Vue project's source files on disk and resolving `.vue` import
// specifiers to the registered components ts-morph cannot read directly.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VueComponent } from './extract'

/** Whether a path is a readable directory. */
export function safeIsDir(p: string): boolean {
  try {
    return readdirSync(p).length >= 0
  } catch {
    return false
  }
}

/** Recursively list .ts/.js/.vue source files, skipping node_modules / dotfiles. */
export function walkSources(dir: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkSources(full))
    else if (/\.(ts|js|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Resolve a `.vue` import specifier to a registered component. Handles relative
 * specifiers and the common `@/` / `~/` / `~@/` src-root aliases (matched by path
 * suffix against `src/<rest>`), with `.vue` and `/index.vue` candidates.
 */
export function resolveVueComponent(fromPath: string, specifier: string, components: VueComponent[]): VueComponent | undefined {
  const alias = /^(@|~@?)\//.exec(specifier)
  if (alias) {
    const rest = specifier.slice(alias[0].length)
    const tails = rest.endsWith('.vue') ? [`src/${rest}`] : [`src/${rest}.vue`, `src/${rest}/index.vue`]
    return components.find((c) => tails.some((t) => c.vuePath.endsWith(`/${t}`) || c.vuePath.endsWith(`\\${t}`)))
  }
  if (!specifier.startsWith('.')) return undefined
  const base = join(dirname(fromPath), specifier)
  const cands = specifier.endsWith('.vue') ? [base] : [`${base}.vue`, `${base}/index.vue`]
  return components.find((c) => cands.includes(c.vuePath))
}
