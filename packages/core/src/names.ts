// Durable human names for controls the adapters could not name statically
// (a <Button variant> with its label in a prop, a clickable backdrop div, a
// bare <form>). Given by an agent/LLM/human, kept as a sidecar keyed by control
// id and applied by the fold. A name never touches the selector — the control's
// id is content-addressed off the selector — so naming never changes identity
// and a name survives every re-map that keeps the selector.

import type { GraphNode, UiGraph } from './ir'

/** Control node id → human name. */
export type ControlNames = Record<string, string>

/**
 * Return a copy of the graph where each control node whose id is in `names` gets
 * `label` and `control.name` set to that name. The selector (and so the id) is
 * untouched. Non-control nodes and unknown ids are ignored. Pure.
 */
export function applyControlNames(graph: UiGraph, names: ControlNames): UiGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const name = names[n.id]
      if (name === undefined || n.kind !== 'control' || n.control === undefined) return n
      return { ...n, label: name, control: { ...n.control, name } }
    }),
  }
}

/**
 * Control nodes with no `control.name`. Adapters fall back to the tag or
 * controlType for the label when no name was found, so the label alone is not a
 * name — only `control.name` counts.
 */
export function namelessControls(graph: UiGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.kind === 'control' && !n.control?.name)
}
