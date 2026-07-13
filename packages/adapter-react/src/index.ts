// @ui-graph/adapter-react — the React Router adapter. Implements the core Adapter
// contract: detect a react-router project and extract the shared IR from its
// source. Supports react-router v5 and v6. No framework code leaks into the core.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Adapter, AdapterContext, ExtractOptions, ExtractResult } from '@ui-graph/core'
import { buildProject, extractGraph } from './extract'

/** Cheap heuristic: does the project declare a react-router dependency? */
export function detectReact(projectDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    return Object.keys(all).some((k) => k === 'react-router' || k === 'react-router-dom')
  } catch {
    return false
  }
}

/** Extract the UI graph from a react-router project directory. */
export async function extractReact(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<ExtractResult> {
  const project = buildProject(projectDir)
  const result = extractGraph(project, projectDir, opts)
  ctx.log.info(
    `react adapter: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ${result.soundiness.length} soundiness notes`,
  )
  return result
}

/** The React adapter as a plain object implementing the core contract. */
export const reactAdapter: Adapter = {
  name: 'react',
  detect: detectReact,
  extract: extractReact,
}

export { buildProject, extractGraph, extractGraphFromRoutes, type RouteSeed } from './extract'
export { routeToNodeId, edgeId } from './ids'
export { matchLiteralAll, matchPrefix } from './matcher'
