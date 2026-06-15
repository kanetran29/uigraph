// The graph canvas: renders the merged UiGraph with @xyflow/react. Screen nodes
// become ReactFlow nodes laid out by dagre; control nodes become ReactFlow subflow
// children nested inside their parent screen (parentId + extent:'parent'). Node
// positions are OWNED by ReactFlow (useNodesState) so drags persist; the dagre
// layout is recomputed only when the graph STRUCTURE or the expanded-set changes.
// Edges are styled by modality (must=solid, may=dashed, unknown=dotted) and tinted
// by source (static=slate, manual=violet, runtime=emerald). Selecting a node
// emphasizes its incident edges and neighbours and dims the rest; labels show only
// for highlighted edges to keep the canvas readable.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  Panel,
  ReactFlow,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ControlMeta, GraphEdge, GraphNode, Modality, Proposals, Source, UiGraph } from '@uigraph/core'
import { layoutGraph, type GraphLayout } from './layout'

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

/** The ghost-edge hue: a distinct slate-violet, separate from the source palette. */
const GHOST_COLOR = '#a855f7'

/** Edge stroke colour per provenance source: static slate, manual violet, runtime emerald. */
const SOURCE_COLOR: Record<Source, string> = {
  static: 'var(--edge)',
  manual: 'var(--edge-manual)',
  runtime: 'var(--edge-runtime)',
}

/** The accent colour for highlighted edges (planned path / selection focus). */
const HIGHLIGHT_COLOR = 'var(--edge-highlight)'

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

/** Edge stroke colour: highlighted accent wins, otherwise the provenance source colour. */
function strokeColor(edge: GraphEdge, highlighted: boolean): string {
  if (highlighted) return HIGHLIGHT_COLOR
  return SOURCE_COLOR[edge.source] ?? SOURCE_COLOR.static
}

/** Compose an edge label from its event and effect, collapsing redundant duplicates. */
function edgeLabel(edge: GraphEdge): string {
  if (!edge.effect || edge.effect === edge.event || edge.effect === 'navigate') return edge.event
  return `${edge.event} · ${edge.effect}`
}

/** The data a FloatingEdge carries: an optional label drawn at the curve midpoint. */
interface FloatingEdgeData extends Record<string, unknown> {
  label?: string
}

/** Centre point of an internal node in absolute (flow) coordinates. */
function nodeCenter(n: InternalNode): { x: number; y: number; w: number; h: number } {
  const w = n.measured.width ?? 0
  const h = n.measured.height ?? 0
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, w, h }
}

/**
 * The point on `node`'s rectangular boundary that lies on the line toward
 * `other`'s centre — the standard React Flow "floating edge" intersection, so an
 * edge attaches to whichever side faces its neighbour (essential for a radial
 * layout where neighbours sit on every side).
 */
function boundaryPoint(node: InternalNode, other: InternalNode): { x: number; y: number } {
  const a = nodeCenter(node)
  const b = nodeCenter(other)
  const w = a.w / 2
  const h = a.h / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return { x: a.x, y: a.y }
  const scale = 1 / Math.max(Math.abs(dx) / (w || 1), Math.abs(dy) / (h || 1))
  return { x: a.x + dx * scale, y: a.y + dy * scale }
}

/** A stable ±1 from an edge id, so an edge always bows the same way and two edges
 * between the same pair (opposite directions) tend to bow apart rather than overlap. */
function edgeSign(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return h % 2 === 0 ? 1 : -1
}

/**
 * A floating edge: a quadratic curve between the two nodes' boundaries (computed
 * from their live positions, so it attaches to the facing side from any angle and
 * stays connected while dragging). The curve BOWS perpendicular to the straight
 * line — proportional to length — so a long edge arcs clear of any node sitting
 * between its endpoints, and parallel edges separate. A small endpoint gap keeps
 * the arrowhead off the node border. The label is an opaque pill at the curve's
 * midpoint via EdgeLabelRenderer, floating ABOVE nodes and edges.
 */
