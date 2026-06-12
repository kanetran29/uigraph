// Invariant validation (feature F1.3) — the enforcement arm of the golden
// invariant (docs/30-ir-spec-v0.md §4). Runs the structural shape check first,
// then the six semantic invariants. Returns a list of ValidationError (empty = valid).

import type { Overlay, UiGraph } from './ir'
import { validateGraphShape, validateOverlayShape } from './schema'

export interface ValidationError {
  code: string
  message: string
  id?: string
}

function dup<T>(items: T[], key: (t: T) => string): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const it of items) {
    const k = key(it)
    if (seen.has(k)) dups.add(k)
    seen.add(k)
  }
  return [...dups]
}

/**
 * Validate a base graph against invariants 1–6: shape, unique ids, no dangling
 * refs, witnessed static/runtime edges, no manual elements in the base, must-edge
 * provenance, and confidence range.
 */
export function validateGraph(graph: UiGraph): ValidationError[] {
  const errs: ValidationError[] = []
  for (const m of validateGraphShape(graph)) errs.push({ code: 'SHAPE', message: m })
  if (errs.length > 0) return errs

  for (const id of dup(graph.nodes, (n) => n.id)) errs.push({ code: 'DUP_NODE_ID', message: `duplicate node id "${id}"`, id })
  for (const id of dup(graph.edges, (e) => e.id)) errs.push({ code: 'DUP_EDGE_ID', message: `duplicate edge id "${id}"`, id })

  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  for (const e of graph.edges) {
    if (!nodeIds.has(e.from)) errs.push({ code: 'DANGLING_FROM', message: `edge "${e.id}" from unknown node "${e.from}"`, id: e.id })
    if (!nodeIds.has(e.to)) errs.push({ code: 'DANGLING_TO', message: `edge "${e.id}" to unknown node "${e.to}"`, id: e.id })

    if ((e.source === 'static' || e.source === 'runtime') && e.witness === undefined)
      errs.push({ code: 'UNWITNESSED', message: `edge "${e.id}" is ${e.source} but has no witness`, id: e.id })

    if (e.source === 'manual') errs.push({ code: 'MANUAL_IN_BASE', message: `base graph contains manual edge "${e.id}"`, id: e.id })

    if (e.modality === 'must' && e.source !== 'static' && e.source !== 'runtime')
      errs.push({ code: 'MUST_PROVENANCE', message: `must-edge "${e.id}" must be static or runtime, not ${e.source}`, id: e.id })

    if (e.confidence < 0 || e.confidence > 1) errs.push({ code: 'CONFIDENCE_RANGE', message: `edge "${e.id}" confidence ${e.confidence} out of [0,1]`, id: e.id })
  }

  return errs
}

/** Validate an overlay: shape + overlay purity (every element is source:'manual'). */
export function validateOverlay(overlay: Overlay): ValidationError[] {
  const errs: ValidationError[] = []
  for (const m of validateOverlayShape(overlay)) errs.push({ code: 'SHAPE', message: m })
  if (errs.length > 0) return errs

  for (const e of [...overlay.addedEdges, ...overlay.editedEdges]) {
    if (e.source !== 'manual') errs.push({ code: 'OVERLAY_NOT_MANUAL', message: `overlay edge "${e.id}" must be source:'manual'`, id: e.id })
    if (e.witness !== undefined && e.witness.source !== 'manual')
      errs.push({ code: 'OVERLAY_WITNESS', message: `overlay edge "${e.id}" witness must be manual`, id: e.id })
  }
  return errs
}
