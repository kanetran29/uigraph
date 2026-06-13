// Command handler bodies for the uigraph CLI (milestone M4), factored out of the
// commander wiring in cli.ts so each one is a plain, directly-testable function.
// These tie the workspace together: adapters produce the IR, @uigraph/core/node
// persists it, and @uigraph/core diffs it. No commander or process state leaks in.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdapterContext, Logger, SoundinessNote, UiGraph } from '@uigraph/core'
import { diffGraphs } from '@uigraph/core'
import type { GraphDiff } from '@uigraph/core'
import { loadGraph, openStore, importJsonWorkspace, type ImportSummary } from '@uigraph/core/node'
import { reactAdapter } from '@uigraph/adapter-react'
import { angularAdapter } from '@uigraph/adapter-angular'

/** The SQLite database file that is a workspace's canonical store. */
export const DB_FILE = 'uigraph.db'

/** The frameworks the CLI can map; selects the adapter for a `map` run. */
export type AdapterName = 'react' | 'angular'

/**
 * A console-backed Logger satisfying the core adapter contract. `debug` is
 * suppressed by default so a normal `map` run is quiet apart from info/warn/error.
 */
export function consoleLogger(verbose = false): Logger {
  return {
    debug: (message, ...args) => {
      if (verbose) console.error(`[debug] ${message}`, ...args)
    },
    info: (message, ...args) => console.error(`[info] ${message}`, ...args),
    warn: (message, ...args) => console.error(`[warn] ${message}`, ...args),
    error: (message, ...args) => console.error(`[error] ${message}`, ...args),
  }
}

/**
 * Build the minimal AdapterContext the adapters need: utf8 file reads and a
 * console logger. Adapters open their own TS project, so no tsProject is required.
 */
export function makeContext(logger: Logger = consoleLogger()): AdapterContext {
  return {
    readFile: (path: string) => readFileSync(path, 'utf8'),
    log: logger,
  }
}

/** Pick the adapter object for a framework name; throws on an unknown name. */
export function pickAdapter(name: AdapterName) {
  if (name === 'react') return reactAdapter
  if (name === 'angular') return angularAdapter
  throw new Error(`unknown adapter: ${String(name)} (expected 'react' or 'angular')`)
}

/** Options for `runMap`: the project dir, the framework, and an optional db path. */
export interface RunMapOptions {
  dir: string
  adapter: AdapterName
  out?: string
  controls?: boolean
  logger?: Logger
}

/** The summary `runMap` returns (and prints): the db it wrote and headline counts. */
export interface MapSummary {
  dbPath: string
  nodes: number
  edges: number
  must: number
  may: number
  unknown: number
  soundiness: number
}

/** Absolute path to a workspace's SQLite database. */
export function dbPathFor(dir: string): string {
  return join(dir, DB_FILE)
}

/**
 * Run an adapter over a project directory and persist the resulting graph +
 * soundiness report into the workspace SQLite database (`--out` or
 * `<dir>/uigraph.db`), returning a summary of counts. The store's setBaseGraph
 * validates, so an invalid extraction can never be persisted.
 */
export async function runMap(opts: RunMapOptions): Promise<MapSummary> {
  const logger = opts.logger ?? consoleLogger()
  const adapter = pickAdapter(opts.adapter)
  const ctx = makeContext(logger)

  const { graph, soundiness } = await adapter.extract(opts.dir, { controls: opts.controls ?? false }, ctx)

  const dbPath = opts.out ?? dbPathFor(opts.dir)
  const store = openStore(dbPath)
  try {
    store.setBaseGraph(graph, soundiness)
  } finally {
    store.close()
  }

  return {
    dbPath,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    must: graph.edges.filter((e) => e.modality === 'must').length,
    may: graph.edges.filter((e) => e.modality === 'may').length,
    unknown: graph.edges.filter((e) => e.modality === 'unknown').length,
    soundiness: soundiness.length,
  }
}

/** Format a MapSummary as the multi-line block the `map` command prints. */
export function formatMapSummary(s: MapSummary): string {
  return [
    `Wrote ${s.dbPath}`,
    `  nodes: ${s.nodes}`,
    `  edges: ${s.edges} (must: ${s.must}, may: ${s.may}, unknown: ${s.unknown})`,
    `  soundiness notes: ${s.soundiness}`,
  ].join('\n')
}

/** Run the JSON→SQLite migration for a workspace dir; returns what was imported. */
export function runMigrate(dir: string): ImportSummary {
  const store = openStore(dbPathFor(dir))
  try {
    return importJsonWorkspace(dir, store)
  } finally {
    store.close()
  }
}

/** Format an ImportSummary as the block the `migrate` command prints. */
export function formatMigrateSummary(dir: string, s: ImportSummary): string {
  return [
    `Migrated ${dir} -> ${dbPathFor(dir)}`,
    `  graph: ${s.graph ? 'yes' : 'no'} · soundiness: ${s.soundiness}`,
    `  overlay: ${s.overlay ? 'yes' : 'no'} · observations: ${s.observations} · proposals: ${s.proposals}`,
  ].join('\n')
}

/** Options for `runDiff`: the two graph sources to compare (.db or .json). */
export interface RunDiffOptions {
  a: string
  b: string
}

/** Load a graph from a path: SQLite store when `.db`, else a JSON graph file. */
function loadGraphSource(path: string): UiGraph {
  if (path.endsWith('.db')) {
    const store = openStore(path)
    try {
      const g = store.getBaseGraph()
      if (g === null) throw new Error(`no base graph in ${path}`)
      return g
    } finally {
      store.close()
    }
  }
  return loadGraph(path)
}

/** Load two graph sources (.db or .json) and diff them by stable id. */
export function runDiff(opts: RunDiffOptions): GraphDiff {
  return diffGraphs(loadGraphSource(opts.a), loadGraphSource(opts.b))
}

/**
 * Render a GraphDiff as a human-readable, line-per-change summary: added/removed
 * nodes and edges by id, and each changed edge with the names of its differing
 * fields, so a behavior change is explainable edge by edge.
 */
export function formatDiff(diff: GraphDiff): string {
  const lines: string[] = []
  for (const n of diff.addedNodes) lines.push(`+ node ${n.id} (${n.label})`)
  for (const n of diff.removedNodes) lines.push(`- node ${n.id} (${n.label})`)
  for (const e of diff.addedEdges) lines.push(`+ edge ${e.id}: ${e.from} -> ${e.to} (${e.modality})`)
  for (const e of diff.removedEdges) lines.push(`- edge ${e.id}: ${e.from} -> ${e.to} (${e.modality})`)
  for (const c of diff.changedEdges) lines.push(`~ edge ${c.id}: changed [${c.fields.join(', ')}]`)
  if (lines.length === 0) return 'No differences.'
  return lines.join('\n')
}

/** Read a workspace's soundiness report from its SQLite store (empty if none). */
export function readSoundiness(dir: string): SoundinessNote[] {
  const store = openStore(dbPathFor(dir))
  try {
    return store.getSoundiness()
  } finally {
    store.close()
  }
}
