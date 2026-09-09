// Mutation tools for the @ui-graph/mcp server: the overlay write path
// (update_graph) and the named-scenario controls (list_scenarios / set_scenario).
// Edits touch the OVERLAY only — never the proven base — and are validated before
// persist. Pure over a ToolContext.

import type { GraphEdge, GraphNode, Overlay } from '@ui-graph/core'
import { emptyOverlay, hashValue, validateOverlay } from '@ui-graph/core'
import { dbPath, loadMergedGraph, withStore, type ToolContext } from './context'

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

/** Arguments for name_control: the control id plus either a name to set or `clear: true`. */
export interface NameControlArgs {
  id: string
  name?: string
  clear?: boolean
}

/** name_control result: the control's id and its label after the fold (`name` null once cleared). */
export interface NameControlResult {
  id: string
  label: string
  name: string | null
}

/**
 * Give a control a durable human name, or clear one. Writes the names sidecar only
 * — the selector (and so the id) is never touched, so a name survives every re-map
 * that keeps the selector. Validates the id is a control (with control metadata,
 * else the fold could never apply the name) in the merged graph; the store rejects
 * an empty, multi-line/control-char or over-long name so a value the schema would
 * refuse as a label never reaches the sidecar. Throws otherwise. Returns the label
 * the fold now serves.
 */
export function nameControl(ctx: ToolContext, args: NameControlArgs): NameControlResult {
  const before = loadMergedGraph(ctx).nodes.find((n) => n.id === args.id)
  if (before === undefined) throw new Error(`unknown node id: ${args.id}`)
  if (before.kind !== 'control') throw new Error(`${args.id} is a ${before.kind}, not a control — only controls can be named`)
  if (before.control === undefined) throw new Error(`${args.id} has no control metadata — cannot be named`)
  if (args.clear === true) {
    withStore(ctx, (store) => store.clearControlName(args.id))
  } else {
    const name = args.name?.trim() ?? ''
    if (name.length === 0) throw new Error('a name must be non-empty')
    withStore(ctx, (store) => store.setControlName(args.id, name))
  }
  const after = loadMergedGraph(ctx).nodes.find((n) => n.id === args.id) as GraphNode
  return { id: after.id, label: after.label, name: after.control?.name ?? null }
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
