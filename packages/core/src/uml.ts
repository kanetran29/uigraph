// State-machine export of a UiGraph, emitted in TWO formats from ONE mapping. Pure +
// browser-safe (string building only, no IO), mirroring codegen.ts's renderer style.
//
// buildStateModel decides the mapping ONCE (host resolution, trust tier, refuted/parked
// status, root, KPI, modal nesting); emitPlantuml (CLI export) and emitMermaid (the
// offline dashboard, which renders Mermaid client-side — PlantUML cannot render in-browser)
// are pure syntax/escaping over that shared model, so the mapping can never diverge.
//
// The design ruling (locked): screens are states; a modal is a NESTED composite
// state inside the screen that opens it (never a flat sibling); every control
// out-edge renders as a labeled transition on its parent screen (scope only
// selects WHICH screens are expanded, not whether controls collapse); every
// OTHER app-state dimension (auth/payment/data-load) stays
// a verbatim [guard]/effect on the transition — NEVER fabricated into an orthogonal
// region (drawing a state structure the graph never witnessed would violate the
// golden invariant). Trust status is a visual channel over projectTrustTier
// (never recomputed): in PlantUML an arrow colour + line style with refuted/parked
// overrides carrying an audit note; in Mermaid (no per-arrow colour) a state-level
// classDef colour PLUS a per-label trust glyph so per-edge trust stays legible.

import type { GraphEdge, GraphNode, UiGraph } from './ir'
import { projectTrustTier, type TrustTier } from './trust-tier'
import { buildCoverage, type ParkedEdge } from './coverage'

/** Scope of a rendered chart: the whole app (overview) or one screen drilled in detail. */
export type StateChartScope = 'overview' | 'screen'

/** Options for the state-chart renderers. `kpi` fills the legend line; when omitted it is derived from coverage. */
export interface StateChartOptions {
  scope?: StateChartScope
  screenId?: string
  parked?: ParkedEdge[]
  kpi?: { verifiedOfReached: number; reached: number }
}

/** A modal nested inside a screen state. */
export interface StateModelModal {
  id: string
  label: string
}

/** One diagram state: a screen (with any nested modals) or a referenced-but-not-primary stub endpoint. */
export interface StateModelState {
  id: string
  label: string
  kind: GraphNode['kind']
  modals: StateModelModal[]
}

/**
 * One transition, format-neutral. `label` is the composed `event ["control"] [guard] / effect`
 * (whitespace-collapsed, inner quotes neutralized); `tier` is the projected trust tier;
 * `refuted`/`parked` are the stronger overrides carrying an audit note.
 */
export interface StateModelTransition {
  fromId: string
  toId: string
  label: string
  tier: TrustTier
  refuted: boolean
  parked: boolean
  parkReason?: string
}

/**
 * The single source of truth both emitters consume. ALL mapping/trust logic (host
 * resolution, trust tier, refuted/parked status, root, KPI, modal nesting) is decided
 * here so PlantUML and Mermaid can never diverge on the mapping — they differ only in
 * syntax and escaping.
 */
export interface StateModel {
  states: StateModelState[]
  transitions: StateModelTransition[]
  rootId?: string
  kpi: { verifiedOfReached: number; reached: number }
  title: string
}

