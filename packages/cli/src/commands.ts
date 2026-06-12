// Command handler bodies for the uigraph CLI (milestone M4), factored out of the
// commander wiring in cli.ts so each one is a plain, directly-testable function.
// These tie the workspace together: adapters produce the IR, @uigraph/core/node
// persists it, and @uigraph/core diffs it. No commander or process state leaks in.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AdapterContext, Logger, SoundinessNote } from '@uigraph/core'
import { diffGraphs } from '@uigraph/core'
import type { GraphDiff } from '@uigraph/core'
import { loadGraph, saveGraph } from '@uigraph/core/node'
import { reactAdapter } from '@uigraph/adapter-react'
import { angularAdapter } from '@uigraph/adapter-angular'

/** Standard file names a `map` run writes into the project directory. */
export const GRAPH_FILE = 'ui-graph.json'
export const SOUNDINESS_FILE = 'ui-graph.soundiness.json'

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

/** Options for `runMap`: the project dir, the framework, and an optional out path. */
export interface RunMapOptions {
  dir: string
  adapter: AdapterName
  out?: string
  controls?: boolean
  logger?: Logger
}

/** The summary `runMap` returns (and prints): where it wrote and the headline counts. */
export interface MapSummary {
  graphPath: string
  soundinessPath: string
  nodes: number
  edges: number
  must: number
  may: number
  unknown: number
  soundiness: number
}

/** Absolute path of the soundiness file that sits beside a given graph path. */
export function soundinessPathFor(graphPath: string): string {
  return join(dirname(graphPath), SOUNDINESS_FILE)
}

/**
 * Run an adapter over a project directory, persist the resulting graph (to
 * `--out` or `<dir>/ui-graph.json`) and its soundiness report (beside the graph),
 * and return a summary of counts. The base graph file is written via the core's
 * validating saveGraph so an invalid extraction can never be persisted.
 */
export async function runMap(opts: RunMapOptions): Promise<MapSummary> {
  const logger = opts.logger ?? consoleLogger()
  const adapter = pickAdapter(opts.adapter)
  const ctx = makeContext(logger)

  const { graph, soundiness } = await adapter.extract(opts.dir, { controls: opts.controls ?? false }, ctx)

  const graphPath = opts.out ?? join(opts.dir, GRAPH_FILE)
  const soundPath = soundinessPathFor(graphPath)

  saveGraph(graphPath, graph)
  writeSoundiness(soundPath, soundiness)

  return {
    graphPath,
    soundinessPath: soundPath,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    must: graph.edges.filter((e) => e.modality === 'must').length,
    may: graph.edges.filter((e) => e.modality === 'may').length,
    unknown: graph.edges.filter((e) => e.modality === 'unknown').length,
    soundiness: soundiness.length,
  }
}

/** Serialize a soundiness report to JSON (pretty-printed), creating parent dirs. */
export function writeSoundiness(path: string, notes: SoundinessNote[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(notes, null, 2) + '\n', 'utf8')
}

/** Format a MapSummary as the multi-line block the `map` command prints. */
export function formatMapSummary(s: MapSummary): string {
  return [
    `Wrote ${s.graphPath}`,
    `Wrote ${s.soundinessPath}`,
    `  nodes: ${s.nodes}`,
    `  edges: ${s.edges} (must: ${s.must}, may: ${s.may}, unknown: ${s.unknown})`,
    `  soundiness notes: ${s.soundiness}`,
  ].join('\n')
}

/** Options for `runDiff`: the two graph file paths to compare. */
export interface RunDiffOptions {
  a: string
  b: string
}

/** Load two graph files and diff them by stable id, returning the structured diff. */
export function runDiff(opts: RunDiffOptions): GraphDiff {
  const a = loadGraph(opts.a)
  const b = loadGraph(opts.b)
  return diffGraphs(a, b)
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

/** Resolve the base graph path for a workspace dir (the file `map` writes). */
export function graphPathFor(dir: string): string {
  return join(dir, GRAPH_FILE)
}

/** Resolve the soundiness file path for a workspace dir, if one was written. */
export function workspaceSoundinessPath(dir: string): string {
  return join(dir, SOUNDINESS_FILE)
}

/** Read a workspace's soundiness report, or null when none has been written. */
export function readSoundiness(dir: string): SoundinessNote[] | null {
  const path = workspaceSoundinessPath(dir)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as SoundinessNote[]
}
