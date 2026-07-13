// Next.js filesystem route discovery. Unlike react-router (<Route> JSX), a Next route is
// a file: app/**/page.{tsx,ts,jsx,js} (App Router) or pages/**/*.{tsx,ts,jsx,js} (Pages
// Router). The route PATH is derived from the file path; the page file IS the route's
// component. nextRoutePath is pure + unit-tested; discoverRoutes globs a ts-morph project
// into RouteSeeds the shared engine (extractGraphFromRoutes) consumes. App Router advanced
// routing (intercepting (.)/(..)/(...)  → modal-like nodes, parallel @slot → slot nodes) is
// classified by classifyAppRoute and applied to the produced nodes by extractNextGraph.

import { relative } from 'node:path'
import type { Project } from 'ts-morph'
import type { NodeKind } from '@ui-graph/core'
import { routeToNodeId, type RouteSeed } from '@ui-graph/adapter-react'

const APP_PAGE_RE = /(^|\/)page\.(tsx|ts|jsx|js)$/
const APP_DEFAULT_RE = /(^|\/)default\.(tsx|ts|jsx|js)$/
const PAGE_EXT_RE = /\.(tsx|ts|jsx|js)$/
// Pages Router special files + the api dir are not screens.
const PAGES_EXCLUDE_RE = /(^|\/)(_app|_document|_error)\.(tsx|ts|jsx|js)$|(^|\/)api\//
const GROUP_RE = /^\(.+\)$/
const INTERCEPT_RE = /^(\(\.\)|\(\.\.\)\(\.\.\)|\(\.\.\)|\(\.\.\.\))(.+)$/
const DYNAMIC_CATCHALL_RE = /^\[\[?\.\.\..+\]\]?$/
const DYNAMIC_RE = /^\[(.+)\]$/

/** How an App Router segment contributes to the IR path / classification. */
type SegKind = 'group' | 'slot' | 'intercept' | 'normal'

/** A parsed App Router segment: its IR contribution plus advanced-routing markers. */
interface ParsedSeg {
  kind: SegKind
  /** The IR path piece this segment emits, or null when the segment carries no URL (group/slot). */
  ir: string | null
  /** For a slot segment, the slot name (e.g. `team` for `@team`). */
  slot?: string
  /** For an intercepting segment, the marker `(.)` | `(..)` | `(...)` and the target piece. */
  intercept?: { marker: string; ir: string }
}

/** Normalize a single App Router segment to its IR piece (dynamic/catch-all), no markers. */
function normalizeSegment(seg: string): string {
  if (DYNAMIC_CATCHALL_RE.test(seg)) return '*'
  const dyn = DYNAMIC_RE.exec(seg)
  if (dyn && dyn[1]) return ':' + dyn[1]
  return seg
}

/** Parse an App Router segment, classifying groups, parallel slots, and intercepting markers. */
function parseAppSegment(seg: string): ParsedSeg {
  if (GROUP_RE.test(seg)) return { kind: 'group', ir: null }
  if (seg.startsWith('@')) return { kind: 'slot', ir: null, slot: seg.slice(1) }
  const inter = INTERCEPT_RE.exec(seg)
  if (inter && inter[1] && inter[2]) return { kind: 'intercept', ir: null, intercept: { marker: inter[1], ir: normalizeSegment(inter[2]) } }
  return { kind: 'normal', ir: normalizeSegment(seg) }
}

/**
 * Resolve an intercepting route's overlay target path. The marker is relative to the
 * route's own directory: `(.)` same level, `(..)` one level up, `(..)(..)` two levels up,
 * `(...)` from the app root. `base` is the already-mapped normal IR pieces leading to (and
 * excluding) the intercept segment; `target` is the intercepted segment's IR piece, plus any
 * IR pieces nested under the intercepting folder (e.g. the `[id]` in `(.)photo/[id]`).
 */
function resolveInterceptPath(base: string[], marker: string, target: string[]): string {
  let dir: string[]
  if (marker === '(...)') dir = []
  else if (marker === '(..)(..)') dir = base.slice(0, Math.max(0, base.length - 2))
  else if (marker === '(..)') dir = base.slice(0, Math.max(0, base.length - 1))
  else dir = base.slice()
  return '/' + [...dir, ...target].filter(Boolean).join('/')
}

/** Classification of an App Router file: its IR path, node kind, and an optional override node id. */
export interface AppRouteClass {
  path: string
  kind: NodeKind
  /**
   * A deterministic node id distinct from routeToNodeId(path). Set for parallel-route slots
   * (encodes parentPath + slot) and for intercepting modals (so the overlay does not collide
   * with the real route node at the same URL).
   */
  nodeId?: string
}

/**
 * Classify an App Router source file (relative to the project root) into an IR route, or null
 * when it is not a routable file. Handles route groups (stripped), dynamic/catch-all segments
 * (:param / *), parallel routes (@slot → a slot node off the parent path), and intercepting
 * routes ((.)/(..)/(...) → a modal-like node overlaying the resolved target path).
 */
