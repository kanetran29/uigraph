// The graph canvas: renders the merged UiGraph with @xyflow/react. UiGraph nodes
// become ReactFlow nodes laid out by BFS depth; edges become ReactFlow edges
// styled by modality (must=solid, may=dashed, unknown=dotted) and tinted when
// their source is manual. Selecting a node/edge drives the Inspector; connecting
// two nodes raises an "add edge" request the parent turns into an overlay edit.

import { useMemo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphEdge, GraphNode, Modality, UiGraph } from '@uigraph/core'
import { layoutByDepth } from './layout'

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

/** Dash pattern per modality: must is solid, may is dashed, unknown is dotted. */
function strokeDash(modality: Modality): string | undefined {
  if (modality === 'may') return '6 4'
  if (modality === 'unknown') return '2 4'
  return undefined
}

/** Edge stroke colour: manual edits are tinted violet, otherwise slate. */
function strokeColor(edge: GraphEdge, highlighted: boolean): string {
  if (highlighted) return '#16a34a'
  if (edge.source === 'manual') return '#7c3aed'
  return '#475569'
}

/** Compose an edge label from its event and, when present, its guard in brackets. */
function edgeLabel(edge: GraphEdge): string {
  return edge.guard ? `${edge.event} [${edge.guard}]` : edge.event
}

/** Map UiGraph nodes to positioned ReactFlow nodes, tinting manual-source nodes. */
function toFlowNodes(graph: UiGraph, selection: Selection): Node[] {
  const positions = layoutByDepth(graph)
  const selectedId = selection?.kind === 'node' ? selection.node.id : null
  return graph.nodes.map((n) => {
    const manual = n.id.startsWith('n_manual') || isManualNode(graph, n.id)
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    return {
      id: n.id,
      position: pos,
      data: { label: n.route ? `${n.label}\n${n.route}` : n.label },
      selected: n.id === selectedId,
      style: {
        whiteSpace: 'pre-line',
        borderRadius: 8,
        border: `2px solid ${manual ? '#7c3aed' : '#94a3b8'}`,
        background: manual ? '#f5f3ff' : '#ffffff',
        fontSize: 12,
        padding: 8,
        width: 170,
      },
    }
  })
}

/**
 * Whether a node id was contributed by the manual overlay. The merged graph keeps
 * the node's own fields but not its provenance, so we infer "manual" from any
 * manual edge touching it; this only tints, it is not authoritative.
 */
function isManualNode(graph: UiGraph, nodeId: string): boolean {
  return graph.edges.some((e) => e.source === 'manual' && (e.from === nodeId || e.to === nodeId))
}

/** Map UiGraph edges to ReactFlow edges, styled by modality, source, and highlight. */
function toFlowEdges(graph: UiGraph, selection: Selection, pathEdgeIds: Set<string>): Edge[] {
  const selectedId = selection?.kind === 'edge' ? selection.edge.id : null
  return graph.edges.map((e) => {
    const highlighted = pathEdgeIds.has(e.id)
    const color = strokeColor(e, highlighted)
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      label: edgeLabel(e),
      animated: highlighted,
      selected: e.id === selectedId,
      labelStyle: { fontSize: 11, fill: color },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      style: {
        stroke: color,
        strokeWidth: highlighted ? 3 : e.source === 'manual' ? 2 : 1.5,
        strokeDasharray: strokeDash(e.modality),
      },
    }
  })
}

/**
 * Render the interactive graph. Memoizes the node/edge mapping on the inputs so a
 * pan/zoom does not recompute the layout. Wraps ReactFlow with a Background grid
 * and Controls, and forwards selection and connect events to the parent.
 */
export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const { graph, selection, pathEdgeIds, onSelect, onConnect } = props

  const nodes = useMemo(() => toFlowNodes(graph, selection), [graph, selection])
  const edges = useMemo(() => toFlowEdges(graph, selection, pathEdgeIds), [graph, selection, pathEdgeIds])

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
    </ReactFlow>
  )
}
