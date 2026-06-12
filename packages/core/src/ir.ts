// The framework-agnostic Intermediate Representation: a guarded labeled
// transition system with modal must/may/unknown labels and per-element
// provenance. Defined in docs/30-ir-spec-v0.md. No framework knowledge lives
// here — adapters populate this shape; the core never branches on framework.

/**
 * Modal edge label (after Larsen–Thomsen modal transition systems).
 * `must` provably happens, `may` is guarded/conditional, `unknown` is an
 * over-approximated target whose modality could not be determined.
 */
export type Modality = 'must' | 'may' | 'unknown'

/**
 * Provenance of a node/edge, driving the golden invariant: `static` comes from a
 * deterministic adapter witness, `runtime` from a confirmed observation, and
 * `manual` from a human edit that lives ONLY in the overlay.
 */
export type Source = 'static' | 'manual' | 'runtime'

/** What a node represents in the app's state space. */
export type NodeKind = 'screen' | 'route' | 'modal' | 'unknown' | 'control'

/**
 * Metadata for a `control` node — an interactive element (button, input,
 * rich-text, form, select, link) extracted within a screen. `effects` lists the
 * non-navigational behaviors of the control as typed strings (e.g.
 * "api:POST /orders", "state:clearCart", "submit"); navigational behaviors are
 * edges to other nodes instead.
 */
export interface ControlMeta {
  element: string
  controlType: string
  name?: string
  effects?: string[]
}

/** A screen/state (or a nested control) in the app. `id` is stable and unique. */
export interface GraphNode {
  id: string
  route: string | null
  componentPath: string | null
  label: string
  kind: NodeKind
  parent?: string
  control?: ControlMeta
}

/** A deterministic proof that an edge exists (static source loc or runtime obs). */
export interface Witness {
  source: Source
  file?: string
  loc?: { line: number; col: number }
  ruleId?: string
  observationId?: string
}

/** A transition: (event, symbolic guard, effect) from one node to another. */
export interface GraphEdge {
  id: string
  from: string
  to: string
  event: string
  guard: string | null
  effect: string | null
  modality: Modality
  source: Source
  confidence: number
  witness?: Witness
}

/** Provenance metadata for a whole graph (content-addressing inputs). */
export interface UiGraphMeta {
  adapter: string
  adapterVersion: string
  rulesetVersion: string
  commit?: string
}

/** The complete UI transition graph for one app at one commit. */
export interface UiGraph {
  version: 0
  meta: UiGraphMeta
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/**
 * Manual human edits kept beside the base graph. Never mutates the base; the
 * displayed graph is `merge(base, overlay)`. Every element carries
 * `source: 'manual'`.
 */
export interface Overlay {
  version: 0
  base: string
  addedNodes: GraphNode[]
  addedEdges: GraphEdge[]
  editedEdges: GraphEdge[]
  removedRefs: string[]
}
