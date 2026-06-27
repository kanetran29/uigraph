// The Next.js adapter. Next routes are filesystem-based (app/**/page.* + pages/**), so this
// adapter discovers RouteSeeds from the file tree (routes.ts) and feeds them into the shared
// react extraction engine (extractGraphFromRoutes) — Next pages are plain React JSX, so all
// control/nav/modal extraction is reused verbatim. The engine already recognizes next/link
// <Link href>, useRouter().push/replace, and redirect() (route-level). On top of it, a Next-
// specific pass (layout-nav.ts) attributes navigation declared in the App Router LAYOUT chain
// that wraps each route (shared Navbar/Header → MainNav) and in deep wrapper components
// (CustomLink / <Button href> → <a href>), which the page-rooted engine scan does not reach.
// Remaining v1 floor: a nav reached only through a button onClick handler (router.push inside
// a handler) defined in a layout/wrapper is not yet attributed.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Project, ts } from 'ts-morph'
import type { Adapter, AdapterContext, ExtractOptions, ExtractResult } from '@uigraph/core'
import { extractGraphFromRoutes } from '@uigraph/adapter-react'
import { discoverRoutes } from './routes'
import { addLayoutAndWrapperEdges } from './layout-nav'

/** A ts-morph project over the WHOLE project (not src-first): Next routes live at root app/
 *  OR src/app, so a src-first glob could miss a root-level app/ when a src/ dir also exists. */
function buildNextProject(projectDir: string): Project {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  project.addSourceFilesAtPaths([`${projectDir}/**/*.{ts,tsx,js,jsx}`, `!${projectDir}/**/node_modules/**`, `!${projectDir}/**/.next/**`])
  return project
}

/** Does the project look like Next.js? A `next` dependency, a next.config.*, or an app/ dir. */
export function detectNext(projectDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    if ('next' in { ...pkg.dependencies, ...pkg.devDependencies }) return true
  } catch {
    // no/invalid package.json — fall through to file-based detection
  }
  for (const f of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    if (existsSync(join(projectDir, f))) return true
  }
  return existsSync(join(projectDir, 'app')) || existsSync(join(projectDir, 'src', 'app'))
}

/** Discover filesystem routes + assemble the graph (no IO/logging) — the testable core. */
export function extractNextGraph(projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const project = buildNextProject(projectDir)
  const { seeds, collisions } = discoverRoutes(project, projectDir)
  const result = extractGraphFromRoutes(project, projectDir, seeds, { ...opts, rulesetVersion: opts.rulesetVersion ?? 'next-app-pages-2026.06' }, '@uigraph/adapter-next')
  const layoutEdges = addLayoutAndWrapperEdges(project, projectDir, seeds, result.graph.edges)
  if (layoutEdges > 0) {
    result.soundiness.push({ kind: 'layout-nav', detail: `added ${layoutEdges} may-edge(s) from App Router layout chain / wrapper-buried <Link href> not reached by the page scan` })
  }
  for (const id of collisions) {
    result.soundiness.push({ kind: 'route-collision', detail: `route node ${id} is declared by BOTH app/ and pages/ — kept the first by sorted path order` })
  }
  return result
}

/** Extract the UI graph from a Next.js project directory. */
export async function extractNext(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<ExtractResult> {
  const result = extractNextGraph(projectDir, opts)
  ctx.log.info(
    `next adapter: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ${result.soundiness.length} soundiness notes`,
  )
  return result
}

/** The Next.js adapter as a plain object implementing the core contract. */
export const nextAdapter: Adapter = {
  name: 'next',
  detect: detectNext,
  extract: extractNext,
}

export { nextRoutePath, discoverRoutes } from './routes'