function FloatingEdge(props: EdgeProps<Edge<FloatingEdgeData>>): JSX.Element | null {
  const { id, source, target, data, markerEnd, style } = props
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null
  const a = nodeCenter(sourceNode)
  const b = nodeCenter(targetNode)
  const rawSp = boundaryPoint(sourceNode, targetNode)
  const rawTp = boundaryPoint(targetNode, sourceNode)
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / dist
  const uy = (b.y - a.y) / dist
  const GAP = 8
  const sp = { x: rawSp.x + ux * GAP, y: rawSp.y + uy * GAP }
  const tp = { x: rawTp.x - ux * GAP, y: rawTp.y - uy * GAP }
  const bow = edgeSign(id) * Math.min(dist * 0.16, 120)
  const mx = (sp.x + tp.x) / 2
  const my = (sp.y + tp.y) / 2
  const cx = mx + -uy * bow
  const cy = my + ux * bow
  const path = `M ${sp.x},${sp.y} Q ${cx},${cy} ${tp.x},${tp.y}`
  // Point on the quadratic at t=0.5, where the label rides the curve (off the
  // straight line, so it clears any node the chord would pass through).
  const labelX = 0.25 * sp.x + 0.5 * cx + 0.25 * tp.x
  const labelY = 0.25 * sp.y + 0.5 * cy + 0.25 * tp.y
  const label = data?.label
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div className="dagre-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

/**
 * The label content for a control node: a glyph + name on the first line, then a
 * compact events line beneath when the control has any.
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

/**
 * Box style for a screen node, tinted violet when manual. The multi-line label is
 * centred when collapsed; when expanded it is pinned to the top header strip so it
 * sits above the nested control grid rather than behind it.
 */
function screenStyle(manual: boolean, size: { width: number; height: number }, expanded: boolean): CSSProperties {
  return {
    whiteSpace: 'pre-line',
    borderRadius: 'var(--radius)',
    border: `2px solid ${manual ? 'var(--edge-manual)' : 'var(--node-border)'}`,
    background: manual ? 'var(--node-manual-bg)' : 'var(--node-bg)',
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.3,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: expanded ? 'flex-start' : 'center',
    padding: expanded ? '8px 8px 0' : 8,
    width: size.width,
    height: size.height,
  }
}

/** Box style for a materialized ghost STATE node (a proposed sub-state): dashed, ghost-tinted. */
function ghostStateStyle(): CSSProperties {
  return {
    borderRadius: 'var(--radius-sm)',
    border: `1.5px dashed ${GHOST_COLOR}`,
    background: 'var(--surface)',
    color: GHOST_COLOR,
    fontSize: 10,
    fontStyle: 'italic',
    padding: '4px 10px',
    opacity: 0.9,
  }
}

/** Box style for a control node, accented by its control type (manual still tints). */
function controlStyle(manual: boolean, control: ControlMeta, size: { width: number; height: number }): CSSProperties {
  const tone = manual ? 'var(--edge-manual)' : controlTone(control.controlType)
  return {
    borderRadius: 'var(--radius-sm)',
    border: `1px solid ${tone}`,
    background: manual ? 'var(--node-manual-bg)' : 'var(--node-subtle-bg)',
    color: 'var(--text)',
    fontSize: 11,
    padding: 6,
    width: size.width,
    minHeight: size.height,
  }
}

/**
 * Map UiGraph nodes to positioned ReactFlow nodes. Screens get an absolute
 * position; controls get a parent-relative position plus parentId/extent so
 * @xyflow/react renders them nested and draggable within the parent. A parent must
 * precede its children in the array, so screens are emitted first and controls after.
 */
function toFlowNodes(
  graph: UiGraph,
  layout: Pick<GraphLayout, 'positions' | 'sizes' | 'bands'>,
  expanded: ReadonlySet<string>,
  proposalCount: ReadonlyMap<string, number>,
): Node[] {
  const { positions, sizes, bands } = layout

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

    if (n.kind === 'control' && n.control && n.parent !== undefined) {
      if (!expanded.has(n.parent)) continue
      controls.push({
        id: n.id,
        position: pos,
        parentId: n.parent,
        extent: 'parent',
        data: { label: <ControlLabel control={n.control} label={n.label} /> },
        style: controlStyle(manual, n.control, size),
      })
    } else if (n.id.startsWith('ps_')) {
      screens.push({
        id: n.id,
        position: pos,
        data: { label: n.label },
        selectable: false,
        style: ghostStateStyle(),
      })
    } else {
      const count = childCount.get(n.id) ?? 0
      const base = n.route ? `${n.label}\n${n.route}` : n.label
      const withControls = count > 0 && !expanded.has(n.id) ? `${base}\n▸ ${count} control${count > 1 ? 's' : ''}` : base
      const pc = proposalCount.get(n.id) ?? 0
      const label = pc > 0 ? `${withControls}\n◆ ${pc} proposal${pc > 1 ? 's' : ''}` : withControls
      screens.push({
        id: n.id,
        position: pos,
        data: { label },
        style: screenStyle(manual, size, expanded.has(n.id)),
      })
    }
  }

  // Component bands: presentational boxes (parentId=screen) drawn BEHIND the controls,
  // labeling which component owns the controls inside. Never selectable, never edged.
  const bandNodes: Node[] = (bands ?? [])
    .filter((b) => expanded.has(b.parent))
    .map((b) => ({
      id: b.id,
      position: positions.get(b.id) ?? { x: 0, y: 0 },
      parentId: b.parent,
      extent: 'parent' as const,
      selectable: false,
      draggable: false,
      data: { label: b.label },
      style: bandStyle(sizes.get(b.id) ?? { width: 200, height: 64 }),
    }))

  // Order: screens, then bands (behind), then controls (on top).
  return [...screens, ...bandNodes, ...controls]
}

