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
export type NodeKind = 'screen' | 'route' | 'modal' | 'unknown' | 'control' | 'scope'

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
  /**
   * An identity basis to content-address the control's id on INSTEAD of `value`,
   * when `value` is not itself stable — e.g. an i18n-resolved accessible name/text,
   * which can shift on a translation-copy-only edit that never touches the
   * component. Absent whenever `value` is already stable on its own (testid,
   * a literal attribute/label, structural tag, on-page DOM text). `value` still
   * carries the real runtime automation string; `idKey` is used ONLY for hashing.
   */
  idKey?: string
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
  loc?: { line: number; col: number }
  nameInferred?: boolean
}

/**
 * A screen/state (or a nested control) in the app. `id` is stable and unique.
 * `screenshot` is a workspace-relative path (e.g. 'shots/n_root.jpg') to a
 * picture captured while the browser was PROVABLY on this node's screen; it is
 * attached by the fold (screens.ts), never stored in the base graph.
 */
export interface GraphNode {
  id: string
  route: string | null
  componentPath: string | null
  label: string
  kind: NodeKind
  parent?: string
  control?: ControlMeta
  screenshot?: string
  /**
   * For kind 'scope': the screens an anchored edge fires from. 'top' means every
   * screen in the graph; 'subtree' means `root` and its descendants, listed in
   * `members` so a consumer need not recompute the route tree.
   */
  scope?: { kind: 'top' | 'subtree'; root?: string; members?: string[] }
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

/**
 * A transition: (event, symbolic guard, effect) from one node to another.
 * `irreversible` is an OPTIONAL gate hint: when true, the edge performs a
 * destructive/non-undoable effect (delete, pay, submit-order, logout, reset) so
 * an agent can require confirmation before traversing it. It is additive and
 * defaults `undefined`; callers that want a value can derive one from the effect
 * string via `classifyEffectRisk` in risk.ts. `witnessStale` (set by the
 * observation fold) means the runtime witness was recorded against a different
 * base graph — the code changed since verification, so the edge needs
 * re-confirmation and must not be trusted at the witnessed tier. `refuted`
 * (also set by the fold, on `may` edges only) means the hypothesis was
 * DISPROVEN at runtime — repeatedly refuted on the current base and never once
 * confirmed; the edge is kept (the hypothesis and its history stay auditable)
 * but coverage accounts it as a delivered verdict and the worklist skips it.
 */
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
  /**
   * Further constructs that produce this same edge (same endpoints, event and guard).
   * One edge can be fired from several places in the source — five links to `/` in one
   * header — and change-impact analysis needs every one of them, not just the first.
   */
  mergedWitnesses?: Witness[]
  irreversible?: boolean
  witnessStale?: boolean
  refuted?: true
}

/**
 * Split a `GraphEdge.effect` string into its constituent effect tokens. Most edges
 * carry a single effect (e.g. 'navigate'); an effect self-loop edge
 * (adapter-react/extract.ts's `rr.effect-self-loop`) joins several api:/state:/
 * error: kinds onto ONE edge with ', ' (edges key on (from,to,event,guard), not
 * effect, so one edge per kind would collide on the same tuple and silently drop
 * all but the first). This is the single place that undoes that join, so every
 * consumer (codegen's request assertions, openapi's effect collection) sees clean
 * per-kind tokens instead of parsing the raw joined string itself.
 */
export function effectTokens(effect: string | null): string[] {
  return effect ? effect.split(', ') : []
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
