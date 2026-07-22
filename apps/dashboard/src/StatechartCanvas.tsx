// The UML statechart rendered in React Flow (the dashboard's own graph engine) so the
// state nodes are DRAGGABLE — mermaid could only draw a static SVG. One node per screen
// state; a modal is a CHILD node nested inside the screen that opens it (parentId +
// extent:'parent'), matching the locked design ruling. Transition edges are coloured PER
// EDGE by trust (witnessed green, proven darkgreen, proposed blue, asserted/unknown gray;
// refuted red+dashed, parked gray+dashed) — strictly better than mermaid, which could only
// tint whole states. A state's box tint follows the STRONGEST level among its incident
// transitions with refuted winning over verified, mirroring emitMermaid's classDef
// precedence. Initial positions come from a dagre DAG layout; React Flow owns them after
// (useNodesState) so drags persist. Zoom/pan + a Fit control are React Flow built-ins.

import { useEffect, useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  getBezierPath,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { transitionTrustLevel, TRUST_LEVEL_ORDER, TRUST_GLYPH, type StateModel, type StateModelState, type StateModelTransition, type TrustTier, type TrustLevel } from '@ui-graph/core'

const NODE_W = 210
const BASE_H = 54
const HEADER_H = 40
const MODAL_H = 34
const MODAL_GAP = 8
const INSET_X = 12
const PAD_BOTTOM = 12

/** Per-edge stroke colour by trust tier; refuted/parked overrides win before the tier switch. */
const TIER_COLOR: Record<TrustTier, string> = {
  witnessed: '#16a34a',
  proven: '#166534',
  proposed: '#2563eb',
  asserted: '#64748b',
  'llm-verified': '#64748b',
  unknown: '#64748b',
}
const REFUTED_COLOR = '#dc2626'
const PARKED_COLOR = '#64748b'

// trust-level classification (transitionTrustLevel), precedence (TRUST_LEVEL_ORDER),
// and glyphs (TRUST_GLYPH) are imported from core so the canvas never drifts from the
// mermaid/plantuml emitters.

/** The stroke colour for a transition: refuted red, parked gray, else the tier colour. */
function edgeColor(t: StateModelTransition): string {
  if (t.refuted) return REFUTED_COLOR
  if (t.parked) return PARKED_COLOR
  return TIER_COLOR[t.tier] ?? PARKED_COLOR
}

/** The box size a screen state needs: base, or a header + a stacked slot per nested modal. */
function stateSize(modalCount: number): { width: number; height: number } {
  if (modalCount === 0) return { width: NODE_W, height: BASE_H }
  return { width: NODE_W, height: HEADER_H + modalCount * (MODAL_H + MODAL_GAP) - MODAL_GAP + PAD_BOTTOM }
}

/** Fixed trust-tint palette (matches the legend swatches); 'open' falls back to the themed node vars. */
function tintFor(level: TrustLevel | undefined): { bg: string; border: string; color: string } {
  switch (level) {
    case 'refuted':
      return { bg: '#fde0e0', border: '#c62828', color: '#7f1d1d' }
    case 'verified':
      return { bg: '#d4f7d4', border: '#2e7d32', color: '#1b5e20' }
    case 'gated':
      return { bg: '#eceff1', border: '#78909c', color: '#37474f' }
    default:
      return { bg: 'var(--node-bg)', border: 'var(--node-border)', color: 'var(--text)' }
  }
}

/** Map every nested modal id to its owning screen state id, so a transition endpoint can be
 *  resolved to the top-level box it lives in (for dagre ranking). */
function modalParentMap(model: StateModel): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of model.states) for (const m of s.modals) out.set(m.id, s.id)
  return out
}

/** The strongest trust level incident to each state, used to tint its box (refuted > verified > gated > open). */
function strongestLevels(transitions: StateModelTransition[]): Map<string, TrustLevel> {
  const out = new Map<string, TrustLevel>()
  for (const t of transitions) {
    const lvl = transitionTrustLevel(t)
    for (const id of [t.fromId, t.toId]) {
      const cur = out.get(id)
      if (cur === undefined || TRUST_LEVEL_ORDER.indexOf(lvl) < TRUST_LEVEL_ORDER.indexOf(cur)) out.set(id, lvl)
    }
  }
  return out
}

