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
  getNodesBounds,
  getViewportForBounds,
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
import { toPng } from 'html-to-image'
import type { ControlMeta, GraphEdge, GraphNode, Modality, Proposals, Source, UiGraph } from '@uigraph/core'
import { layoutGraph, proposedScreenEdges, type GraphLayout, type ProposedEdge } from './layout'
import { pngFilename } from './exportPng'
import { applySaved, layoutStorageKey, parsePositions, serializePositions } from './layoutStore'
import { readStored, removeStored, writeStored } from './storage'

const IMAGE_W = 2048
const IMAGE_H = 1536

/** What the canvas reports as the current selection, or null when nothing is selected. */
export type Selection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null

/** The since-last-map delta for the canvas. Added/changed elements live in the current graph
 *  (highlighted in place); removed nodes/edges are gone from it, so they are re-injected as
 *  red ghosts placed beside a surviving neighbour. */
export interface DiffHighlight {
  addedNodeIds: Set<string>
  addedEdgeIds: Set<string>
  changedEdgeIds: Set<string>
  changedNodeIds: Set<string>
  renameById: Map<string, { before: string; after: string }>
  removedNodes: GraphNode[]
  removedEdges: GraphEdge[]
}

/** Props for the canvas: the graph to draw, the selection, the highlighted path, and callbacks. */
export interface GraphCanvasProps {
  graph: UiGraph
  proposals: Proposals
  selection: Selection
  pathEdgeIds: Set<string>
  onSelect: (selection: Selection) => void
  onConnect: (from: string, to: string) => void
  searchMatchIds?: Set<string>
  diffHighlight?: DiffHighlight | null
  colorMode?: 'light' | 'dark' | 'system'
}

/** Diff-highlight hues: added since the last map (green), changed (amber), removed (red ghost). */
const DIFF_ADDED_COLOR = '#16a34a'
const DIFF_CHANGED_COLOR = '#d97706'
const DIFF_REMOVED_COLOR = '#dc2626'

/** The ghost-edge hue: a distinct slate-violet, separate from the source palette. */
const GHOST_COLOR = '#a855f7'
/** Stable empty id set, so an absent searchMatchIds prop doesn't churn memo deps. */
const EMPTY_IDS: Set<string> = new Set()

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

/** Box style for a REMOVED node re-injected as a red dashed ghost (deleted since the last map). */
function removedGhostStyle(): CSSProperties {
  return {
    whiteSpace: 'pre-line',
    borderRadius: 'var(--radius-sm)',
    border: `1.5px dashed ${DIFF_REMOVED_COLOR}`,
    background: 'var(--surface)',
    color: DIFF_REMOVED_COLOR,
    fontSize: 11,
    textAlign: 'center',
    padding: '6px 10px',
    width: 168,
    opacity: 0.92,
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
  diffNames: ReadonlyMap<string, { before: string; after: string }>,
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
      // The lines beneath the name: route, a controls badge, a proposals badge — built as a
      // string suffix so a renamed screen can swap just its NAME for colored JSX while the box
      // size (and the layout) stays exactly the same whether the diff toggle is on or off.
      const routeLine = n.route ? `\n${n.route}` : ''
      const controlLine = count > 0 && !expanded.has(n.id) ? `\n▸ ${count} control${count > 1 ? 's' : ''}` : ''
      const pc = proposalCount.get(n.id) ?? 0
      const proposalLine = pc > 0 ? `\n◆ ${pc} proposal${pc > 1 ? 's' : ''}` : ''
      const suffix = `${routeLine}${controlLine}${proposalLine}`
      // A rename reads as a deletion of the old name + an addition of the new: old in red,
      // new in green (the same semantics as removed/added elsewhere).
      const rename = diffNames.get(n.id)
      const label = rename ? (
        <span>
          <span style={{ color: DIFF_REMOVED_COLOR, textDecoration: 'line-through' }}>{rename.before}</span>
          {' → '}
          <span style={{ color: DIFF_ADDED_COLOR }}>{rename.after}</span>
          {suffix}
        </span>
      ) : (
        `${n.label}${suffix}`
      )
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
  searchActive: boolean
  searchMatchIds: Set<string>
  diffActive: boolean
  addedEdgeIds: Set<string>
  changedEdgeIds: Set<string>
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
/**
 * Render the opt-in proposed (quarantined LLM) edges as dashed violet floating edges —
 * the same ghost tint as proposed state nodes — so a formerly-orphan modal/overlay shows
 * its proposed incoming connection without polluting the proven IR (default off).
 */
function toProposedFlowEdges(edges: readonly ProposedEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'floating',
    data: { label: e.count > 1 ? `proposed ×${e.count}` : 'proposed' },
    zIndex: 0,
    markerEnd: { type: MarkerType.ArrowClosed, color: GHOST_COLOR, width: 12, height: 12 },
    style: { stroke: GHOST_COLOR, strokeWidth: 1.6, strokeOpacity: 0.75, strokeDasharray: '2 5', strokeLinecap: 'round' },
  }))
}

