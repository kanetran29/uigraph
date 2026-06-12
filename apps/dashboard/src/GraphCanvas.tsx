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
  Controls,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ControlMeta, GraphEdge, GraphNode, Modality, Proposal, Proposals, Source, UiGraph } from '@uigraph/core'
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
function toFlowNodes(graph: UiGraph, expanded: ReadonlySet<string>, proposalCount: ReadonlyMap<string, number>): Node[] {
  const { positions, sizes } = layoutGraph(graph, expanded)

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
}

/**
 * Map UiGraph edges to ReactFlow edges. Behavior edges out of control nodes are
 * dense, so by default they are hidden — shown only when their control's parent
 * screen is expanded, when highlighted by a planned path, or when selected.
 * Screen→screen route edges always render. An edge label is shown ONLY when the
 * edge is emphasized (selected, on the planned path, incident to the selected node,
 * or hovered); non-emphasized edges are dimmed when a selection is active.
 */
function toFlowEdges(graph: UiGraph, ctx: EdgeContext): Edge[] {
  const { selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds } = ctx
  const selectedEdgeId = selection?.kind === 'edge' ? selection.edge.id : null
  const hasNodeSelection = selection?.kind === 'node'
  const controlParent = new Map<string, string | undefined>()
  for (const n of graph.nodes) if (n.kind === 'control') controlParent.set(n.id, n.parent)

  const out: Edge[] = []
  for (const e of graph.edges) {
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
    const dimmed = (hasNodeSelection && !incident) || (isControlEdge && !emphasized && !parentExpanded)
    const color = strokeColor(e, onPath || selected)
    const baseWidth = e.source === 'manual' ? 2 : 1.4
    const width = onPath ? 3 : emphasized ? 2.4 : baseWidth
    const opacity = dimmed ? 0.18 : emphasized ? 1 : 0.85

    out.push({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      label: emphasized ? edgeLabel(e) : undefined,
      labelShowBg: true,
      animated: onPath,
      selected,
      zIndex: emphasized ? 10 : 1,
      labelStyle: { fontSize: 11, fill: 'var(--text)', fontWeight: 500 },
      labelBgStyle: { fill: 'var(--label-bg)' },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
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
 * Map every quarantined proposal to a dashed ghost edge — a proposal IS a
 * hypothesized transition (event, guard, effect). Resolve its target node:
 * a real screen target -> that screen; a `<modal>` token -> the screen's modal
 * node when one exists; any other in-place token (`<self>`/`<state>`/`<dynamic>`)
 * -> a self-loop on the screen (the behavior changes a sub-state the graph does
 * not materialize as its own node). Proposals on a non-node owner (e.g. 'app')
 * are skipped. All ghost edges are non-selectable and read as "proposed".
 */
function toGhostEdges(graph: UiGraph, proposals: Proposal[]): Edge[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const screenIds = new Set<string>()
  for (const n of graph.nodes) if (n.kind !== 'control') screenIds.add(n.id)
  const modalFor = (screen: string): string | undefined =>
    graph.nodes.find((n) => n.kind === 'modal' && n.id.startsWith(`m_${screen}`))?.id

  const out: Edge[] = []
  for (const p of proposals) {
    if (!nodeIds.has(p.screen)) continue
    let target: string | undefined
    if (p.to !== undefined && screenIds.has(p.to)) target = p.to
    else if (p.to === '<modal>') target = modalFor(p.screen)
    // In-place proposals (<self>/<state>/<dynamic>) transition to a sub-state the
    // graph does not materialize as a node, so they are surfaced by the per-screen
    // badge + the panel, not as a degenerate self-loop edge.
    if (target === undefined || target === p.screen) continue
    out.push({
      id: `ghost_${p.id}`,
      source: p.screen,
      target,
      type: 'smoothstep',
      selectable: false,
      style: {
        stroke: GHOST_COLOR,
        strokeWidth: 1.4,
        strokeOpacity: 0.55,
        strokeDasharray: '2 4',
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const selectedNodeId = highlightFlow && selection?.kind === 'node' ? selection.node.id : null
  const incidentEdgeIds = useMemo(
    () => (selectedNodeId ? incidentEdges(graph, selectedNodeId) : new Set<string>()),
    [graph, selectedNodeId],
  )
  const neighborIds = useMemo(
    () => (selectedNodeId ? neighborNodes(graph, selectedNodeId) : new Set<string>()),
    [graph, selectedNodeId],
  )

  // Re-seed node positions from the dagre layout only when structure/expansion changes,
  // so user drags survive selection, hover, and re-style passes.
  const key = useMemo(() => `${structuralKey(graph, expanded)}|p:${proposals.proposals.length}`, [graph, expanded, proposals])
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === key) return
    const firstLayout = lastKey.current === null
    lastKey.current = key
    const laid = toFlowNodes(graph, expanded, proposalCount)
    // Preserve the live (possibly user-dragged) position of any node that already
    // exists; only newly-revealed nodes (e.g. controls on expand) take the fresh
    // dagre position. On the very first layout there is nothing to preserve.
    setNodes((prev) => {
      if (firstLayout) return laid
      const prevPos = new Map(prev.map((n) => [n.id, n.position]))
      return laid.map((n) => {
        const kept = prevPos.get(n.id)
        return kept ? { ...n, position: kept } : n
      })
    })
  }, [key, graph, expanded, proposalCount, setNodes])

  // Apply selection emphasis (selected node, neighbours) onto the live, user-positioned
  // nodes without resetting their positions.
  const selectedId = selection?.kind === 'node' ? selection.node.id : null
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const isSelected = n.id === selectedId
        const isNeighbor = neighborIds.has(n.id)
        const className = isSelected ? 'rf-selected' : isNeighbor ? 'rf-neighbor' : selectedNodeId ? 'rf-dimmed' : ''
        if (n.selected === isSelected && n.className === (className || undefined)) return n
        return { ...n, selected: isSelected, className: className || undefined }
      }),
    )
  }, [selectedId, selectedNodeId, neighborIds, setNodes])

  const edgeCtx = useMemo<EdgeContext>(
    () => ({ selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds }),
    [selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds],
  )
  useEffect(() => {
    const base = toFlowEdges(graph, edgeCtx)
    setEdges(showProposals ? [...base, ...toGhostEdges(graph, proposals.proposals)] : base)
  }, [graph, edgeCtx, showProposals, proposals, setEdges])

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
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
