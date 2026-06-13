// Tier-2 grounding (dossier §5.1). A deterministic projection of the proven IR
// into a per-screen digest that grounds the LLM "critical-thinking" reviewer:
// for each screen it lists the controls that actually exist (their wired events
// and effects, from the adapter's call-graph analysis) and the transitions
// already witnessed. The reviewer uses this to (a) propose only the long tail
// NOT already covered, (b) cite real controls/effects so proposals are evidenced,
// and (c) prune hypotheses that reference a control or effect the screen lacks.
// It invents nothing — every field is read straight from the graph.

import type { UiGraph } from './ir'
import { hashValue } from './hash'

/** A control that exists on a screen, with the events/effects the adapter wired to it. */
export interface GroundedControl {
  id: string
  element: string
  controlType: string
  name?: string
  events: string[]
  effects: string[]
}

/** A transition already proven out of a screen (or one of its controls). */
export interface GroundedEdge {
  from: string
  to: string
  toLabel: string
  event: string
  effect: string | null
  modality: string
  guard: string | null
  source: string
  interprocedural?: boolean
}

/** The grounding digest for one screen: what exists and what is already known. */
export interface ScreenGrounding {
  screen: string
  label: string
  route: string | null
  controls: GroundedControl[]
  knownEdges: GroundedEdge[]
}

/** The full grounding artifact, bound to the base graph hash it was derived from. */
export interface Grounding {
  version: 0
  base: string
  screens: ScreenGrounding[]
}

/**
 * Build the grounding digest from a graph: group each non-control node's controls
 * and outgoing witnessed edges (an edge originating at the screen itself or at any
 * control nested under it). Pure and order-stable for a given graph.
 */
export function buildGrounding(graph: UiGraph): Grounding {
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const parentOf = new Map<string, string>()
  for (const n of graph.nodes) {
    if (n.kind === 'control' && n.parent !== undefined) parentOf.set(n.id, n.parent)
  }
  const screenOfOrigin = (from: string): string => parentOf.get(from) ?? from

  const screens = graph.nodes.filter((n) => n.kind !== 'control')
  const grounded: ScreenGrounding[] = screens.map((s) => {
    const controls: GroundedControl[] = graph.nodes
      .filter((n) => n.kind === 'control' && n.parent === s.id)
      .map((n) => ({
        id: n.id,
        element: n.control?.element ?? '',
        controlType: n.control?.controlType ?? '',
        ...(n.control?.name ? { name: n.control.name } : {}),
        events: n.control?.events ?? [],
        effects: n.control?.effects ?? [],
      }))

    const knownEdges: GroundedEdge[] = graph.edges
      .filter((e) => screenOfOrigin(e.from) === s.id)
      .map((e) => ({
        from: e.from,
        to: e.to,
        toLabel: labelOf.get(e.to) ?? e.to,
        event: e.event,
        effect: e.effect,
        modality: e.modality,
        guard: e.guard,
        source: e.source,
        ...(e.witness?.ruleId?.includes('interprocedural') ? { interprocedural: true } : {}),
      }))

    return { screen: s.id, label: s.label, route: s.route, controls, knownEdges }
  })

  return { version: 0, base: hashValue(graph), screens: grounded }
}
