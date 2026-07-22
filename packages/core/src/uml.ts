// UML State Machine (PlantUML statechart) export of a UiGraph. Pure + browser-safe
// (string building only, no IO), mirroring codegen.ts's renderer style.
//
// The design ruling (locked): screens are states; a modal is a NESTED composite
// state inside the screen that opens it (never a flat sibling); every control
// out-edge renders as a labeled transition on its parent screen (scope only
// selects WHICH screens are expanded, not whether controls collapse); every
// OTHER app-state dimension (auth/payment/data-load) stays
// a verbatim [guard]/effect on the transition — NEVER fabricated into an orthogonal
// region (drawing a state structure the graph never witnessed would violate the
// golden invariant). Trust status is a visual channel over projectTrustTier
// (never recomputed): arrow colour + line style, with refuted/parked overrides
// carrying an audit note on the link.

import type { GraphEdge, GraphNode, UiGraph } from './ir'
import { projectTrustTier, type TrustTier } from './trust-tier'
import { buildCoverage, type ParkedEdge } from './coverage'

/** Scope of a rendered chart: the whole app (overview) or one screen drilled in detail. */
export type StateChartScope = 'overview' | 'screen'

/** Options for {@link renderStateChart}. `kpi` fills the legend line; when omitted it is derived from coverage. */
export interface StateChartOptions {
  scope?: StateChartScope
  screenId?: string
  parked?: ParkedEdge[]
  kpi?: { verifiedOfReached: number; reached: number }
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
 * The arrow style ([#colour] or [#colour,style]) for a trust tier — the visual
 * channel. witnessed → green, proven → darkgreen, proposed → blue dotted; asserted /
 * llm-verified / unknown all read as "exists but unverified" → gray dashed. refuted
 * and parked are stronger overrides handled by the caller.
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

/** A valid, unique PlantUML alias per node id (non-word chars → '_', leading digit prefixed, de-duplicated). */
function buildAliases(nodes: GraphNode[]): Map<string, string> {
  const map = new Map<string, string>()
  const taken = new Set<string>()
  for (const n of nodes) {
    let base = n.id.replace(/[^A-Za-z0-9_]/g, '_')
    if (base.length === 0 || /^[0-9]/.test(base)) base = `s_${base}`
    let alias = base
    let i = 1
    while (taken.has(alias)) alias = `${base}_${i++}`
    taken.add(alias)
    map.set(n.id, alias)
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

/** The PlantUML stereotype for a stubbed (referenced-but-not-primary) endpoint node. */
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
 * Render a UiGraph as a PlantUML state machine diagram (`@startuml`…`@enduml`).
 *
 * overview: one `<<screen>>` state per screen with its modals nested as composite
 * `<<modal>>` states; `[*]` enters the root screen; each control out-edge and each
 * screen→screen nav edge is a transition (label = event + control name + [guard] +
 * / effect) coloured by its projected trust tier, a modal-inner control's close
 * edge exits the nested modal. screen (drill): only `opts.screenId` is expanded
 * (its transitions kept, its modals nested); every other screen is omitted, though
 * a screen it navigates TO appears as a label-only stub endpoint. Pure; no IO.
 */
export function renderStateChart(graph: UiGraph, opts: StateChartOptions = {}): string {
  const scope = opts.scope ?? 'overview'
  const nodes = graph.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const alias = buildAliases(nodes)
  const aliasOf = (id: string): string => alias.get(id) ?? id.replace(/[^A-Za-z0-9_]/g, '_')

  const cov = buildCoverage(graph, opts.parked ?? [])
  const parkedById = new Map(cov.parked.map((r) => [r.id, r]))
  const kpi = opts.kpi ?? { verifiedOfReached: cov.verifiedOfReached, reached: cov.reachedCount }

  const screens = nodes.filter((n) => n.kind === 'screen')
  const modalsOf = (screenId: string): GraphNode[] => nodes.filter((n) => n.kind === 'modal' && n.parent === screenId)

  let primaryScreens: GraphNode[]
  if (scope === 'screen') {
    if (opts.screenId === undefined) throw new Error('renderStateChart: scope "screen" requires opts.screenId')
    const focus = byId.get(opts.screenId)
    if (focus === undefined || focus.kind !== 'screen') throw new Error(`renderStateChart: no screen node ${opts.screenId}`)
    primaryScreens = [focus]
  } else {
    primaryScreens = screens
  }

  // A transition is kept only when its source is an owned state (a primary screen or one of its nested modals) — overview owns every screen, drill owns just the target.
  const ownedStateIds = new Set<string>()
  for (const s of primaryScreens) {
    ownedStateIds.add(s.id)
    for (const m of modalsOf(s.id)) ownedStateIds.add(m.id)
  }

  interface RenderedEdge {
    e: GraphEdge
    fromId: string
    toId: string
    controlLabel?: string
  }
  const rendered: RenderedEdge[] = []
  for (const e of graph.edges) {
    if (e.effect === 'contains') continue
    const fromNode = byId.get(e.from)
    const toNode = byId.get(e.to)
    if (fromNode === undefined || toNode === undefined) continue
    const src = hostStateNode(fromNode, byId)
    if (!ownedStateIds.has(src.id)) continue
    const tgt = hostStateNode(toNode, byId)
    rendered.push({ e, fromId: src.id, toId: tgt.id, ...(fromNode.kind === 'control' ? { controlLabel: fromNode.label } : {}) })
  }

  const lines: string[] = ['@startuml', `title UI State Machine — ${scope === 'screen' ? esc(primaryScreens[0]?.label ?? '') : 'overview'}`, '']

  const targeted = new Set(rendered.filter((r) => r.fromId !== r.toId).map((r) => r.toId))
  const root = scope === 'screen' ? primaryScreens[0] : pickRoot(screens, targeted)
  if (root !== undefined) lines.push(`[*] --> ${aliasOf(root.id)}`, '')

  const declared = new Set<string>()
  for (const s of primaryScreens) {
    const modals = modalsOf(s.id)
    if (modals.length === 0) {
      lines.push(`state "${esc(s.label)}" as ${aliasOf(s.id)} <<screen>>`)
    } else {
      lines.push(`state "${esc(s.label)}" as ${aliasOf(s.id)} <<screen>> {`)
      for (const m of modals) {
        lines.push(`  state "${esc(m.label)}" as ${aliasOf(m.id)} <<modal>>`)
        declared.add(m.id)
      }
      lines.push('}')
    }
    declared.add(s.id)
  }

  // A transition endpoint not declared above (a cross-screen target in drill scope, a dynamic sink) gets a label-only stub so the arrow lands on a readable state, not a raw id.
  for (const r of rendered) {
    for (const id of [r.fromId, r.toId]) {
      if (declared.has(id)) continue
      const n = byId.get(id)
      if (n === undefined) continue
      lines.push(`state "${esc(n.label)}" as ${aliasOf(id)} ${stereotypeFor(n.kind)}`)
      declared.add(id)
    }
  }

  lines.push('')
  for (const r of rendered) {
    let style = arrowStyleForTier(projectTrustTier(r.e))
    let note: string | undefined
    if (r.e.refuted === true) {
      style = '[#red,dashed]'
      note = 'REFUTED'
    } else {
      const parked = parkedById.get(r.e.id)
      if (parked !== undefined) {
        style = '[#gray,dashed]'
        note = `PARKED: ${parked.reason ?? ''}`
      }
    }
    const label = transitionLabel(r.e, r.controlLabel)
    lines.push(`${aliasOf(r.fromId)} -${style}-> ${aliasOf(r.toId)}${label.length > 0 ? ` : ${label}` : ''}`)
    if (note !== undefined) lines.push('note on link', `  ${esc(note)}`, 'end note')
  }

  const pct = Math.round((kpi.verifiedOfReached ?? 0) * 100)
  lines.push(
    '',
    'legend right',
    '  <b>Trust channel</b> (arrow colour / line style)',
    '  <color:green>witnessed</color>   <color:darkgreen>proven</color>',
    '  <color:gray>asserted / unknown — dashed</color>   <color:blue>proposed — dotted</color>',
    '  <color:red>refuted — dashed + note</color>   <color:gray>parked — dashed + note</color>',
    `  verified/reached = ${pct}% (${kpi.reached} reached)`,
    'endlegend',
    '@enduml',
  )
  return lines.join('\n')
}
