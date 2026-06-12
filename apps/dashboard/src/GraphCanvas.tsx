// The graph canvas: renders the merged UiGraph with @xyflow/react. Screen nodes
// become ReactFlow nodes laid out by BFS depth; control nodes become ReactFlow
// subflow children nested inside their parent screen (parentId + extent:'parent').
// Edges become ReactFlow edges styled by modality (must=solid, may=dashed,
// unknown=dotted) and tinted when their source is manual — including control→screen
// behavior edges. Selecting a node/edge drives the Inspector; connecting two nodes
// raises an "add edge" request the parent turns into an overlay edit.

import { useMemo, useState, type CSSProperties } from 'react'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ControlMeta, GraphEdge, GraphNode, Modality, Proposal, Proposals, UiGraph } from '@uigraph/core'
import { layoutGraph } from './layout'

/** What the canvas reports as the current selection, or null when nothing is selected. */
export type Selection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null

/** Props for the canvas: the graph to draw, the selection, the highlighted path, and callbacks. */
export interface GraphCanvasProps {
  graph: UiGraph
  proposals: Proposals
  selection: Selection
  pathEdgeIds: Set<string>
  onSelect: (selection: Selection) => void
  onConnect: (from: string, to: string) => void
}

/** The ghost-edge hue: a distinct violet, unmistakably separate from must/may/manual edges. */
const GHOST_COLOR = '#a855f7'

/** A glyph prefix per control type, so each chip reads as its kind at a glance. */
function controlGlyph(controlType: string): string {
  switch (controlType) {
    case 'button':
      return '▸'
    case 'input':
      return '▭'
    case 'richtext':
      return '¶'
    case 'checkbox':
      return '☑'
    case 'select':
      return '▾'
    case 'form':
      return '⊞'
    default:
      return '•'
  }
}

/** An accent colour per control type, used for the chip's border/glyph. */
function controlTone(controlType: string): string {
  switch (controlType) {
    case 'button':
      return '#2563eb'
    case 'input':
      return '#0891b2'
    case 'richtext':
      return '#0d9488'
    case 'checkbox':
      return '#65a30d'
    case 'select':
      return '#ca8a04'
    case 'form':
      return '#9333ea'
    default:
      return '#64748b'
  }
}

/** Dash pattern per modality: must is solid, may is dashed, unknown is dotted. */
function strokeDash(modality: Modality): string | undefined {
  if (modality === 'may') return '6 4'
  if (modality === 'unknown') return '2 4'
  return undefined
}

/** Edge stroke colour: highlighted path green, manual edits violet, otherwise slate. */
function strokeColor(edge: GraphEdge, highlighted: boolean): string {
  if (highlighted) return '#16a34a'
  if (edge.source === 'manual') return '#7c3aed'
  return '#475569'
}

/** Compose an edge label from its event and effect, collapsing redundant duplicates. */
function edgeLabel(edge: GraphEdge): string {
  if (!edge.effect || edge.effect === edge.event || edge.effect === 'navigate') return edge.event
  return `${edge.event} · ${edge.effect}`
}

/**
 * The label content for a control node: a glyph + name on the first line, then one
 * small chip per effect ("api POST /api/orders", "state setEmail").
 */
function ControlLabel(props: { control: ControlMeta; label: string }): JSX.Element {
  const { control, label } = props
  const tone = controlTone(control.controlType)
  const name = control.name ?? label
  return (
    <div className="control-node">
      <div className="control-head">
        <span className="control-glyph" style={{ color: tone }}>
          {controlGlyph(control.controlType)}
        </span>
        <span className="control-name">{name}</span>
        <span className="control-type">{control.controlType}</span>
      </div>
      {control.events && control.events.length > 0 ? (
        <div className="control-events-line">{control.events.join(', ')}</div>
      ) : null}
    </div>
  )
}

/**
 * Whether a node id was contributed by the manual overlay. The merged graph keeps
 * the node's own fields but not its provenance, so we infer "manual" from any
 * manual edge touching it; this only tints, it is not authoritative.
 */
function isManualNode(graph: UiGraph, nodeId: string): boolean {
  return graph.edges.some((e) => e.source === 'manual' && (e.from === nodeId || e.to === nodeId))
}