function toFlowEdges(graph: UiGraph, ctx: EdgeContext): Edge[] {
  const { selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, focusEdgeActive, searchActive, searchMatchIds, diffActive, addedEdgeIds, changedEdgeIds } = ctx
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
    // When a search is active and nothing is selected, dim every edge that isn't between
    // two matches — the lowest-priority dim layer; any selection/path focus still wins.
    const searchDim = searchActive && !hasNodeSelection && !focusEdgeActive && !(searchMatchIds.has(e.from) && searchMatchIds.has(e.to))
    // Diff-highlight: when on (and no selection/path focus wins), an added edge is green and a
    // changed edge is amber at full strength; every other edge is dimmed so the delta pops.
    const diffAdded = diffActive && addedEdgeIds.has(e.id)
    const diffChanged = diffActive && changedEdgeIds.has(e.id)
    const diffLit = diffAdded || diffChanged
    const diffDim = diffActive && !emphasized && !diffLit
    const dimmed = ((hasNodeSelection || focusEdgeActive) && !incident && !selected && !onPath) || (isControlEdge && !emphasized && !parentExpanded) || searchDim || diffDim
    const color = diffLit && !emphasized ? (diffAdded ? DIFF_ADDED_COLOR : DIFF_CHANGED_COLOR) : strokeColor(e, onPath || selected)
    const baseWidth = e.source === 'manual' ? 2 : 1.4
    const width = onPath ? 3 : selected ? 2.8 : emphasized || (diffLit && !dimmed) ? 2.4 : baseWidth
    const opacity = dimmed ? 0.12 : emphasized || diffLit ? 1 : 0.85
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
  const { graph: rawGraph, proposals, selection, pathEdgeIds, onSelect, onConnect, searchMatchIds = EMPTY_IDS, diffHighlight = null, colorMode = 'system' } = props
  const searchActive = searchMatchIds.size > 0
  const diffCount = diffHighlight
    ? diffHighlight.addedNodeIds.size +
      diffHighlight.addedEdgeIds.size +
      diffHighlight.changedEdgeIds.size +
      diffHighlight.changedNodeIds.size +
      diffHighlight.removedNodes.length +
      diffHighlight.removedEdges.length
    : 0
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
  const [showProposed, setShowProposed] = useState(false)
  const [diffMode, setDiffMode] = useState(true)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  // Where the user has dragged a removed-node ghost (ghosts aren't in the node STATE, so we
  // remember their moved positions here; keyed by removed-node id).
  const [ghostPos, setGhostPos] = useState<Map<string, { x: number; y: number }>>(new Map())

  // Diff-highlight is live only when there is a delta AND the toggle is on. Added nodes (green
  // ring) plus the endpoints of added/changed edges stay lit; everything else dims so the
  // change pops. Removed elements are not on the current canvas — the Changes panel lists them.
  const diffActive = diffMode && diffCount > 0
  const diffRelevantNodeIds = useMemo(() => {
    const out = new Set<string>()
    if (!diffHighlight) return out
    for (const id of diffHighlight.addedNodeIds) out.add(id)
    for (const id of diffHighlight.changedNodeIds) out.add(id)
    for (const e of rawGraph.edges) {
      if (diffHighlight.addedEdgeIds.has(e.id) || diffHighlight.changedEdgeIds.has(e.id)) {
        out.add(e.from)
        out.add(e.to)
      }
    }
    return out
  }, [diffHighlight, rawGraph])
  // Renamed-screen labels (old → new), live only while the diff view is on.
  const diffNames = useMemo<ReadonlyMap<string, { before: string; after: string }>>(
    () => (diffActive && diffHighlight ? diffHighlight.renameById : new Map<string, { before: string; after: string }>()),
    [diffActive, diffHighlight],
  )

  // Quarantined proposal edges to a real on-canvas target (the formerly-orphan
  // modals/overlays) — overlaid only when the user opts in.
  const proposedEdges = useMemo(() => proposedScreenEdges(graph, proposals.proposals), [graph, proposals])

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
  const [exportError, setExportError] = useState<string | null>(null)
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
  const key = useMemo(
    () => `${structuralKey(graph, expanded)}|p:${proposals.proposals.length}|d:${diffActive ? 1 : 0}|${[...diffNames.keys()].sort().join(',')}`,
    [graph, expanded, proposals, diffActive, diffNames],
  )
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === key) return
    const firstLayout = lastKey.current === null
    lastKey.current = key
    const laid = toFlowNodes(graph, layout, expanded, proposalCount, diffNames)
    // Keep the user's dragged positions ONLY when the node SET is unchanged (a pure
    // re-style). When nodes are added or removed (expand collapse), take a FULL fresh
    // layout so every node is placed by one consistent radial pass.
    setNodes((prev) => {
      // First mount: overlay any saved layout for THIS graph (stale/absent save = no-op).
      if (firstLayout) return applySaved(laid, parsePositions(readStored(layoutStorageKey(graph))))
      const prevIds = new Set(prev.map((n) => n.id))
      const sameSet = laid.length === prev.length && laid.every((n) => prevIds.has(n.id))
      if (!sameSet) return laid
      const prevPos = new Map(prev.map((n) => [n.id, n.position]))
      return laid.map((n) => {
        const kept = prevPos.get(n.id)
        return kept ? { ...n, position: kept } : n
      })
    })
  }, [key, graph, layout, expanded, proposalCount, diffNames, setNodes])

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
        // Search dims non-matches ONLY when no flow is focused — selection/path always win.
        const searchDim = searchActive && !focusActive && !searchMatchIds.has(n.id)
        // Diff (when no selection/path focus wins): added node → green ring, renamed/changed
        // node → amber ring; an unchanged node outside the delta → dimmed; an endpoint of a
        // changed/added edge stays normal.
        const isAdded = diffActive && !focusActive && (diffHighlight?.addedNodeIds.has(n.id) ?? false)
        // A renamed screen shows its old→new colored label (no extra ring); only a non-rename
        // change (route/kind) gets the amber "changed" ring.
        const isRenamed = diffHighlight?.renameById.has(n.id) ?? false
        const isChanged = diffActive && !focusActive && !isRenamed && (diffHighlight?.changedNodeIds.has(n.id) ?? false)
        const diffDim = diffActive && !focusActive && !diffRelevantNodeIds.has(n.id)
        const className = isSelected
          ? 'rf-selected'
          : highlighted
            ? 'rf-neighbor'
            : focusActive
              ? 'rf-dimmed'
              : isAdded
                ? 'rf-added'
                : isChanged
                  ? 'rf-changed'
                  : diffDim
                    ? 'rf-dimmed'
                    : searchDim
                      ? 'rf-dimmed'
                      : ''
        if (n.selected === isSelected && n.className === (className || undefined)) return n
        return { ...n, selected: isSelected, className: className || undefined }
      }),
    )
  }, [selectedId, focusActive, neighborIds, pathNodeIds, setNodes, searchActive, searchMatchIds, diffActive, diffHighlight, diffRelevantNodeIds])

  const edgeCtx = useMemo<EdgeContext>(
    () => ({
      selection,
      pathEdgeIds,
      expanded,
      hoveredEdgeId,
      incidentEdgeIds,
      focusEdgeActive: selectedEdge !== null || pathActive,
      searchActive,
      searchMatchIds,
      diffActive,
      addedEdgeIds: diffHighlight?.addedEdgeIds ?? EMPTY_IDS,
      changedEdgeIds: diffHighlight?.changedEdgeIds ?? EMPTY_IDS,
    }),
    [selection, pathEdgeIds, expanded, hoveredEdgeId, incidentEdgeIds, selectedEdge, pathActive, searchActive, searchMatchIds, diffActive, diffHighlight],
  )
  useEffect(() => {
    const base = toFlowEdges(graph, edgeCtx)
    setEdges(showProposed ? [...base, ...toProposedFlowEdges(proposedEdges)] : base)
  }, [graph, edgeCtx, setEdges, showProposed, proposedEdges])

  // Removed nodes/edges are gone from the laid-out graph, so when the diff view is on we
  // re-inject them as red dashed ghosts: each removed node sits beside a surviving neighbour
  // (a fallback column on the left when its whole neighbourhood was deleted), and each removed
  // edge whose endpoints both resolve (survivor or ghost) draws between them. Display-only —
  // the ghosts are never in the node/edge STATE, so drags/edits ignore them.
  const ghosts = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!diffActive || !diffHighlight || (diffHighlight.removedNodes.length === 0 && diffHighlight.removedEdges.length === 0)) {
      return { nodes: [], edges: [] }
    }
    const pos = new Map<string, { x: number; y: number }>()
    for (const n of nodes) if (n.parentId === undefined) pos.set(n.id, n.position)
    const placed = new Map<string, { x: number; y: number }>()
    const anchorCount = new Map<string, number>()
    const xs = [...pos.values()].map((p) => p.x)
    const minX = xs.length > 0 ? Math.min(...xs) : 0
    let fallbackI = 0
    const ghostNodes: Node[] = []
    for (const rn of diffHighlight.removedNodes) {
      let anchor: { x: number; y: number } | undefined
      for (const re of diffHighlight.removedEdges) {
        const other = re.from === rn.id ? re.to : re.to === rn.id ? re.from : undefined
        if (other !== undefined && pos.has(other)) {
          anchor = pos.get(other)
          break
        }
      }
      let p: { x: number; y: number }
      if (anchor) {
        const k = `${anchor.x},${anchor.y}`
        const i = anchorCount.get(k) ?? 0
        anchorCount.set(k, i + 1)
        p = { x: anchor.x + 300, y: anchor.y + i * 90 }
      } else {
        p = { x: minX - 360, y: fallbackI++ * 90 }
      }
      // A user-dragged position wins, so a moved ghost stays where it was put (it is read-only
      // otherwise: draggable, but NOT selectable/connectable, so it can't be edited or deleted).
      const finalPos = ghostPos.get(rn.id) ?? p
      placed.set(rn.id, finalPos)
      ghostNodes.push({
        id: rn.id,
        position: finalPos,
        selectable: false,
        draggable: true,
        connectable: false,
        deletable: false,
        zIndex: 0,
        data: { label: rn.route ? `${rn.label}\n${rn.route}` : rn.label },
        style: removedGhostStyle(),
      })
    }
    const resolvable = (id: string): boolean => pos.has(id) || placed.has(id)
    const ghostEdges: Edge[] = []
    for (const re of diffHighlight.removedEdges) {
      if (!resolvable(re.from) || !resolvable(re.to)) continue
      ghostEdges.push({
        id: `ghost_${re.id}`,
        source: re.from,
        target: re.to,
        type: 'floating',
        zIndex: 5,
        markerEnd: { type: MarkerType.ArrowClosed, color: DIFF_REMOVED_COLOR, width: 26, height: 26 },
        style: { stroke: DIFF_REMOVED_COLOR, strokeWidth: 2.6, strokeOpacity: 0.95, strokeDasharray: '7 4', strokeLinecap: 'round' },
      })
    }
    return { nodes: ghostNodes, edges: ghostEdges }
  }, [diffActive, diffHighlight, nodes, ghostPos])

  const rfNodes = useMemo(() => (ghosts.nodes.length > 0 ? [...nodes, ...ghosts.nodes] : nodes), [nodes, ghosts])
  const rfEdges = useMemo(() => (ghosts.edges.length > 0 ? [...edges, ...ghosts.edges] : edges), [edges, ghosts])

  // Capture drags of a removed-node ghost into ghostPos (the ghost isn't in the node state, so
  // useNodesState ignores its changes); everything else flows to the real node state as usual.
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (diffHighlight && diffHighlight.removedNodes.length > 0) {
        const ghostIds = new Set(diffHighlight.removedNodes.map((n) => n.id))
        for (const c of changes) {
          if (c.type === 'position' && c.position && ghostIds.has(c.id)) {
            const { id, position } = c
            setGhostPos((prev) => new Map(prev).set(id, position))
          }
        }
      }
      onNodesChange(changes)
    },
    [onNodesChange, diffHighlight],
  )

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

  // Export the FULL graph (not just the viewport) as a PNG: fit every node's bounds into a
  // fixed image, snapshot the viewport clone with html-to-image, and download. The clone is
  // transformed (not the live canvas, so it never jumps); chrome (controls/panels/minimap/
  // dotted bg) is filtered out and a solid themed --bg replaces transparency. No web fonts
  // are loaded (system stacks only), so no font embedding is needed.
  const handleExportPng = useCallback(async () => {
    setExportError(null)
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (viewport === null || nodes.length === 0) return
    const bounds = getNodesBounds(nodes)
    const { x, y, zoom } = getViewportForBounds(bounds, IMAGE_W, IMAGE_H, 0.2, 2, 0.1)
    const flow = document.querySelector('.react-flow')
    const bg = (flow ? getComputedStyle(flow).getPropertyValue('--bg').trim() : '') || '#ffffff'
    try {
      const dataUrl = await toPng(viewport, {
        backgroundColor: bg,
        width: IMAGE_W,
        height: IMAGE_H,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        cacheBust: true,
        style: { width: `${IMAGE_W}px`, height: `${IMAGE_H}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
        filter: (el) => {
          const cl = (el as HTMLElement).classList
          return !cl || !(cl.contains('react-flow__controls') || cl.contains('react-flow__minimap') || cl.contains('react-flow__panel') || cl.contains('react-flow__attribution') || cl.contains('react-flow__background'))
        },
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = pngFilename(rawGraph)
      a.click()
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'PNG export failed')
    }
  }, [nodes, rawGraph])

  // Persist the user's dragged TOP-LEVEL node positions for this graph; controls/bands are
  // parent-relative and excluded. Restored on next mount via the seeding effect above.
  const handleSaveLayout = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) if (n.parentId === undefined) positions[n.id] = { x: n.position.x, y: n.position.y }
    writeStored(layoutStorageKey(graph), serializePositions(positions))
  }, [nodes, graph])

  // Drop the saved layout + re-seed a fresh dagre layout, then fit it into view.
  const handleResetLayout = useCallback(() => {
    removeStored(layoutStorageKey(graph))
    setNodes(toFlowNodes(graph, layout, expanded, proposalCount, diffNames))
    void rf.fitView({ padding: 0.2, duration: 450 })
  }, [graph, layout, expanded, proposalCount, diffNames, setNodes, rf])

  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), [])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onEdgeMouseEnter={handleEdgeEnter}
      onEdgeMouseLeave={handleEdgeLeave}
      onConnect={handleConnect}
      onPaneClick={() => onSelect(null)}
      colorMode={colorMode}
      fitView
      minZoom={0.05}
      maxZoom={8}
    >
      <Background />
      <Controls />
      <Panel position="top-right">
        <div className="canvas-export">
          <button
            type="button"
            className="download-btn nodrag nopan"
            aria-label="Export the full graph as a PNG image"
            disabled={nodes.length === 0}
            onClick={() => void handleExportPng()}
          >
            Export PNG ↓
          </button>
          {exportError ? (
            <span className="error" role="alert">
              {exportError}
            </span>
          ) : null}
        </div>
      </Panel>
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
            <input type="checkbox" checked={showProposed} onChange={(e) => setShowProposed(e.target.checked)} />
            show proposed (LLM){proposedEdges.length > 0 ? ` · ${proposedEdges.length}` : ''}
          </label>
          {diffCount > 0 ? (
            <label className="edge-toggle">
              <input type="checkbox" checked={diffMode} onChange={(e) => setDiffMode(e.target.checked)} />
              highlight changes · {diffCount}
            </label>
          ) : null}
          <div className="layout-actions">
            <button type="button" className="layout-btn nodrag nopan" onClick={handleSaveLayout} aria-label="Save the current node layout">
              Save layout
            </button>
            <button type="button" className="layout-btn nodrag nopan" onClick={handleResetLayout} aria-label="Reset the node layout to the automatic layout">
              Reset
            </button>
          </div>
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
            {showProposed ? <LegendRow swatch={swatch(GHOST_COLOR, '2 5')} label="proposed (LLM)" /> : null}
          </div>
          {diffActive ? (
            <div className="legend-group">
              <div className="legend-title">since last map</div>
              <LegendRow swatch={swatch(DIFF_ADDED_COLOR)} label="added" />
              <LegendRow swatch={swatch(DIFF_CHANGED_COLOR)} label="changed" />
              <LegendRow swatch={swatch(DIFF_REMOVED_COLOR, '5 4')} label="removed" />
            </div>
          ) : null}
        </div>
      </Panel>
    </ReactFlow>
  )
}
