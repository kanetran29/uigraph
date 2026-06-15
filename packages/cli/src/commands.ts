// Command handler bodies for the uigraph CLI (milestone M4), factored out of the
// commander wiring in cli.ts so each one is a plain, directly-testable function.
// These tie the workspace together: adapters produce the IR, @uigraph/core/node
// persists it, and @uigraph/core diffs it. No commander or process state leaks in.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AdapterContext, Logger, SoundinessNote, UiGraph } from '@uigraph/core'
import { diffGraphs, planPath, buildSpecPlan, renderPlaywrightSpec, exportOverlaySpec, emptyOverlay, hashValue } from '@uigraph/core'
import type { GraphDiff } from '@uigraph/core'
import { loadGraph, openStore, importJsonWorkspace, type ImportSummary } from '@uigraph/core/node'
import { loadMergedGraph, listKit, readKitFile, readKitAll } from '@uigraph/mcp'
import { reactAdapter } from '@uigraph/adapter-react'
import { angularAdapter } from '@uigraph/adapter-angular'
import { vueAdapter } from '@uigraph/adapter-vue'
import { nextAdapter } from '@uigraph/adapter-next'

/** The SQLite database file that is a workspace's canonical store. */
export const DB_FILE = 'uigraph.db'

/** The frameworks the CLI can map; selects the adapter for a `map` run. */
export type AdapterName = 'react' | 'angular' | 'vue' | 'next'

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
  if (name === 'vue') return vueAdapter
  if (name === 'next') return nextAdapter
  throw new Error(`unknown adapter: ${String(name)} (expected 'react', 'angular', 'vue', or 'next')`)
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

/** Render the workspace overlay as a markdown "planned changes" spec. */
export function runExport(dir: string): string {
  const store = openStore(dbPathFor(dir))
  try {
    const base = store.getBaseGraph()
    if (base === null) throw new Error(`no graph in ${dir} — run \`uigraph map\` first`)
    return exportOverlaySpec(base, store.getOverlay() ?? emptyOverlay(hashValue(base)))
  } finally {
    store.close()
  }
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

/** Options for `runGen`: the workspace dir, the from/to node ids, and codegen knobs. */
export interface RunGenOptions {
  dir: string
  from: string
  to: string
  out?: string
  baseUrl?: string
  framework?: string
}

/** Result of a `gen` run: the rendered spec, its leg count, and where it was written. */
export interface GenSummary {
  from: string
  to: string
  legs: number
  out?: string
  spec: string
}

/**
 * Plan a path over the workspace graph and render it as an e2e spec. Throws when
 * the framework is unsupported or no path exists. Writes the spec to `--out` when
 * given, else returns it for printing.
 */
export function runGen(opts: RunGenOptions): GenSummary {
  const framework = opts.framework ?? 'playwright'
  if (framework !== 'playwright') throw new Error(`unsupported framework: ${framework} (only 'playwright')`)
  const graph = loadMergedGraph({ dir: opts.dir })
  const steps = planPath(graph, opts.from, opts.to)
  if (steps === null) throw new Error(`no path from ${opts.from} to ${opts.to}`)
  const plan = buildSpecPlan(graph, steps, { baseUrl: opts.baseUrl ?? '', title: `${opts.from} → ${opts.to}` })
  const spec = renderPlaywrightSpec(plan)
  if (opts.out !== undefined) {
    mkdirSync(dirname(opts.out), { recursive: true })
    writeFileSync(opts.out, spec, 'utf8')
  }
  return { from: opts.from, to: opts.to, legs: plan.legs.length, out: opts.out, spec }
}

/** Format a GenSummary for the `gen` command (header + the spec when not written to a file). */
export function formatGenSummary(s: GenSummary): string {
  const head = s.out !== undefined ? `Wrote ${s.out} (${s.legs} legs: ${s.from} → ${s.to})` : `Generated spec (${s.legs} legs: ${s.from} → ${s.to})`
  return s.out !== undefined ? head : `${head}\n\n${s.spec}`
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

/** Print the whole agent kit (skill + rules + guides + loop) for piping into an agent prompt or CI. */
export function runKitPrint(): string {
  return readKitAll()
}

/** Options for `uigraph kit install`: where to write, and whether to drop the Claude skill. */
export interface RunKitInstallOptions {
  dir?: string
  claude?: boolean
}

/**
 * Install the agent kit into a target. By default copies every kit file under
 * `<dir>/.uigraph/kit/` (preserving the manifest paths); with `--claude`, instead
 * drops SKILL.md at `<dir>/.claude/skills/uigraph/SKILL.md` for Claude Code. Returns
 * the list of written file paths.
 */
export function runKitInstall(opts: RunKitInstallOptions = {}): { written: string[] } {
  const root = opts.dir ?? process.cwd()
  if (opts.claude === true) {
    const out = join(root, '.claude', 'skills', 'uigraph', 'SKILL.md')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, readKitFile('SKILL.md'))
    return { written: [out] }
  }
  const base = join(root, '.uigraph', 'kit')
  const written: string[] = []
  for (const f of listKit()) {
    const out = join(base, f.path)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, readKitFile(f.path))
    written.push(out)
  }
  return { written }
}
