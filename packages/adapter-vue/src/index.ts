// @ui-graph/adapter-vue — the Vue Router adapter. Implements the core Adapter
// contract: detect a Vue project and extract the shared IR from its source (a
// `createRouter({ routes })` array of components defined as .vue SFCs). No
// framework code leaks into the core.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Adapter, AdapterContext, ExtractOptions, ExtractResult } from '@ui-graph/core'
import { buildProject, extractGraph } from './extract'

/** Does any source file under a directory reference 'vue-router' / createRouter? */
function sourceReferencesVue(dir: string, depth: number): boolean {
  if (depth < 0) return false
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (sourceReferencesVue(full, depth - 1)) return true
      continue
    }
    if (!/\.(ts|js|vue)$/.test(entry.name)) continue
    try {
      const text = readFileSync(full, 'utf8')
      if (text.includes('vue-router') || text.includes('createRouter')) return true
    } catch {
      continue
    }
  }
  return false
}

/** Cheap heuristic: does the project declare/reference Vue + Vue Router? */
export function detectVue(projectDir: string): boolean {
  try {
    const pkgPath = join(projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const all = { ...pkg.dependencies, ...pkg.devDependencies }
      if (Object.keys(all).some((k) => k === 'vue-router' || k === 'vue')) return true
    }
  } catch {
    // fall through to a source scan
  }
  return sourceReferencesVue(projectDir, 3)
}

/** Extract the UI graph from a Vue Router project directory. */
export async function extractVue(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<ExtractResult> {
  const vp = buildProject(projectDir)
  const result = extractGraph(vp, projectDir, opts)
  ctx.log.info(
    `vue adapter: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ${result.soundiness.length} soundiness notes`,
  )
  return result
}

/** The Vue adapter as a plain object implementing the core contract. */
export const vueAdapter: Adapter = {
  name: 'vue',
  detect: detectVue,
  extract: extractVue,
}

export { buildProject, buildProjectFromSources, extractGraph } from './extract'
export { routeToNodeId, edgeId, controlNodeId } from './ids'
export { matchLiteralAll, matchPrefix } from './matcher'
export { splitSfc, parseTemplateElements } from './sfc'
