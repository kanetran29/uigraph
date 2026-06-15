// A per-user registry of workspaces (the projects a user maps), so the dashboard/serve can
// switch between several at once. Orthogonal to the per-workspace SQLite store: this holds
// only POINTERS (absolute dir + metadata), never graph data, so it can't corrupt a DB.
// Node-only (node:fs/os) — re-exported from ./node, NEVER ./index (browser bundle). The
// pure model (slugify/makeId/upsert/remove/find) takes a canonical dir + caller-supplied
// addedAt (clock-free, like fingerprint); the IO shell reads/writes ~/.uigraph/workspaces.json.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** One registered workspace: an opaque id, a display name, the absolute dir, the adapter. */
export interface WorkspaceEntry {
  id: string
  name: string
  dir: string
  adapter: string
  addedAt: string
}
export interface Registry {
  version: 0
  workspaces: WorkspaceEntry[]
}

/** A client-facing workspace summary — the absolute dir is OMITTED (never sent to a browser). */
export interface WorkspaceSummary {
  id: string
  name: string
  adapter: string
  available: boolean
}

export function emptyRegistry(): Registry {
  return { version: 0, workspaces: [] }
}

/** Lowercase to a filename/url-safe slug; empty input → 'workspace'. */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out.length > 0 ? out : 'workspace'
}

/** A small deterministic string fold for a stable id-collision suffix. */
function fold(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** A stable opaque id for a workspace: slug(name), suffixed with a dir-hash on collision. */
export function makeId(name: string, dir: string, taken: ReadonlySet<string>): string {
  const base = slugify(name)
  if (!taken.has(base)) return base
  return `${base}-${fold(dir).slice(0, 6)}`
}

/**
 * Add or update a workspace, keyed by its (already-canonical, absolute) dir. An existing
 * dir keeps its id + addedAt (cached client refs stay valid) and only updates name/adapter.
 * Pure — the caller canonicalizes the dir + supplies addedAt.
 */
export function upsertWorkspace(reg: Registry, dir: string, name: string, adapter: string, addedAt: string): Registry {
  const existing = reg.workspaces.find((w) => resolve(w.dir) === resolve(dir))
  if (existing) {
    return { ...reg, workspaces: reg.workspaces.map((w) => (w === existing ? { ...w, name, adapter } : w)) }
  }
  const id = makeId(name, dir, new Set(reg.workspaces.map((w) => w.id)))
  return { ...reg, workspaces: [...reg.workspaces, { id, name, dir, adapter, addedAt }] }
}

/** Remove a workspace by id or by (resolved) dir; a no-op miss returns the registry unchanged. */
export function removeWorkspace(reg: Registry, idOrDir: string): Registry {
  return { ...reg, workspaces: reg.workspaces.filter((w) => w.id !== idOrDir && resolve(w.dir) !== resolve(idOrDir)) }
}

/** Find a workspace by its opaque id (strict equality — never treated as a path). */
export function findWorkspace(reg: Registry, id: string): WorkspaceEntry | undefined {
  return reg.workspaces.find((w) => w.id === id)
}

/** Canonicalize a dir to an absolute realpath for stable identity (collapses symlinks/`..`). */
export function canonicalDir(dir: string): string {
  const abs = resolve(dir)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

/** Validate a parsed registry, throwing on a corrupted/hand-edited file. */
function assertRegistryShape(raw: unknown): asserts raw is Registry {
  if (typeof raw !== 'object' || raw === null) throw new Error('registry: not an object')
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.workspaces)) throw new Error('registry: workspaces is not an array')
  for (const w of r.workspaces) {
    const e = w as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) throw new Error('registry: entry id must be a non-empty string')
    if (typeof e.dir !== 'string' || !isAbsolute(e.dir)) throw new Error('registry: entry dir must be an absolute path')
  }
}

/** The registry file path: $UIGRAPH_HOME/workspaces.json, else ~/.uigraph/workspaces.json. */
export function registryPath(): string {
  const home = process.env.UIGRAPH_HOME ?? join(homedir(), '.uigraph')
  return join(home, 'workspaces.json')
}

/** Read the registry, or an empty one when the file is absent. Throws on a corrupted file. */
export function readRegistry(): Registry {
  const path = registryPath()
  if (!existsSync(path)) return emptyRegistry()
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  assertRegistryShape(raw)
  return raw
}

/** Write the registry atomically (tmp + rename), creating the home dir. Last-writer-wins. */
export function writeRegistry(reg: Registry): void {
  const path = registryPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n')
  renameSync(tmp, path)
}

/** A client-safe summary list (dir omitted); `available` reflects a callback freshness probe. */
export function summarize(reg: Registry, isAvailable: (entry: WorkspaceEntry) => boolean): WorkspaceSummary[] {
  return reg.workspaces.map((w) => ({ id: w.id, name: w.name, adapter: w.adapter, available: isAvailable(w) }))
}

/** Suggest a display name for a dir (its basename). */
export function defaultName(dir: string): string {
  return basename(canonicalDir(dir))
}