/** Center positions (dagre) for the top-level states; modals are placed relative to their parent. */
function layoutStates(model: StateModel, visible: StateModelState[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  const visibleIds = new Set(visible.map((s) => s.id))
  const parentOf = modalParentMap(model)
  const topOf = (id: string): string => parentOf.get(id) ?? id
  for (const s of visible) {
    const size = stateSize(s.modals.length)
    g.setNode(s.id, { width: size.width, height: size.height })
  }
  for (const t of model.transitions) {
    const from = topOf(t.fromId)
    const to = topOf(t.toId)
    if (from === to || !visibleIds.has(from) || !visibleIds.has(to)) continue
    g.setEdge(from, to)
  }
  dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  for (const s of visible) {
    const n = g.node(s.id)
    if (n) out.set(s.id, { x: n.x, y: n.y })
  }
  return out
}

/** Build the React Flow nodes: a draggable box per screen state, its modals nested as children. */
function buildNodes(model: StateModel): Node[] {
  const visible = model.states.filter((s) => s.kind !== 'unknown')
  const pos = layoutStates(model, visible)
  const strongest = strongestLevels(model.transitions)
  const parents: Node[] = []
  const children: Node[] = []
  for (const s of visible) {
    const size = stateSize(s.modals.length)
    const c = pos.get(s.id) ?? { x: 0, y: 0 }
    const tint = tintFor(strongest.get(s.id))
    const hasModals = s.modals.length > 0
    parents.push({
      id: s.id,
      position: { x: c.x - size.width / 2, y: c.y - size.height / 2 },
      data: { label: s.label },
      style: {
        width: size.width,
        height: size.height,
        borderRadius: 'var(--radius, 8px)',
        border: `2px solid ${tint.border}`,
        background: tint.bg,
        color: tint.color,
        fontSize: 12,
        fontWeight: 600,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: hasModals ? 'flex-start' : 'center',
        padding: hasModals ? '6px 6px 0' : 6,
        textAlign: 'center',
      },
    })
    s.modals.forEach((m, i) => {
      children.push({
        id: m.id,
        parentId: s.id,
        extent: 'parent',
        draggable: false,
        selectable: false,
        position: { x: INSET_X, y: HEADER_H + i * (MODAL_H + MODAL_GAP) },
        data: { label: m.label },
        style: {
          width: NODE_W - INSET_X * 2,
          height: MODAL_H,
          borderRadius: 6,
          border: '1.5px dashed #78909c',
          background: 'var(--node-subtle-bg, rgba(120,144,156,0.12))',
          color: 'var(--text)',
          fontSize: 11,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      })
    })
  }
  // Parents MUST precede their children in the array for React Flow's nesting to attach.
  return [...parents, ...children]
}

/** Truncate a label to `max` chars with an ellipsis; the full text rides in the title tooltip. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** The full (untruncated) transition text for the hover tooltip, with a refuted/parked note. */
function fullLabel(t: StateModelTransition, glyph: string): string {
  let s = `${glyph} ${t.label}`.trim()
  if (t.refuted) s += '  (refuted)'
  else if (t.parked) s += `  (parked${t.parkReason ? `: ${t.parkReason}` : ''})`
  return s
}

/** Build the React Flow transition edges, coloured per-edge by trust with dashed refuted/parked. */
function buildEdges(model: StateModel): Edge[] {
  const unknownIds = new Set(model.states.filter((s) => s.kind === 'unknown').map((s) => s.id))
  const out: Edge[] = []
  model.transitions.forEach((t, i) => {
    if (unknownIds.has(t.fromId) || unknownIds.has(t.toId)) return
    const level = transitionTrustLevel(t)
    const color = edgeColor(t)
    const dashed = t.refuted || t.parked
    const glyph = TRUST_GLYPH[level]
    const short = truncate(`${glyph} ${t.label}`.trim(), 30)
    out.push({
      id: `sct_${i}_${t.fromId}_${t.toId}`,
      source: t.fromId,
      target: t.toId,
      type: 'transition',
      data: { label: short, full: fullLabel(t, glyph) },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      style: { stroke: color, strokeWidth: 1.8, strokeDasharray: dashed ? '6 4' : undefined },
    })
  })
  return out
}

/** The transition edge: a bezier between the boxes (a right-side loop for a self-transition),
 *  with a compact truncated label pill that carries the full text as a hover tooltip. */
function TransitionEdge(props: EdgeProps): JSX.Element {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props
  let path: string
  let labelX: number
  let labelY: number
  if (source === target) {
    path = `M ${sourceX},${sourceY} C ${sourceX + 90},${sourceY + 30} ${targetX + 90},${targetY - 30} ${targetX},${targetY}`
    labelX = Math.max(sourceX, targetX) + 72
    labelY = (sourceY + targetY) / 2
  } else {
    ;[path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  }
  const d = data as { label?: string; full?: string } | undefined
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {d?.label ? (
        <EdgeLabelRenderer>
          <div
            className="dagre-edge-label nodrag nopan"
            title={d.full}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

/**
 * Render a StateModel as a draggable React Flow statechart. Nodes are seeded from the dagre
 * layout into React-Flow-owned state so drags persist; edges are re-derived from the model.
 * Keyed by the caller on the drilled screen so a drill remounts and re-fits the viewport.
 */
export function StatechartCanvas(props: { model: StateModel; colorMode: 'light' | 'dark' }): JSX.Element {
  const { model, colorMode } = props
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const edges = useMemo(() => buildEdges(model), [model])
  const edgeTypes = useMemo(() => ({ transition: TransitionEdge }), [])

  // Seed nodes from the layout once the model arrives; React Flow owns positions after, so
  // drags survive re-render. `fitView` frames the freshly-seeded graph.
  useEffect(() => {
    setNodes(buildNodes(model))
  }, [model, setNodes])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
      colorMode={colorMode}
      fitView
      minZoom={0.1}
      maxZoom={4}
    >
      <Background />
      <Controls />
    </ReactFlow>
  )
}
