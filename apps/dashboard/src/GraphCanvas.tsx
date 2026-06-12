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
import type { ControlMeta, GraphEdge, GraphNode, Modality, UiGraph } from '@uigraph/core'
import { layoutGraph } from './layout'

/** What the canvas reports as the current selection, or null when nothing is selected. */
export type Selection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null

/** Props for the canvas: the graph to draw, the selection, the highlighted path, and callbacks. */
export interface GraphCanvasProps {
  graph: UiGraph
  selection: Selection
  pathEdgeIds: Set<string>
  onSelect: (selection: Selection) => void
  onConnect: (from: string, to: string) => void
}

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

/**
 * Split a typed effect string ("api:POST /api/orders", "state:setEmail", "submit")
 * into a short kind prefix and the rest, so it can render as "api POST /api/orders".
 */
function formatEffect(effect: string): string {
  const idx = effect.indexOf(':')
  if (idx === -1) return effect
  return `${effect.slice(0, idx)} ${effect.slice(idx + 1)}`
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
        <div className="control-events">
          {control.events.map((ev) => (
            <span key={ev} className="event-chip">
              {ev}
            </span>
          ))}
        </div>
      ) : null}
      {control.effects && control.effects.length > 0 ? (
        <div className="control-effects">
          {control.effects.map((eff) => (
            <span key={eff} className="effect-chip">
              {formatEffect(eff)}
            </span>
          ))}
        </div>
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
function toFlowNodes(graph: UiGraph, selection: Selection): Node[] {
  const { positions, sizes } = layoutGraph(graph)
  const selectedId = selection?.kind === 'node' ? selection.node.id : null

  const screens: Node[] = []
  const controls: Node[] = []
  for (const n of graph.nodes) {
    const manual = n.id.startsWith('n_manual') || isManualNode(graph, n.id)
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const size = sizes.get(n.id) ?? { width: 200, height: 64 }
    const selected = n.id === selectedId

    if (n.kind === 'control' && n.control && n.parent !== undefined) {
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
      screens.push({
        id: n.id,
        position: pos,
        data: { label: n.route ? `${n.label}\n${n.route}` : n.label },
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
function toFlowEdges(graph: UiGraph, selection: Selection, pathEdgeIds: Set<string>, showControlEdges: boolean): Edge[] {
  const selectedEdgeId = selection?.kind === 'edge' ? selection.edge.id : null
  const selectedNodeId = selection?.kind === 'node' ? selection.node.id : null
  const controlParent = new Map<string, string | undefined>()
  for (const n of graph.nodes) if (n.kind === 'control') controlParent.set(n.id, n.parent)

  const out: Edge[] = []
  for (const e of graph.edges) {
    const isControlEdge = controlParent.has(e.from) || controlParent.has(e.to)
    const highlighted = pathEdgeIds.has(e.id)
    const selected = e.id === selectedEdgeId
    const touchesSelection =
      selectedNodeId !== null &&
      (e.from === selectedNodeId ||
        e.to === selectedNodeId ||
        controlParent.get(e.from) === selectedNodeId ||
        controlParent.get(e.to) === selectedNodeId)

    if (isControlEdge && !(showControlEdges || highlighted || selected || touchesSelection)) continue

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
 * Render the interactive graph. Memoizes the node/edge mapping on the inputs so a
 * pan/zoom does not recompute the layout. Wraps ReactFlow with a Background grid
 * and Controls, and forwards selection and connect events to the parent.
 */
export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const { graph, selection, pathEdgeIds, onSelect, onConnect } = props
  const [showControlEdges, setShowControlEdges] = useState(false)

  const nodes = useMemo(() => toFlowNodes(graph, selection), [graph, selection])
  const edges = useMemo(
    () => toFlowEdges(graph, selection, pathEdgeIds, showControlEdges),
    [graph, selection, pathEdgeIds, showControlEdges],
  )

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
          <input type="checkbox" checked={showControlEdges} onChange={(e) => setShowControlEdges(e.target.checked)} />
          show control edges
        </label>
      </Panel>
    </ReactFlow>
  )
}