/** Box style for a screen node, tinted violet when manual. */
function screenStyle(manual: boolean, size: { width: number; height: number }): CSSProperties {
  return {
    whiteSpace: 'pre-line',
    borderRadius: 8,
    border: `2px solid ${manual ? '#7c3aed' : '#94a3b8'}`,
    background: manual ? '#f5f3ff' : '#ffffff',
    fontSize: 12,
    padding: 8,
    width: size.width,
    height: size.height,
  }
}

/** Box style for a control node, accented by its control type (manual still tints). */
function controlStyle(manual: boolean, control: ControlMeta, size: { width: number; height: number }): CSSProperties {
  const tone = manual ? '#7c3aed' : controlTone(control.controlType)
  return {
    borderRadius: 6,
    border: `1px solid ${tone}`,
    background: manual ? '#f5f3ff' : '#f8fafc',
    fontSize: 11,
    padding: 6,
    width: size.width,
    minHeight: size.height,
  }
}

/**
 * Map UiGraph nodes to positioned ReactFlow nodes. Screens get an absolute
 * position; controls get a parent-relative position plus parentId/extent so
 * @xyflow/react renders them nested. IMPORTANT: a parent must precede its children
 * in the array, so screens are emitted first and controls after.
 */
function toFlowNodes(graph: UiGraph, selection: Selection, expanded: ReadonlySet<string>): Node[] {
  const { positions, sizes } = layoutGraph(graph, expanded)
  const selectedId = selection?.kind === 'node' ? selection.node.id : null

  const childCount = new Map<string, number>()
  for (const n of graph.nodes) {
    if (n.kind === 'control' && n.parent !== undefined) childCount.set(n.parent, (childCount.get(n.parent) ?? 0) + 1)
  }

  const screens: Node[] = []
  const controls: Node[] = []
  for (const n of graph.nodes) {
    const manual = n.id.startsWith('n_manual') || isManualNode(graph, n.id)
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const size = sizes.get(n.id) ?? { width: 200, height: 64 }
    const selected = n.id === selectedId

    if (n.kind === 'control' && n.control && n.parent !== undefined) {
      if (!expanded.has(n.parent)) continue
      controls.push({
        id: n.id,
        position: pos,
        parentId: n.parent,
        extent: 'parent',
        data: { label: <ControlLabel control={n.control} label={n.label} /> },
        selected,
        style: controlStyle(manual, n.control, size),
      })
    } else {
      const count = childCount.get(n.id) ?? 0
      const base = n.route ? `${n.label}\n${n.route}` : n.label
      const label = count > 0 && !expanded.has(n.id) ? `${base}\n▸ ${count} control${count > 1 ? 's' : ''}` : base
      screens.push({
        id: n.id,
        position: pos,
        data: { label },
        selected,
        style: screenStyle(manual, size),
      })
    }
  }

  return [...screens, ...controls]
}

/**
 * Map UiGraph edges to ReactFlow edges. Behavior edges out of control nodes are
 * dense, so by default they are hidden — shown only when their control (or its
 * parent screen) is selected, when highlighted by a planned path, or when the
 * "show control edges" toggle is on. Screen→screen route edges always render.
 * Control edges are drawn lighter and only labelled when relevant.
 */
function toFlowEdges(graph: UiGraph, selection: Selection, pathEdgeIds: Set<string>, expanded: ReadonlySet<string>): Edge[] {
  const selectedEdgeId = selection?.kind === 'edge' ? selection.edge.id : null
  const controlParent = new Map<string, string | undefined>()
  for (const n of graph.nodes) if (n.kind === 'control') controlParent.set(n.id, n.parent)

  const out: Edge[] = []
  for (const e of graph.edges) {
    const isControlEdge = controlParent.has(e.from) || controlParent.has(e.to)
    const highlighted = pathEdgeIds.has(e.id)
    const selected = e.id === selectedEdgeId
    const parentExpanded =
      (controlParent.has(e.from) && expanded.has(controlParent.get(e.from) ?? '')) ||
      (controlParent.has(e.to) && expanded.has(controlParent.get(e.to) ?? ''))
    const touchesSelection = parentExpanded

    if (isControlEdge && !(highlighted || selected || parentExpanded)) continue

    const color = strokeColor(e, highlighted)
    const reveal = highlighted || selected || touchesSelection
    out.push({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      label: !isControlEdge || reveal ? edgeLabel(e) : undefined,
      animated: highlighted,
      selected,
      labelStyle: { fontSize: 10, fill: color },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      style: {
        stroke: color,
        strokeWidth: highlighted ? 3 : e.source === 'manual' ? 2 : 1.4,
        strokeOpacity: isControlEdge && !reveal ? 0.45 : 1,
        strokeDasharray: strokeDash(e.modality),
      },
    })
  }
  return out
}