/** Style for a component band box: a subtle outlined container with its label as a top header. */
function bandStyle(size: { width: number; height: number }): CSSProperties {
  return {
    width: size.width,
    height: size.height,
    background: 'var(--node-subtle-bg, rgba(99,102,241,0.04))',
    border: '1px dashed var(--node-border, #c7c9d9)',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: 'var(--muted, #6b7280)',
    textAlign: 'left',
    padding: '4px 8px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    pointerEvents: 'none',
  }
}

/** The set of edge styling inputs that decide emphasis, dimming, and label visibility. */
interface EdgeContext {
  selection: Selection
  pathEdgeIds: Set<string>
  expanded: ReadonlySet<string>
  hoveredEdgeId: string | null
  incidentEdgeIds: Set<string>
  focusEdgeActive: boolean
}

/**
 * Map UiGraph edges to ReactFlow edges. Behavior edges out of control nodes are
 * dense, so by default they are hidden — shown only when their control's parent
 * screen is expanded, when highlighted by a planned path, or when selected.
 * Screen→screen route edges always render. An edge label is shown ONLY when the
 * edge is emphasized (selected, on the planned path, incident to the selected node,
 * or hovered); non-emphasized edges are dimmed when a selection is active. Real
 * screen↔screen edges with a dagre route render as the custom 'dagre' edge type so
 * arrows follow the spaced, de-crossed polyline; control/ghost edges stay smoothstep.
 */
