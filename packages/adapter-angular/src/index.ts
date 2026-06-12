// @uigraph/adapter-angular — the Angular Router adapter. Implements the core
// Adapter contract: detect an Angular project and extract the shared IR from its
// source (a `Routes` array of standalone components with inline templates). No
// framework code leaks into the core.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Adapter, AdapterContext, ExtractOptions, ExtractResult } from '@uigraph/core'
import { buildProject, extractGraph } from './extract'

/** Does any source file under a directory reference '@angular/router' or a Routes array? */
function sourceReferencesAngular(dir: string, depth: number): boolean {
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
      if (sourceReferencesAngular(full, depth - 1)) return true
      continue
    }
    if (!/\.(ts|js)$/.test(entry.name)) continue
    try {
      const text = readFileSync(full, 'utf8')
      if (text.includes('@angular/router') || /:\s*Routes\b/.test(text)) return true
    } catch {
      continue
    }
  }
  return false
}

/** Cheap heuristic: does the project declare/reference Angular Router? */
export function detectAngular(projectDir: string): boolean {
  try {
    const pkgPath = join(projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const all = { ...pkg.dependencies, ...pkg.devDependencies }
      if (Object.keys(all).some((k) => k === '@angular/router' || k === '@angular/core')) return true
    }
  } catch {
    // fall through to a source scan
  }
  return sourceReferencesAngular(projectDir, 3)
}

/** Extract the UI graph from an Angular Router project directory. */
export async function extractAngular(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<ExtractResult> {
  const project = buildProject(projectDir)
  const result = extractGraph(project, projectDir, opts)
  ctx.log.info(
    `angular adapter: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ${result.soundiness.length} soundiness notes`,
  )
  return result
}

/** The Angular adapter as a plain object implementing the core contract. */
export const angularAdapter: Adapter = {
  name: 'angular',
  detect: detectAngular,
  extract: extractAngular,
}

export { buildProject, extractGraph } from './extract'
export { routeToNodeId, edgeId } from './ids'
export { matchLiteral, matchPrefix } from './matcher'