/**
 * Map quarantined proposals to dashed, half-opacity ghost edges. Only `kind:'edge'`
 * proposals whose `screen` and `to` are BOTH real screen nodes in the graph become
 * ghost edges — proposals pointing at tokens like '<modal>'/'<dynamic>' have no node
 * to anchor to and live only in the panel. Ghosts use a distinct violet hue, a dotted
 * stroke, and 50% opacity so they read as "proposed / not proven" at a glance.
 */
function toGhostEdges(graph: UiGraph, proposals: Proposal[]): Edge[] {
  const screenIds = new Set<string>()
  for (const n of graph.nodes) if (n.kind !== 'control') screenIds.add(n.id)

  const out: Edge[] = []
  for (const p of proposals) {
    if (p.kind !== 'edge' || p.to === undefined) continue
    if (!screenIds.has(p.screen) || !screenIds.has(p.to)) continue
    out.push({
      id: `ghost_${p.id}`,
      source: p.screen,
      target: p.to,
      type: 'smoothstep',
      label: p.category,
      selectable: false,
      labelStyle: { fontSize: 9, fill: GHOST_COLOR },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.7 },
      style: {
        stroke: GHOST_COLOR,
        strokeWidth: 1.6,
        strokeOpacity: 0.5,
        strokeDasharray: '2 4',
      },
    })
  }
  return out
}

/**
 * Render the interactive graph. Memoizes the node/edge mapping on the inputs so a
 * pan/zoom does not recompute the layout. Wraps ReactFlow with a Background grid
 * and Controls, and forwards selection and connect events to the parent. A
 * "show proposals" toggle overlays dashed ghost edges for proposed transitions
 * (default OFF so the proven graph stays clean).
 */
export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const { graph, proposals, selection, pathEdgeIds, onSelect, onConnect } = props
  const [expandAll, setExpandAll] = useState(false)
  const [showProposals, setShowProposals] = useState(false)

  const expanded = useMemo(() => {
    const withChildren = new Set<string>()
    for (const n of graph.nodes) if (n.kind === 'control' && n.parent !== undefined) withChildren.add(n.parent)
    if (expandAll) return withChildren
    const set = new Set<string>()
    if (selection?.kind === 'node') {
      const n = selection.node
      if (n.kind === 'control' && n.parent !== undefined) set.add(n.parent)
      else if (withChildren.has(n.id)) set.add(n.id)
    }
    return set
  }, [graph, selection, expandAll])

  const nodes = useMemo(() => toFlowNodes(graph, selection, expanded), [graph, selection, expanded])
  const edges = useMemo(() => {
    const base = toFlowEdges(graph, selection, pathEdgeIds, expanded)
    if (!showProposals) return base
    return [...base, ...toGhostEdges(graph, proposals.proposals)]
  }, [graph, proposals, selection, pathEdgeIds, expanded, showProposals])

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    const found = graph.nodes.find((n) => n.id === node.id)
    if (found) onSelect({ kind: 'node', node: found })
  }
  const handleEdgeClick: EdgeMouseHandler = (_evt, edge) => {
    const found = graph.edges.find((e) => e.id === edge.id)
    if (found) onSelect({ kind: 'edge', edge: found })
  }
  const handleConnect = (conn: Connection) => {
    if (conn.source && conn.target) onConnect(conn.source, conn.target)
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onConnect={handleConnect}
      onPaneClick={() => onSelect(null)}
      fitView
    >
      <Background />
      <Controls />
      <Panel position="top-left">
        <label className="edge-toggle">
          <input type="checkbox" checked={expandAll} onChange={(e) => setExpandAll(e.target.checked)} />
          expand all controls
        </label>
        <label className="edge-toggle">
          <input type="checkbox" checked={showProposals} onChange={(e) => setShowProposals(e.target.checked)} />
          show proposals
        </label>
      </Panel>
    </ReactFlow>
  )
}
