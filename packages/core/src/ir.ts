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
 * How a control is located, in precedence order: a test id, an ARIA role +
 * accessible name, a label (id/name attribute), a structural tag:nth path, or
 * visible text. Stable across edits, and the basis for both the control's node id
 * and a real automation locator (Playwright getByTestId/getByRole/getByLabel…).
 */
export type SelectorStrategy = 'testid' | 'role-name' | 'label' | 'structural' | 'text'

/** A deterministic locator for a control. `nth` disambiguates identical selectors on one screen. */
export interface ControlSelector {
  strategy: SelectorStrategy
  value: string
  nth?: number
}

/** Input constraints on a field control (input/textarea/select), for codegen fill values + validation probes. */
export interface ControlInput {
  type?: string
  required?: boolean
  pattern?: string
}

/**
 * Metadata for a `control` node — an interactive element (button, input,
 * rich-text, form, select, link) extracted within a screen. `effects` lists the
 * non-navigational behaviors of the control as typed strings (e.g.
 * "api:POST /orders", "state:clearCart", "submit"); navigational behaviors are
 * edges to other nodes instead. `selector` is the stable locator the control's id
 * is derived from (so identity survives edits) and a real automation handle.
 */
export interface ControlMeta {
  element: string
  controlType: string
  name?: string
  events?: string[]
  effects?: string[]
  selector?: ControlSelector
  input?: ControlInput
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
  screenshot?: string
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
  editedNodes?: GraphNode[]
  removedRefs: string[]
}
