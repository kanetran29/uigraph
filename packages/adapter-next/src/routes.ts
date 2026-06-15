// Next.js filesystem route discovery. Unlike react-router (<Route> JSX), a Next route is
// a file: app/**/page.{tsx,ts,jsx,js} (App Router) or pages/**/*.{tsx,ts,jsx,js} (Pages
// Router). The route PATH is derived from the file path; the page file IS the route's
// component. nextRoutePath is pure + unit-tested; discoverRoutes globs a ts-morph project
// into RouteSeeds the shared engine (extractGraphFromRoutes) consumes.

import { relative } from 'node:path'
import type { Project } from 'ts-morph'
import { routeToNodeId, type RouteSeed } from '@uigraph/adapter-react'

const APP_PAGE_RE = /(^|\/)page\.(tsx|ts|jsx|js)$/
const PAGE_EXT_RE = /\.(tsx|ts|jsx|js)$/
// Pages Router special files + the api dir are not screens.
const PAGES_EXCLUDE_RE = /(^|\/)(_app|_document|_error)\.(tsx|ts|jsx|js)$|(^|\/)api\//

/** Map a Next.js path segment to its IR form, or null when the segment is dropped. */
function segment(seg: string, isApp: boolean): string | null {
  // App Router route groups (marketing) and named slots @team carry no URL segment.
  if (isApp && (/^\(.*\)$/.test(seg) || seg.startsWith('@'))) return null
  // catch-all [...slug] and optional catch-all [[...slug]] → a wildcard segment.
  if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) return '*'
  // dynamic [slug] → :slug
  const dyn = /^\[(.+)\]$/.exec(seg)
  if (dyn && dyn[1]) return ':' + dyn[1]
  return seg
}

/** Join already-mapped segments into an IR route path ('' → '/'). */
function toPath(segs: string[], isApp: boolean): string {
  const mapped = segs.map((s) => segment(s, isApp)).filter((s): s is string => s !== null)
  return '/' + mapped.join('/')
}

/**
 * The IR route path for a project-relative source file, or null when the file is not a
 * route (a layout/loading/api/special file). Handles App Router (app/**\/page.*) and Pages
 * Router (pages/**), with or without a leading src/.
 */
export function nextRoutePath(relFile: string): string | null {
  const p = relFile.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^src\//, '')
  if (p.startsWith('app/')) {
    if (!APP_PAGE_RE.test(p)) return null
    const segs = p.slice(4).replace(APP_PAGE_RE, '').split('/').filter(Boolean)
    return toPath(segs, true)
  }
  if (p.startsWith('pages/')) {
    if (PAGES_EXCLUDE_RE.test(p) || !PAGE_EXT_RE.test(p)) return null
    const segs = p.slice(6).replace(PAGE_EXT_RE, '').split('/').filter(Boolean)
    if (segs[segs.length - 1] === 'index') segs.pop()
    return toPath(segs, false)
  }
  return null
}

/**
 * Discover Next.js routes from a ts-morph project: each page file becomes a RouteSeed
 * whose componentFile is that page file. Deterministic (sorted by path) so the app-vs-pages
 * first-wins dedupe (a route declared by both routers) is reproducible.
 */
export function discoverRoutes(project: Project, projectDir: string): { seeds: RouteSeed[]; collisions: string[] } {
  const byId = new Map<string, RouteSeed>()
  const collisions: string[] = []
  const files = project.getSourceFiles().slice().sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1))
  for (const sf of files) {
    const rel = relative(projectDir, sf.getFilePath())
    const fullPath = nextRoutePath(rel)
    if (fullPath === null) continue
    const nodeId = routeToNodeId(fullPath)
    if (byId.has(nodeId)) {
      collisions.push(nodeId)
      continue
    }
    byId.set(nodeId, { fullPath, nodeId, componentName: null, componentFile: sf })
  }
  return { seeds: [...byId.values()], collisions }
}
