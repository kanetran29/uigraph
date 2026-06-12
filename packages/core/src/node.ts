// Node-only IO helpers (feature F1.2). Separated from the browser-safe index so
// the dashboard can import @uigraph/core without pulling in node:fs. The CLI and
// MCP server import these from "@uigraph/core/node".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Overlay, UiGraph } from './ir'
import { assertGraphShape, assertOverlayShape } from './schema'
import { validateGraph } from './validate'

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