export function classifyAppRoute(relFile: string): AppRouteClass | null {
  const p = relFile.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^src\//, '')
  if (!p.startsWith('app/')) return null
  const isPage = APP_PAGE_RE.test(p)
  const isDefault = APP_DEFAULT_RE.test(p)
  if (!isPage && !isDefault) return null
  const fileRe = isPage ? APP_PAGE_RE : APP_DEFAULT_RE
  const rawSegs = p.slice(4).replace(fileRe, '').split('/').filter(Boolean)
  const parsed = rawSegs.map(parseAppSegment)

  const interceptIdx = parsed.findIndex((s) => s.intercept !== undefined)
  const interceptSeg = interceptIdx >= 0 ? parsed[interceptIdx] : undefined
  if (interceptSeg && interceptSeg.intercept) {
    const { marker, ir: interceptedIr } = interceptSeg.intercept
    const base = parsed.slice(0, interceptIdx).filter((s): s is ParsedSeg & { ir: string } => s.ir !== null).map((s) => s.ir)
    const nested = parsed.slice(interceptIdx + 1).filter((s): s is ParsedSeg & { ir: string } => s.ir !== null).map((s) => s.ir)
    const targetPath = resolveInterceptPath(base, marker, [interceptedIr, ...nested])
    return { path: targetPath, kind: 'modal', nodeId: `${routeToNodeId(targetPath)}__intercept` }
  }

  const slotIdx = parsed.findIndex((s) => s.slot !== undefined)
  const slotSeg = slotIdx >= 0 ? parsed[slotIdx] : undefined
  const normalPieces = parsed.filter((s): s is ParsedSeg & { ir: string } => s.ir !== null).map((s) => s.ir)
  const fullPath = '/' + normalPieces.join('/')
  if (slotSeg && slotSeg.slot) {
    const slotName = slotSeg.slot
    const parentPieces = parsed.slice(0, slotIdx).filter((s): s is ParsedSeg & { ir: string } => s.ir !== null).map((s) => s.ir)
    const innerPieces = parsed.slice(slotIdx + 1).filter((s): s is ParsedSeg & { ir: string } => s.ir !== null).map((s) => s.ir)
    const parentId = routeToNodeId('/' + parentPieces.join('/'))
    const inner = innerPieces.length > 0 ? '_' + routeToNodeId('/' + innerPieces.join('/')).replace(/^n_/, '') : ''
    return { path: fullPath, kind: 'route', nodeId: `${parentId}__slot_${slotName}${inner}` }
  }
  return { path: fullPath, kind: 'screen' }
}

/**
 * The IR route path for a project-relative source file, or null when the file is not a
 * route (a layout/loading/api/special file). Handles App Router (app/**\/page.*) and Pages
 * Router (pages/**), with or without a leading src/. Backward-compatible wrapper that returns
 * only the path; richer App Router classification is exposed via classifyAppRoute.
 */
export function nextRoutePath(relFile: string): string | null {
  const p = relFile.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^src\//, '')
  if (p.startsWith('app/')) {
    const cls = classifyAppRoute(relFile)
    return cls ? cls.path : null
  }
  if (p.startsWith('pages/')) {
    if (PAGES_EXCLUDE_RE.test(p) || !PAGE_EXT_RE.test(p)) return null
    const segs = p.slice(6).replace(PAGE_EXT_RE, '').split('/').filter(Boolean)
    if (segs[segs.length - 1] === 'index') segs.pop()
    return '/' + segs.map(normalizeSegment).join('/')
  }
  return null
}

/** A discovered route plus the node kind / slot id the App Router classification assigned. */
export interface DiscoveredSeed {
  seed: RouteSeed
  kind: NodeKind
  slotId?: string
}

/**
 * Discover Next.js routes from a ts-morph project. App Router page/default files are classified
 * (classifyAppRoute) so intercepting routes become modal nodes and parallel @slot routes become
 * distinct slot nodes; Pages Router files are plain screens. Deterministic (sorted by path) so
 * the app-vs-pages first-wins dedupe (a route declared by both routers) is reproducible.
 */
export function discoverRoutes(
  project: Project,
  projectDir: string,
): { seeds: RouteSeed[]; kindById: Map<string, NodeKind>; collisions: string[] } {
  const byId = new Map<string, RouteSeed>()
  const kindById = new Map<string, NodeKind>()
  const collisions: string[] = []
  const files = project.getSourceFiles().slice().sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1))
  for (const sf of files) {
    const rel = relative(projectDir, sf.getFilePath())
    const norm = rel.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^src\//, '')
    const app = norm.startsWith('app/') ? classifyAppRoute(rel) : null
    const fullPath = app ? app.path : nextRoutePath(rel)
    if (fullPath === null) continue
    const nodeId = app && app.nodeId ? app.nodeId : routeToNodeId(fullPath)
    const kind: NodeKind = app ? app.kind : 'screen'
    if (byId.has(nodeId)) {
      collisions.push(nodeId)
      continue
    }
    byId.set(nodeId, { fullPath, nodeId, componentName: null, componentFile: sf })
    kindById.set(nodeId, kind)
  }
  return { seeds: [...byId.values()], kindById, collisions }
}
