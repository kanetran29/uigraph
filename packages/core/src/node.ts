// Node-only IO helpers (feature F1.2). Separated from the browser-safe index so
// the dashboard can import @uigraph/core without pulling in node:fs. The CLI and
// MCP server import these from "@uigraph/core/node".

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Overlay, UiGraph } from './ir'
import type { SoundinessNote } from './adapter'
import type { Observation } from './runtime'
import type { Proposals } from './proposals'
import type { ApiBindings } from './openapi'
import { assertGraphShape, assertOverlayShape } from './schema'
import { validateGraph } from './validate'
import { validateProposals } from './proposals'
import type { Store } from './store'

export { Store, openStore, type ProposalQuery } from './store'
export { fingerprintSources, compareFingerprint, type Fingerprint, type FileScan, type FreshnessDiff } from './fingerprint'

/** Read and parse a UiGraph JSON file, asserting its shape and invariants. */
export function loadGraph(path: string): UiGraph {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  assertGraphShape(parsed)
  const errs = validateGraph(parsed)
  if (errs.length > 0) throw new Error(`Invalid graph at ${path}:\n  ${errs.map((e) => e.message).join('\n  ')}`)
  return parsed
}

/** Serialize a graph to a JSON file (pretty-printed), creating parent dirs. */
export function saveGraph(path: string, graph: UiGraph): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(graph, null, 2) + '\n', 'utf8')
}

/** Read and parse an Overlay JSON file, asserting its shape. */
export function loadOverlay(path: string): Overlay {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  assertOverlayShape(parsed)
  return parsed
}

/** Serialize an overlay to a JSON file, creating parent dirs. */
export function saveOverlay(path: string, overlay: Overlay): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(overlay, null, 2) + '\n', 'utf8')
}

/** Read and parse a quarantined proposals sidecar, asserting it is well-formed. */
export function loadProposals(path: string): Proposals {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  const errs = validateProposals(parsed)
  if (errs.length > 0) throw new Error(`Invalid proposals at ${path}:\n  ${errs.map((e) => e.message).join('\n  ')}`)
  return parsed as Proposals
}

/** Serialize a proposals sidecar to a JSON file, creating parent dirs. */
export function saveProposals(path: string, proposals: Proposals): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(proposals, null, 2) + '\n', 'utf8')
}

/** Read and parse a JSON OpenAPI spec file into a plain object. */
export function loadOpenApi(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`OpenAPI spec at ${path} is not an object`)
  return parsed as Record<string, unknown>
}

/** Serialize an api-bindings sidecar to a JSON file, creating parent dirs. */
export function saveApiBindings(path: string, bindings: ApiBindings): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(bindings, null, 2) + '\n', 'utf8')
}

/** Read and parse an api-bindings sidecar JSON file. */
export function loadApiBindings(path: string): ApiBindings {
  return JSON.parse(readFileSync(path, 'utf8')) as ApiBindings
}

/** What a workspace import found and loaded into the SQLite store. */
export interface ImportSummary {
  graph: boolean
  soundiness: number
  overlay: boolean
  observations: number
  proposals: number
}

/**
 * One-shot migration: read whatever legacy JSON sidecars exist in a workspace dir
 * (ui-graph.json + ui-graph.soundiness.json, ui-graph.overlay.json,
 * observations.log.jsonl, proposals.json) and load them into the given SQLite
 * store. Idempotent for documents; observations append, so call once per dir.
 */
export function importJsonWorkspace(dir: string, store: Store): ImportSummary {
  const summary: ImportSummary = { graph: false, soundiness: 0, overlay: false, observations: 0, proposals: 0 }

  const graphPath = join(dir, 'ui-graph.json')
  if (existsSync(graphPath)) {
    const soundPath = join(dir, 'ui-graph.soundiness.json')
    const soundiness: SoundinessNote[] = existsSync(soundPath) ? (JSON.parse(readFileSync(soundPath, 'utf8')) as SoundinessNote[]) : []
    store.setBaseGraph(loadGraph(graphPath), soundiness)
    summary.graph = true
    summary.soundiness = soundiness.length
  }

  const overlayPath = join(dir, 'ui-graph.overlay.json')
  if (existsSync(overlayPath)) {
    store.setOverlay(loadOverlay(overlayPath))
    summary.overlay = true
  }

  const obsPath = join(dir, 'observations.log.jsonl')
  if (existsSync(obsPath)) {
    for (const line of readFileSync(obsPath, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue
      store.appendObservation(JSON.parse(line) as Observation)
      summary.observations++
    }
  }

  const proposalsPath = join(dir, 'proposals.json')
  if (existsSync(proposalsPath)) {
    const sidecar = loadProposals(proposalsPath)
    store.setProposals(sidecar)
    summary.proposals = sidecar.proposals.length
  }

  return summary
}