function toFlowEdges(graph: UiGraph, ctx: EdgeContext): Edge[] {
  const { selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, focusEdgeActive } = ctx
  const selectedEdgeId = selection?.kind === 'edge' ? selection.edge.id : null
  const hasNodeSelection = selection?.kind === 'node'
  const controlParent = new Map<string, string | undefined>()
  for (const n of graph.nodes) if (n.kind === 'control') controlParent.set(n.id, n.parent)
  const modalIds = new Set<string>()
  for (const n of graph.nodes) if (n.kind === 'modal') modalIds.add(n.id)

  // A runtime-confirmed edge supersedes its static/may twin between the same pair:
  // render only the witnessed (green) edge so the canvas is not doubled up.
  const runtimePairs = new Set<string>()
  for (const e of graph.edges) if (e.source === 'runtime') runtimePairs.add(`${e.from}->${e.to}`)

  const out: Edge[] = []
  for (const e of graph.edges) {
    if (e.source !== 'runtime' && runtimePairs.has(`${e.from}->${e.to}`)) continue
    // An edge that opens a modal originates at a control but is the only way the
    // modal connects to the graph; draw it from the control's PARENT screen so the
    // dialog has a visible incoming arrow (Checkout → ConfirmDialog) instead of
    // floating disconnected. Such an edge is treated as a screen edge, not hidden.
    const opensModal = modalIds.has(e.to) && controlParent.has(e.from)
    const renderFrom = opensModal ? controlParent.get(e.from) ?? e.from : e.from
    const isControlEdge = (controlParent.has(e.from) || controlParent.has(e.to)) && !opensModal
    const onPath = pathEdgeIds.has(e.id)
    const selected = e.id === selectedEdgeId
    const incident = incidentEdgeIds.has(e.id)
    const hovered = e.id === hoveredEdgeId
    const parentExpanded =
      (controlParent.has(e.from) && expanded.has(controlParent.get(e.from) ?? '')) ||
      (controlParent.has(e.to) && expanded.has(controlParent.get(e.to) ?? ''))

    if (isControlEdge && !(onPath || selected || incident || parentExpanded)) continue

    const emphasized = onPath || selected || incident || hovered
    // Dim every edge outside the focused flow (node/edge selection OR planned path);
    // an edge on the path, incident, or selected stays lit.
    const dimmed = ((hasNodeSelection || focusEdgeActive) && !incident && !selected && !onPath) || (isControlEdge && !emphasized && !parentExpanded)
    const color = strokeColor(e, onPath || selected)
    const baseWidth = e.source === 'manual' ? 2 : 1.4
    const width = onPath ? 3 : selected ? 2.8 : emphasized ? 2.4 : baseWidth
    const opacity = dimmed ? 0.18 : emphasized ? 1 : 0.85
    // Screen→screen edges are the route skeleton: render as floating beziers and
    // keep their label visible (unless dimmed by a focus). Control edges keep their
    // label only when emphasized, to avoid clutter when a screen is expanded.
    const screenEdge = !isControlEdge
    const showLabel = (screenEdge && !dimmed) || emphasized ? edgeLabel(e) : undefined

    out.push({
      id: e.id,
      source: renderFrom,
      target: e.to,
      type: screenEdge ? 'floating' : 'smoothstep',
      data: screenEdge ? { label: showLabel } : undefined,
      label: screenEdge ? undefined : showLabel,
      labelShowBg: true,
      animated: onPath,
      selected,
      zIndex: emphasized ? 10 : 1,
      labelStyle: { fontSize: 11, fill: 'var(--text)', fontWeight: 500 },
      labelBgStyle: { fill: 'var(--label-bg)' },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      style: {
        stroke: color,
        strokeWidth: width,
        strokeOpacity: opacity,
        strokeDasharray: strokeDash(e.modality),
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    })
  }
  return out
}

/** A structural key over node ids, edge ids, and the expanded set: changes only on relayout-worthy edits. */
function structuralKey(graph: UiGraph, expanded: ReadonlySet<string>): string {
  const nodeIds = graph.nodes.map((n) => n.id).join(',')
  const edgeIds = graph.edges.map((e) => `${e.from}>${e.to}`).join(',')
  const exp = [...expanded].sort().join(',')
  return `${nodeIds}|${edgeIds}|${exp}`
}

/** Edge ids incident to a node id (from === id || to === id). */
function incidentEdges(graph: UiGraph, nodeId: string): Set<string> {
  const out = new Set<string>()
  for (const e of graph.edges) if (e.from === nodeId || e.to === nodeId) out.add(e.id)
  return out
}

/** Neighbour node ids directly connected to a node id (either edge direction). */
function neighborNodes(graph: UiGraph, nodeId: string): Set<string> {
  const out = new Set<string>()
  for (const e of graph.edges) {
    if (e.from === nodeId) out.add(e.to)
    if (e.to === nodeId) out.add(e.from)
  }
  return out
}

/** A single legend row: a short stroke swatch plus its meaning. */
function LegendRow(props: { swatch: CSSProperties; label: string }): JSX.Element {
  return (
    <div className="legend-row">
      <span className="legend-swatch" style={props.swatch} aria-hidden="true" />
      <span>{props.label}</span>
    </div>
  )
}

/** A stroke swatch style for the legend (a 2px line of the given colour and dash). */
function swatch(color: string, dash?: string): CSSProperties {
  return { borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}` }
}

/**
 * Render the interactive graph. Node positions are owned by ReactFlow so drags
 * persist; the dagre layout only re-seeds positions when the structural key (node
 * ids + edge ids + expanded set) changes. Edges are re-derived on selection / path
 * / hover so emphasis and dimming track the user's focus. A persistent legend
 * documents the modality (dash) and source (colour) encodings.
 */
export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const { graph: rawGraph, proposals, selection, pathEdgeIds, onSelect, onConnect } = props
  // Hide the synthetic `u_<screen>` dynamic-target sinks (kind 'unknown') + any edge
  // touching them from the canvas. View-only: they stay in the IR + coverage worklist.
  const graph = useMemo<UiGraph>(() => {
    const hidden = new Set(rawGraph.nodes.filter((n) => n.kind === 'unknown').map((n) => n.id))
    if (hidden.size === 0) return rawGraph
    return {
      ...rawGraph,
      nodes: rawGraph.nodes.filter((n) => !hidden.has(n.id)),
      edges: rawGraph.edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to)),
    }
  }, [rawGraph])
  const [expandAll, setExpandAll] = useState(false)
  const [highlightFlow, setHighlightFlow] = useState(true)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)

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

  const proposalCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of proposals.proposals) m.set(p.screen, (m.get(p.screen) ?? 0) + 1)
    return m
  }, [proposals])

  // Proposals are NOT drawn on the canvas (they are persisted as nodes/edges in the
  // database and read via the proposals panel); the graph shows only the proven IR.
  const layout = useMemo<GraphLayout>(() => layoutGraph(graph, expanded), [graph, expanded])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const rf = useReactFlow()

  // Selecting a screen that owns controls expands them; zoom to that screen + its
  // controls so they're actually readable (the per-screen alternative to the
  // unreadable "expand all"). Other selections don't yank the viewport.
  useEffect(() => {
    if (selection?.kind !== 'node') return
    const id = selection.node.id
    const childIds = graph.nodes.filter((n) => n.kind === 'control' && n.parent === id).map((n) => n.id)
    if (childIds.length === 0) return
    const focus = [id, ...childIds].map((nodeId) => ({ id: nodeId }))
    const t = setTimeout(() => {
      void rf.fitView({ nodes: focus, padding: 0.3, duration: 450, maxZoom: 1.4 })
    }, 80)
    return () => clearTimeout(t)
  }, [selection, graph, rf])

  // A node selection focuses on the selected node's flow; an edge selection focuses
  // on the selected edge's flow. Both are gated by the "highlight flow on select"
  // toggle and produce the same incident-edge / neighbour-node emphasis + dimming.
  const selectedNodeId = highlightFlow && selection?.kind === 'node' ? selection.node.id : null
  const selectedEdge = highlightFlow && selection?.kind === 'edge' ? selection.edge : null
  const incidentEdgeIds = useMemo(() => {
    if (selectedNodeId) return incidentEdges(graph, selectedNodeId)
    if (selectedEdge) return new Set<string>([selectedEdge.id])
    return new Set<string>()
  }, [graph, selectedNodeId, selectedEdge])
  const neighborIds = useMemo(() => {
    if (selectedNodeId) return neighborNodes(graph, selectedNodeId)
    if (selectedEdge) return new Set<string>([selectedEdge.from, selectedEdge.to])
    return new Set<string>()
  }, [graph, selectedNodeId, selectedEdge])

  // A planned path focuses the graph just like a selection: its edges + the nodes
  // they touch are highlighted and everything else is dimmed.
  const pathActive = pathEdgeIds.size > 0
  const pathNodeIds = useMemo(() => {
    const out = new Set<string>()
    for (const e of graph.edges) if (pathEdgeIds.has(e.id)) {
      out.add(e.from)
      out.add(e.to)
    }
    return out
  }, [graph, pathEdgeIds])

  // Re-seed node positions from the dagre layout only when structure/expansion changes,
  // so user drags survive selection, hover, and re-style passes.
  const key = useMemo(() => `${structuralKey(graph, expanded)}|p:${proposals.proposals.length}`, [graph, expanded, proposals])
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === key) return
    const firstLayout = lastKey.current === null
    lastKey.current = key
    const laid = toFlowNodes(graph, layout, expanded, proposalCount)
    // Keep the user's dragged positions ONLY when the node SET is unchanged (a pure
    // re-style). When nodes are added or removed (expand collapse), take a FULL fresh
    // layout so every node is placed by one consistent radial pass.
    setNodes((prev) => {
      if (firstLayout) return laid
      const prevIds = new Set(prev.map((n) => n.id))
      const sameSet = laid.length === prev.length && laid.every((n) => prevIds.has(n.id))
      if (!sameSet) return laid
      const prevPos = new Map(prev.map((n) => [n.id, n.position]))
      return laid.map((n) => {
        const kept = prevPos.get(n.id)
        return kept ? { ...n, position: kept } : n
      })
    })
  }, [key, graph, layout, expanded, proposalCount, setNodes])

  // Apply selection emphasis onto the live, user-positioned nodes without resetting
  // their positions. A node selection marks the node 'rf-selected' and its neighbours
  // 'rf-neighbor'; an edge selection marks BOTH endpoints 'rf-neighbor' (so the one
  // flow reads clearly). Whenever a flow is focused, every other node is dimmed.
  const selectedId = selection?.kind === 'node' ? selection.node.id : null
  const focusActive = selectedNodeId !== null || selectedEdge !== null || pathActive
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const isSelected = n.id === selectedId
        const highlighted = neighborIds.has(n.id) || pathNodeIds.has(n.id)
        const className = isSelected ? 'rf-selected' : highlighted ? 'rf-neighbor' : focusActive ? 'rf-dimmed' : ''
        if (n.selected === isSelected && n.className === (className || undefined)) return n
        return { ...n, selected: isSelected, className: className || undefined }
      }),
    )
  }, [selectedId, focusActive, neighborIds, pathNodeIds, setNodes])

  const edgeCtx = useMemo<EdgeContext>(
    () => ({ selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, focusEdgeActive: selectedEdge !== null || pathActive }),
    [selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, selectedEdge, pathActive],
  )
  useEffect(() => {
    setEdges(toFlowEdges(graph, edgeCtx))
  }, [graph, edgeCtx, setEdges])

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const found = graph.nodes.find((n) => n.id === node.id)
      if (found) onSelect({ kind: 'node', node: found })
    },
    [graph, onSelect],
  )
  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_evt, edge) => {
      const found = graph.edges.find((e) => e.id === edge.id)
      if (found) onSelect({ kind: 'edge', edge: found })
    },
    [graph, onSelect],
  )
  const handleConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) onConnect(conn.source, conn.target)
    },
    [onConnect],
  )
  const handleEdgeEnter: EdgeMouseHandler = useCallback((_evt, edge) => setHoveredEdgeId(edge.id), [])
  const handleEdgeLeave: EdgeMouseHandler = useCallback(() => setHoveredEdgeId(null), [])

  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onEdgeMouseEnter={handleEdgeEnter}
      onEdgeMouseLeave={handleEdgeLeave}
      onConnect={handleConnect}
      onPaneClick={() => onSelect(null)}
      colorMode="system"
      fitView
      minZoom={0.05}
      maxZoom={8}
    >
      <Background />
      <Controls />
      <Panel position="top-left">
        <div className="canvas-toggles">
          <label className="edge-toggle">
            <input type="checkbox" checked={expandAll} onChange={(e) => setExpandAll(e.target.checked)} />
            expand all controls
          </label>
          <label className="edge-toggle">
            <input type="checkbox" checked={highlightFlow} onChange={(e) => setHighlightFlow(e.target.checked)} />
            highlight flow on select
          </label>
        </div>
      </Panel>
      <Panel position="bottom-right">
        <div className="legend">
          <div className="legend-group">
            <div className="legend-title">modality</div>
            <LegendRow swatch={swatch('var(--edge)')} label="must (solid)" />
            <LegendRow swatch={swatch('var(--edge)', '6 4')} label="may (dashed)" />
            <LegendRow swatch={swatch('var(--edge)', '2 4')} label="unknown (dotted)" />
          </div>
          <div className="legend-group">
            <div className="legend-title">source</div>
            <LegendRow swatch={swatch('var(--edge)')} label="static" />
            <LegendRow swatch={swatch('var(--edge-manual)')} label="manual" />
            <LegendRow swatch={swatch('var(--edge-runtime)')} label="runtime (witnessed)" />
          </div>
        </div>
      </Panel>
    </ReactFlow>
  )
}