/** Flatten a label to one PlantUML-safe line: collapse newlines/runs of whitespace, neutralize double-quotes. */
function esc(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Flatten a label to one Mermaid-safe line: collapse whitespace, neutralize double-quotes,
 * strip the statement-separator `;`, brace hazards `{}` (would unbalance composite blocks),
 * and encode `< > &` as Mermaid entity codes so guards stay readable without rendering as HTML.
 * The `;` is stripped BEFORE entity codes are added (their own `;` must survive).
 */
function mermaidEsc(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/;/g, ',')
    .replace(/&/g, '#amp;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/"/g, "'")
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The transition label for an edge: `event ["control"] [guard] / effect`, each part
 * escaped. The control label (present only for a collapsed control edge) is quoted;
 * the guard is the verbatim app-state condition; the effect is dropped when it is the
 * redundant `navigate`/`contains` marker (the arrow itself already says "navigate").
 */
function transitionLabel(e: GraphEdge, controlLabel?: string): string {
  let s = esc(e.event)
  if (controlLabel !== undefined) s += ` "${esc(controlLabel)}"`
  if (e.guard !== null && e.guard.length > 0) s += ` [${esc(e.guard)}]`
  if (e.effect !== null && e.effect !== 'navigate' && e.effect !== 'contains') s += ` / ${esc(e.effect)}`
  return s
}

/**
 * The arrow style ([#colour] or [#colour,style]) for a trust tier — the PlantUML visual
 * channel. witnessed → green, proven → darkgreen, proposed → blue dotted; asserted /
 * llm-verified / unknown all read as "exists but unverified" → gray dashed. refuted
 * and parked are stronger overrides handled by the emitter.
 */
function arrowStyleForTier(tier: TrustTier): string {
  switch (tier) {
    case 'witnessed':
      return '[#green]'
    case 'proven':
      return '[#darkgreen]'
    case 'proposed':
      return '[#blue,dotted]'
    default:
      return '[#gray,dashed]'
  }
}

/** A valid, unique alias per node id (non-word chars → '_', leading digit prefixed, de-duplicated). */
function buildAliases(ids: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const taken = new Set<string>()
  for (const id of ids) {
    let base = id.replace(/[^A-Za-z0-9_]/g, '_')
    if (base.length === 0 || /^[0-9]/.test(base)) base = `s_${base}`
    let alias = base
    let i = 1
    while (taken.has(alias)) alias = `${base}_${i++}`
    taken.add(alias)
    map.set(id, alias)
  }
  return map
}

/**
 * The screen/modal state a node belongs to in the diagram: itself when it is a
 * screen/modal, else its parent walked up (a control collapses onto its host screen
 * or modal). An unresolvable node (unknown sink / orphan) renders as its own stub.
 */
function hostStateNode(n: GraphNode, byId: Map<string, GraphNode>): GraphNode {
  if (n.kind === 'screen' || n.kind === 'modal') return n
  if (n.parent !== undefined) {
    const p = byId.get(n.parent)
    if (p !== undefined) return hostStateNode(p, byId)
  }
  return n
}

/** The PlantUML stereotype for a state node by kind. */
function stereotypeFor(kind: GraphNode['kind']): string {
  if (kind === 'screen') return '<<screen>>'
  if (kind === 'modal') return '<<modal>>'
  if (kind === 'unknown') return '<<dynamic>>'
  return '<<state>>'
}

/**
 * The initial screen the `[*]` entry points at: the screen routed at '/', else a
 * screen with no incoming cross-screen transition, else the first screen.
 */
function pickRoot(screens: GraphNode[], targeted: Set<string>): GraphNode | undefined {
  return screens.find((s) => s.route === '/') ?? screens.find((s) => !targeted.has(s.id)) ?? screens[0]
}

/**
 * Build the intermediate state model from a UiGraph — the mapping both emitters share.
 *
 * overview: one screen state per screen with its modals nested, every other referenced
 * node a stub endpoint; `[*]` enters the root screen; each control out-edge and each
 * screen→screen nav edge becomes a transition (label = event + control + [guard] + / effect)
 * carrying its projected trust tier, plus refuted/parked overrides read from coverage.
 * screen (drill): only `opts.screenId` is a primary state (its modals nested); other screens
 * are omitted, though a screen it navigates TO still appears as a stub endpoint. Pure; no IO.
 * Reuses projectTrustTier + buildCoverage; recomputes nothing they already decide.
 */
export function buildStateModel(graph: UiGraph, opts: StateChartOptions = {}): StateModel {
  const scope = opts.scope ?? 'overview'
  const nodes = graph.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const cov = buildCoverage(graph, opts.parked ?? [])
  const parkedById = new Map(cov.parked.map((r) => [r.id, r]))
  const kpi = opts.kpi ?? { verifiedOfReached: cov.verifiedOfReached, reached: cov.reachedCount }

  const screens = nodes.filter((n) => n.kind === 'screen')
  const modalsOf = (screenId: string): GraphNode[] => nodes.filter((n) => n.kind === 'modal' && n.parent === screenId)

  let primaryScreens: GraphNode[]
  if (scope === 'screen') {
    if (opts.screenId === undefined) throw new Error('buildStateModel: scope "screen" requires opts.screenId')
    const focus = byId.get(opts.screenId)
    if (focus === undefined || focus.kind !== 'screen') throw new Error(`buildStateModel: no screen node ${opts.screenId}`)
    primaryScreens = [focus]
  } else {
    primaryScreens = screens
  }

  const ownedStateIds = new Set<string>()
  for (const s of primaryScreens) {
    ownedStateIds.add(s.id)
    for (const m of modalsOf(s.id)) ownedStateIds.add(m.id)
  }

  const transitions: StateModelTransition[] = []
  for (const e of graph.edges) {
    if (e.effect === 'contains') continue
    const fromNode = byId.get(e.from)
    const toNode = byId.get(e.to)
    if (fromNode === undefined || toNode === undefined) continue
    const src = hostStateNode(fromNode, byId)
    if (!ownedStateIds.has(src.id)) continue
    const tgt = hostStateNode(toNode, byId)
    const parked = parkedById.get(e.id)
    transitions.push({
      fromId: src.id,
      toId: tgt.id,
      label: transitionLabel(e, fromNode.kind === 'control' ? fromNode.label : undefined),
      tier: projectTrustTier(e),
      refuted: e.refuted === true,
      parked: e.refuted !== true && parked !== undefined,
      ...(parked !== undefined ? { parkReason: parked.reason ?? '' } : {}),
    })
  }

  const states: StateModelState[] = []
  const declared = new Set<string>()
  for (const s of primaryScreens) {
    const modals = modalsOf(s.id).map((m) => ({ id: m.id, label: m.label }))
    states.push({ id: s.id, label: s.label, kind: s.kind, modals })
    declared.add(s.id)
    for (const m of modals) declared.add(m.id)
  }
  for (const t of transitions) {
    for (const id of [t.fromId, t.toId]) {
      if (declared.has(id)) continue
      const n = byId.get(id)
      if (n === undefined) continue
      states.push({ id, label: n.label, kind: n.kind, modals: [] })
      declared.add(id)
    }
  }

  const targeted = new Set(transitions.filter((t) => t.fromId !== t.toId).map((t) => t.toId))
  const root = scope === 'screen' ? primaryScreens[0] : pickRoot(screens, targeted)
  const title = `UI State Machine — ${scope === 'screen' ? esc(primaryScreens[0]?.label ?? '') : 'overview'}`

  return { states, transitions, rootId: root?.id, kpi, title }
}

/**
 * Emit the state model as a PlantUML state machine (`@startuml`…`@enduml`). Byte-for-byte
 * the diagram the pre-refactor renderStateChart produced: screen states (modals nested),
 * per-transition trust colour, refuted red + note, parked gray + reason note, KPI legend.
 */
export function emitPlantuml(model: StateModel): string {
  const alias = buildAliases([...model.states.map((s) => s.id), ...model.states.flatMap((s) => s.modals.map((m) => m.id))])
  const aliasOf = (id: string): string => alias.get(id) ?? id.replace(/[^A-Za-z0-9_]/g, '_')

  const lines: string[] = ['@startuml', `title ${model.title}`, '']
  if (model.rootId !== undefined) lines.push(`[*] --> ${aliasOf(model.rootId)}`, '')

  for (const st of model.states) {
    const stereo = stereotypeFor(st.kind)
    if (st.modals.length === 0) {
      lines.push(`state "${esc(st.label)}" as ${aliasOf(st.id)} ${stereo}`)
    } else {
      lines.push(`state "${esc(st.label)}" as ${aliasOf(st.id)} ${stereo} {`)
      for (const m of st.modals) lines.push(`  state "${esc(m.label)}" as ${aliasOf(m.id)} <<modal>>`)
      lines.push('}')
    }
  }

  lines.push('')
  for (const t of model.transitions) {
    let style = arrowStyleForTier(t.tier)
    let note: string | undefined
    if (t.refuted) {
      style = '[#red,dashed]'
      note = 'REFUTED'
    } else if (t.parked) {
      style = '[#gray,dashed]'
      note = `PARKED: ${t.parkReason ?? ''}`
    }
    lines.push(`${aliasOf(t.fromId)} -${style}-> ${aliasOf(t.toId)}${t.label.length > 0 ? ` : ${t.label}` : ''}`)
    if (note !== undefined) lines.push('note on link', `  ${esc(note)}`, 'end note')
  }

  const pct = Math.round((model.kpi.verifiedOfReached ?? 0) * 100)
  lines.push(
    '',
    'legend right',
    '  <b>Trust channel</b> (arrow colour / line style)',
    '  <color:green>witnessed</color>   <color:darkgreen>proven</color>',
    '  <color:gray>asserted / unknown — dashed</color>   <color:blue>proposed — dotted</color>',
    '  <color:red>refuted — dashed + note</color>   <color:gray>parked — dashed + note</color>',
    `  verified/reached = ${pct}% (${model.kpi.reached} reached)`,
    'endlegend',
    '@enduml',
  )
  return lines.join('\n')
}

/** The four trust levels a state/transition reads at, strongest first. */
type TrustLevel = 'verified' | 'refuted' | 'gated' | 'open'

/** Trust precedence for a state's class from its incident transitions (index = strength, lower = stronger). REFUTED wins over verified: a disproven transition is an alarm that must never be masked by a sibling green edge. */
const LEVEL_ORDER: TrustLevel[] = ['refuted', 'verified', 'gated', 'open']

/** The Mermaid glyph prefixed to a transition label so per-edge trust stays legible when the arrow itself cannot be coloured. */
const LEVEL_GLYPH: Record<TrustLevel, string> = { verified: '✓', refuted: '✗', gated: '⋯', open: '?' }

/** The trust level of one transition: refuted/parked overrides win, else witnessed|proven read as verified, everything else open. */
function transitionLevel(t: StateModelTransition): TrustLevel {
  if (t.refuted) return 'refuted'
  if (t.parked) return 'gated'
  if (t.tier === 'witnessed' || t.tier === 'proven') return 'verified'
  return 'open'
}

/**
 * Emit the state model as a Mermaid `stateDiagram-v2` — the dashboard renders Mermaid
 * client-side offline (PlantUML cannot). Mermaid cannot colour individual arrows, so trust
 * becomes state-level colour via classDef (the strongest level among a state's incident
 * transitions, refuted > verified > gated > open) PLUS a per-label glyph so per-edge trust
 * survives. Modals nest as `state X { … }`. Transitions into dynamic `unknown` sinks are
 * dropped (clutter); their stub states are omitted too. Chars are Mermaid-escaped.
 */
export function emitMermaid(model: StateModel): string {
  const unknownIds = new Set(model.states.filter((s) => s.kind === 'unknown').map((s) => s.id))
  const visibleStates = model.states.filter((s) => !unknownIds.has(s.id))
  const transitions = model.transitions.filter((t) => !unknownIds.has(t.fromId) && !unknownIds.has(t.toId))

  const alias = buildAliases([...visibleStates.map((s) => s.id), ...visibleStates.flatMap((s) => s.modals.map((m) => m.id))])
  const aliasOf = (id: string): string => alias.get(id) ?? id.replace(/[^A-Za-z0-9_]/g, '_')

  const strongest = new Map<string, TrustLevel>()
  for (const t of transitions) {
    const lvl = transitionLevel(t)
    for (const id of [t.fromId, t.toId]) {
      const cur = strongest.get(id)
      if (cur === undefined || LEVEL_ORDER.indexOf(lvl) < LEVEL_ORDER.indexOf(cur)) strongest.set(id, lvl)
    }
  }

  const lines: string[] = ['stateDiagram-v2']
  if (model.rootId !== undefined && !unknownIds.has(model.rootId)) lines.push(`  [*] --> ${aliasOf(model.rootId)}`)

  for (const st of visibleStates) {
    if (st.modals.length === 0) {
      lines.push(`  state "${mermaidEsc(st.label)}" as ${aliasOf(st.id)}`)
    } else {
      lines.push(`  state "${mermaidEsc(st.label)}" as ${aliasOf(st.id)} {`)
      for (const m of st.modals) lines.push(`    state "${mermaidEsc(m.label)}" as ${aliasOf(m.id)}`)
      lines.push('  }')
    }
  }

  for (const t of transitions) {
    const label = mermaidEsc(t.label)
    const glyph = LEVEL_GLYPH[transitionLevel(t)]
    lines.push(`  ${aliasOf(t.fromId)} --> ${aliasOf(t.toId)} : ${glyph}${label.length > 0 ? ` ${label}` : ''}`)
  }

  lines.push(
    '  classDef verified fill:#d4f7d4,stroke:#2e7d32,color:#1b5e20',
    '  classDef refuted fill:#fde0e0,stroke:#c62828,color:#7f1d1d',
    '  classDef gated fill:#eceff1,stroke:#78909c,color:#37474f',
  )
  for (const st of visibleStates) {
    const lvl = strongest.get(st.id)
    if (lvl !== undefined && lvl !== 'open') lines.push(`  class ${aliasOf(st.id)} ${lvl}`)
  }

  return lines.join('\n')
}

/** Render a UiGraph as a PlantUML state machine (for CLI export). Shorthand for emitPlantuml(buildStateModel(...)). */
export function renderStateChart(graph: UiGraph, opts: StateChartOptions = {}): string {
  return emitPlantuml(buildStateModel(graph, opts))
}

/** Render a UiGraph as a Mermaid `stateDiagram-v2` (for the offline dashboard). Shorthand for emitMermaid(buildStateModel(...)). */
export function renderStateChartMermaid(graph: UiGraph, opts: StateChartOptions = {}): string {
  return emitMermaid(buildStateModel(graph, opts))
}
