// Mutation tools for the @uigraph/mcp server: the overlay write path
// (update_graph) and the named-scenario controls (list_scenarios / set_scenario).
// Edits touch the OVERLAY only — never the proven base — and are validated before
// persist. Pure over a ToolContext.

import type { GraphEdge, GraphNode, Overlay } from '@uigraph/core'
import { emptyOverlay, hashValue, validateOverlay } from '@uigraph/core'
import { dbPath, withStore, type ToolContext } from './context'

/** A manual edit applied to the overlay only; one of five discriminated ops. */
export type UpdateOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'editNode'; node: GraphNode }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'editEdge'; edge: GraphEdge }
  | { kind: 'remove'; id: string }

/** Arguments for update_graph: a single overlay edit. */
export interface UpdateGraphArgs {
  op: UpdateOp
}

/** update_graph result: the op applied and the overlay's element counts after saving. */
export interface UpdateGraphResult {
  applied: UpdateOp['kind']
  addedNodes: number
  editedNodes: number
  addedEdges: number
  editedEdges: number
  removedRefs: number
}

/**
 * Force an edge to `source: 'manual'`, the only provenance the overlay accepts.
 * Edits arrive from an agent and must not claim static/runtime origin, nor a
 * proven `must` modality — a human/agent assertion is at most a `may`-edge.
 */
function asManualEdge(edge: GraphEdge): GraphEdge {
  return { ...edge, source: 'manual', modality: edge.modality === 'must' ? 'may' : edge.modality, witness: undefined }
}

/**
 * Apply a manual edit to the OVERLAY only (never the base), validate the result
 * with validateOverlay, and persist it to the store. Supports addNode, addEdge,
 * editEdge, and remove (by id). Throws if the resulting overlay is invalid.
 */
export function updateGraph(ctx: ToolContext, args: UpdateGraphArgs): UpdateGraphResult {
  return withStore(ctx, (store) => {
    const base = store.getBaseGraph()
    if (base === null) throw new Error(`no base graph in ${dbPath(ctx)} — run \`uigraph map\` or \`uigraph migrate\` first`)
    const overlay: Overlay = store.getOverlay() ?? emptyOverlay(hashValue(base))
    const op = args.op

    switch (op.kind) {
      case 'addNode':
        overlay.addedNodes.push(op.node)
        break
      case 'editNode':
        overlay.editedNodes = [...(overlay.editedNodes ?? []).filter((n) => n.id !== op.node.id), op.node]
        break
      case 'addEdge':
        overlay.addedEdges.push(asManualEdge(op.edge))
        break
      case 'editEdge':
        overlay.editedEdges.push(asManualEdge(op.edge))
        break
      case 'remove':
        overlay.removedRefs.push(op.id)
        break
    }

    const errs = validateOverlay(overlay)
    if (errs.length > 0) throw new Error(`Invalid overlay after ${op.kind}:\n  ${errs.map((e) => e.message).join('\n  ')}`)

    store.setOverlay(overlay)
    return {
      applied: op.kind,
      addedNodes: overlay.addedNodes.length,
      editedNodes: (overlay.editedNodes ?? []).length,
      addedEdges: overlay.addedEdges.length,
      editedEdges: overlay.editedEdges.length,
      removedRefs: overlay.removedRefs.length,
    }
  })
}

/** The set of named planning scenarios (overlays) and which one is active. */
export interface ScenariosResult {
  active: string
  names: string[]
}

/** List the planning scenarios (named overlays) and the active one. */
export function listScenarios(ctx: ToolContext): ScenariosResult {
  return withStore(ctx, (store) => ({ active: store.getActiveScenario(), names: store.listScenarios() }))
}

/** Arguments for set_scenario: the scenario name to activate (created empty if new). */
export interface SetScenarioArgs {
  name: string
}

/**
 * Switch the active planning scenario — subsequent overlay edits + the merged graph
 * target it, so you can draft/toggle/compare features independently. Creates an
 * empty scenario if the name is new. Returns the active name + the full list.
 */
export function setScenario(ctx: ToolContext, args: SetScenarioArgs): ScenariosResult {
  return withStore(ctx, (store) => {
    store.setActiveScenario(args.name)
    return { active: store.getActiveScenario(), names: store.listScenarios() }
  })
}
