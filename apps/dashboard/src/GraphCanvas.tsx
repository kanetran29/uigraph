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
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ControlMeta, GraphEdge, GraphNode, Modality, Proposal, Proposals, Source, UiGraph } from '@uigraph/core'
import { layoutGraph, type GraphLayout, type NodePosition } from './layout'

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

/** The data a DagreEdge needs: the interior routed points and an optional label. */
interface DagreEdgeData extends Record<string, unknown> {
  points: NodePosition[]
  label?: string
}

/**
 * Build an SVG path through a polyline with lightly rounded corners. Each interior
 * vertex is replaced by a short quadratic arc whose radius is capped to a fraction
 * of the two adjacent segment lengths, so tight turns stay clean and never overshoot.
 */
function roundedPath(points: NodePosition[], radius = 12): string {
  const first = points[0]
  if (first === undefined) return ''
  let d = `M ${first.x},${first.y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    if (prev === undefined || curr === undefined) continue
    const next = points[i + 1]
    if (next === undefined) {
      d += ` L ${curr.x},${curr.y}`
      continue
    }
    const dIn = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const dOut = Math.hypot(next.x - curr.x, next.y - curr.y)
    const r = Math.min(radius, dIn / 2, dOut / 2)
    const t1 = dIn === 0 ? 0 : r / dIn
    const t2 = dOut === 0 ? 0 : r / dOut
    const ax = curr.x + (prev.x - curr.x) * t1
    const ay = curr.y + (prev.y - curr.y) * t1
    const bx = curr.x + (next.x - curr.x) * t2
    const by = curr.y + (next.y - curr.y) * t2
    d += ` L ${ax},${ay} Q ${curr.x},${curr.y} ${bx},${by}`
  }
  return d
}

/** The midpoint of a polyline, used to anchor the edge label pill. */
function polylineMidpoint(points: NodePosition[]): NodePosition {
  const mid = Math.floor(points.length / 2)
  const b = points[mid]
  if (b === undefined) return { x: 0, y: 0 }
  if (points.length % 2 === 1) return b
  const a = points[mid - 1]
  if (a === undefined) return b
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * A custom edge rendered ALONG dagre's de-crossed, edgesep-padded route. The path
 * starts at the live source handle, passes through the INTERIOR dagre points (the
 * first/last dagre points sit on the node borders, so skipping them keeps the edge
 * pinned to the handles and connected while a node is dragged), and ends at the live
 * target handle. The arrowhead (markerEnd) and the passed style are honoured; the
 * label, when present, is drawn as a pill at the route midpoint.
 */
function DagreEdge(props: EdgeProps<Edge<DagreEdgeData>>): JSX.Element {
  const { sourceX, sourceY, targetX, targetY, data, markerEnd, style } = props
  const interior = data?.points ?? []
  const through = interior.slice(1, -1)
  const points: NodePosition[] = [{ x: sourceX, y: sourceY }, ...through, { x: targetX, y: targetY }]
  const path = roundedPath(points)
  const label = data?.label
  const labelAt = label ? polylineMidpoint(points) : null
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && labelAt ? (
        <EdgeLabelRenderer>
          <div
            className="dagre-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
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

/** Box style for a screen node, tinted violet when manual. */
function screenStyle(manual: boolean, size: { width: number; height: number }): CSSProperties {
  return {
    whiteSpace: 'pre-line',
    borderRadius: 'var(--radius)',
    border: `2px solid ${manual ? 'var(--edge-manual)' : 'var(--node-border)'}`,
    background: manual ? 'var(--node-manual-bg)' : 'var(--node-bg)',
    color: 'var(--text)',
    fontSize: 12,
    padding: 8,
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
  layout: Pick<GraphLayout, 'positions' | 'sizes'>,
  expanded: ReadonlySet<string>,
  proposalCount: ReadonlyMap<string, number>,
): Node[] {
  const { positions, sizes } = layout

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
        style: screenStyle(manual, size),
      })
    }
  }

  return [...screens, ...controls]
}

/** The set of edge styling inputs that decide emphasis, dimming, and label visibility. */
interface EdgeContext {
  selection: Selection
  pathEdgeIds: Set<string>
  expanded: ReadonlySet<string>
  hoveredEdgeId: string | null
  incidentEdgeIds: Set<string>
  edgePoints: Map<string, NodePosition[]>
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
  const { selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, edgePoints, focusEdgeActive } = ctx
  const selectedEdgeId = selection?.kind === 'edge' ? selection.edge.id : null
  const hasNodeSelection = selection?.kind === 'node'
  const controlParent = new Map<string, string | undefined>()
  for (const n of graph.nodes) if (n.kind === 'control') controlParent.set(n.id, n.parent)

  // A runtime-confirmed edge supersedes its static/may twin between the same pair:
  // render only the witnessed (green) edge so the canvas is not doubled up.
  const runtimePairs = new Set<string>()
  for (const e of graph.edges) if (e.source === 'runtime') runtimePairs.add(`${e.from}->${e.to}`)

  const out: Edge[] = []
  for (const e of graph.edges) {
    if (e.source !== 'runtime' && runtimePairs.has(`${e.from}->${e.to}`)) continue
    const isControlEdge = controlParent.has(e.from) || controlParent.has(e.to)
    const onPath = pathEdgeIds.has(e.id)
    const selected = e.id === selectedEdgeId
    const incident = incidentEdgeIds.has(e.id)
    const hovered = e.id === hoveredEdgeId
    const parentExpanded =
      (controlParent.has(e.from) && expanded.has(controlParent.get(e.from) ?? '')) ||
      (controlParent.has(e.to) && expanded.has(controlParent.get(e.to) ?? ''))

    if (isControlEdge && !(onPath || selected || incident || parentExpanded)) continue

    const emphasized = onPath || selected || incident || hovered
    // Dim non-incident edges whenever a node OR an edge selection is focusing a flow.
    const dimmed = ((hasNodeSelection || focusEdgeActive) && !incident && !selected) || (isControlEdge && !emphasized && !parentExpanded)
    const color = strokeColor(e, onPath || selected)
    const baseWidth = e.source === 'manual' ? 2 : 1.4
    const width = onPath ? 3 : selected ? 2.8 : emphasized ? 2.4 : baseWidth
    const opacity = dimmed ? 0.18 : emphasized ? 1 : 0.85
    const points = edgePoints.get(`${e.from}->${e.to}`)
    const useDagre = !isControlEdge && points !== undefined && points.length >= 2
    const showLabel = emphasized ? edgeLabel(e) : undefined

    out.push({
      id: e.id,
      source: e.from,
      target: e.to,
      type: useDagre ? 'dagre' : 'smoothstep',
      data: useDagre ? { points, label: showLabel } : undefined,
      label: useDagre ? undefined : showLabel,
      labelShowBg: true,
      animated: onPath,
      selected,
      zIndex: emphasized ? 10 : 1,
      labelStyle: { fontSize: 11, fill: 'var(--text)', fontWeight: 500 },
      labelBgStyle: { fill: 'var(--label-bg)' },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: {
        stroke: color,
        strokeWidth: width,
        strokeOpacity: opacity,
        strokeDasharray: strokeDash(e.modality),
      },
    })
  }
  return out
}

/**
 * The sub-state a proposal transitions into, or null for a pure micro-interaction
 * (focus/debounce/highlight/keyboard-nav) that does not open a distinct UI surface.
 * Used to materialize ghost state nodes so a proposal can be drawn as a real edge.
 */
function proposalStateKind(p: Proposal): string | null {
  const hay = `${p.category} ${p.effect ?? ''} ${p.title} ${p.to ?? ''}`.toLowerCase()
  if (/modal|dialog|drawer|sheet/.test(hay)) return 'modal'
  if (/popover|dropdown|autocomplete|suggest|combobox|tooltip|context.?menu|\bmenu\b/.test(hay)) return 'popover'
  if (/error|fail|invalid|reject/.test(hay)) return 'error'
  if (/empty|no results|no matches/.test(hay)) return 'empty'
  if (/loading|spinner|skeleton|fetching/.test(hay)) return 'loading'
  if (/expand|collapse|accordion|read more|show more|see all|disclos/.test(hay)) return 'expanded'
  if (/toast|success|confirmation|\bsaved\b/.test(hay)) return 'toast'
  return null
}

/**
 * Materialize proposals as graph elements (only when proposals are shown). A
 * proposal IS a hypothesized transition, so it becomes a ghost edge to a target
 * node: a real screen target -> that screen; a `<modal>` -> the screen's modal
 * node; a state-changing proposal -> a deduped ghost STATE node (modal/popover/
 * error/empty/loading/expanded/toast) created here. Pure micro-interactions have
 * no distinct target state and stay on the per-screen badge + panel. Edges carry
 * an arrowhead and read as dashed/"proposed".
 */
function materializeProposals(graph: UiGraph, proposals: Proposal[]): { nodes: GraphNode[]; edges: Edge[] } {
  const realNodeIds = new Set(graph.nodes.map((n) => n.id))
  const realScreens = new Set<string>()
  for (const n of graph.nodes) if (n.kind !== 'control') realScreens.add(n.id)
  const modalFor = (screen: string): string | undefined =>
    graph.nodes.find((n) => n.kind === 'modal' && n.id.startsWith(`m_${screen}`))?.id

  const stateNodes = new Map<string, GraphNode>()
  const edges: Edge[] = []
  const seen = new Set<string>()
  const link = (from: string, to: string): void => {
    const pid = `${from}->${to}`
    if (seen.has(pid)) return
    seen.add(pid)
    edges.push({
      id: `ghost_${pid}`,
      source: from,
      target: to,
      type: 'smoothstep',
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: GHOST_COLOR, width: 14, height: 14 },
      style: { stroke: GHOST_COLOR, strokeWidth: 1.4, strokeOpacity: 0.6, strokeDasharray: '2 4' },
    })
  }

  for (const p of proposals) {
    if (!realNodeIds.has(p.screen)) continue
    if (p.to !== undefined && realScreens.has(p.to)) {
      link(p.screen, p.to)
      continue
    }
    if (p.to === '<modal>') {
      const m = modalFor(p.screen)
      if (m) {
        link(p.screen, m)
        continue
      }
    }
    const kind = proposalStateKind(p)
    if (kind === null) continue
    const id = `ps_${p.screen}__${kind}`
    if (!stateNodes.has(id)) {
      stateNodes.set(id, { id, route: null, componentPath: null, label: kind, kind: kind === 'modal' || kind === 'popover' ? 'modal' : 'unknown' })
    }
    link(p.screen, id)
  }
  return { nodes: [...stateNodes.values()], edges }
}

/** A layout-only placeholder edge (never served/styled), so dagre positions ghost state nodes near their screen. */
function layoutEdge(from: string, to: string): GraphEdge {
  return { id: `L_${from}_${to}`, from, to, event: '', guard: null, effect: null, modality: 'may', source: 'static', confidence: 0 }
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
  const { graph, proposals, selection, pathEdgeIds, onSelect, onConnect } = props
  const [expandAll, setExpandAll] = useState(false)
  const [highlightFlow, setHighlightFlow] = useState(true)
  const [showProposals, setShowProposals] = useState(false)
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

  // When proposals are shown, materialize ghost state nodes + ghost edges — but
  // SCOPED to the selected screen, so the canvas stays readable (one screen's
  // proposed sub-states at a time) instead of dumping all 117. With no screen
  // selected, proposals live on the per-screen badge + the panel.
  const ghost = useMemo<{ nodes: GraphNode[]; edges: Edge[] }>(() => {
    if (!showProposals || selection?.kind !== 'node') return { nodes: [], edges: [] }
    const screenId = selection.node.id
    const scoped = proposals.proposals.filter((p) => p.screen === screenId)
    return materializeProposals(graph, scoped)
  }, [graph, proposals, showProposals, selection])
  const layoutInput = useMemo<UiGraph>(
    () =>
      ghost.nodes.length === 0
        ? graph
        : { ...graph, nodes: [...graph.nodes, ...ghost.nodes], edges: [...graph.edges, ...ghost.edges.map((e) => layoutEdge(e.source!, e.target!))] },
    [graph, ghost],
  )

  // Compute the dagre layout ONCE per relayout-worthy change and share it: node
  // positions/sizes seed the flow nodes, and the routed edge polylines drive the
  // custom 'dagre' edges so arrows follow dagre's spaced, de-crossed routes.
  const layout = useMemo<GraphLayout>(() => layoutGraph(layoutInput, expanded), [layoutInput, expanded])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

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

  // Re-seed node positions from the dagre layout only when structure/expansion changes,
  // so user drags survive selection, hover, and re-style passes.
  const key = useMemo(() => `${structuralKey(layoutInput, expanded)}|p:${proposals.proposals.length}`, [layoutInput, expanded, proposals])
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === key) return
    const firstLayout = lastKey.current === null
    lastKey.current = key
    const laid = toFlowNodes(layoutInput, layout, expanded, proposalCount)
    // Keep the user's dragged positions ONLY when the node SET is unchanged (a pure
    // re-style). When nodes are added or removed (expand, proposals on/off), take a
    // FULL fresh dagre layout so every node is placed by one consistent pass — mixing
    // old screen positions with fresh ghost positions is what caused overlaps.
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
  }, [key, layoutInput, layout, expanded, proposalCount, setNodes])

  // Apply selection emphasis onto the live, user-positioned nodes without resetting
  // their positions. A node selection marks the node 'rf-selected' and its neighbours
  // 'rf-neighbor'; an edge selection marks BOTH endpoints 'rf-neighbor' (so the one
  // flow reads clearly). Whenever a flow is focused, every other node is dimmed.
  const selectedId = selection?.kind === 'node' ? selection.node.id : null
  const focusActive = selectedNodeId !== null || selectedEdge !== null
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const isSelected = n.id === selectedId
        const isNeighbor = neighborIds.has(n.id)
        const className = isSelected ? 'rf-selected' : isNeighbor ? 'rf-neighbor' : focusActive ? 'rf-dimmed' : ''
        if (n.selected === isSelected && n.className === (className || undefined)) return n
        return { ...n, selected: isSelected, className: className || undefined }
      }),
    )
  }, [selectedId, focusActive, neighborIds, setNodes])

  const edgeCtx = useMemo<EdgeContext>(
    () => ({ selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, edgePoints: layout.edgePoints, focusEdgeActive: selectedEdge !== null }),
    [selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, layout, selectedEdge],
  )
  useEffect(() => {
    const base = toFlowEdges(graph, edgeCtx)
    setEdges(showProposals ? [...base, ...ghost.edges] : base)
  }, [graph, edgeCtx, showProposals, ghost, setEdges])

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

  const edgeTypes = useMemo(() => ({ dagre: DagreEdge }), [])

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
          <label className="edge-toggle">
            <input type="checkbox" checked={showProposals} onChange={(e) => setShowProposals(e.target.checked)} />
            show proposals
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
