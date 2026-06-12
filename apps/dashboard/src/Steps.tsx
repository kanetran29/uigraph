// The steps panel: pick a from-node and a to-node among NAVIGABLE targets
// (screen / route / modal — never control leaves), run the core planPath over the
// loaded graph (browser-safe — imported from @uigraph/core, never @uigraph/core/node),
// and list the ordered legs. The default `to` is the farthest screen actually
// reachable from `from`, so the panel opens on a real, non-empty route. Reporting
// the path's edge ids upward lets the canvas highlight the route.

import { useEffect, useMemo, useState } from 'react'
import { planPath, reachableFrom, type PlanStep } from '@uigraph/core'
import type { GraphNode, UiGraph } from '@uigraph/core'

/** Props for the steps panel: the graph to plan over and a path-change reporter. */
export interface StepsProps {
  graph: UiGraph
  onPathChange: (edgeIds: string[]) => void
}

/** Node kinds a user can navigate TO; control leaves are excluded (nothing routes to them). */
const NAVIGABLE_KINDS = new Set<GraphNode['kind']>(['screen', 'route', 'modal'])

/** Whether a node is a navigable target (a real screen/route/modal, not a control leaf). */
function isNavigable(node: GraphNode): boolean {
  return NAVIGABLE_KINDS.has(node.kind)
}

/** The list of navigable target nodes, in graph order. */
function navigableNodes(graph: UiGraph): GraphNode[] {
  return graph.nodes.filter(isNavigable)
}

/**
 * Pick a sensible default target reachable from `from`: the farthest reachable
 * navigable node (last in BFS/graph order among the reachable set, excluding
 * `from` itself). Falls back to any other navigable node when nothing is reachable,
 * so the selectors are never seeded with an unreachable or control target.
 */
function defaultTarget(graph: UiGraph, from: string, nav: GraphNode[]): string {
  const reachable = reachableFrom(graph, from)
  const reachableNav = nav.filter((n) => n.id !== from && reachable.has(n.id))
  if (reachableNav.length > 0) return reachableNav[reachableNav.length - 1]!.id
  const other = nav.find((n) => n.id !== from)
  return other?.id ?? from
}

/**
 * Render the from/to selectors and the planned route. The selectors list only
 * navigable targets, grouped by route. Recomputes the path with core planPath
 * whenever the endpoints or graph change, lists each ordered step (event, guard,
 * modality), and reports the path's edge ids so the canvas can highlight them.
 * Distinguishes "same node", "no directed path", and "no navigable targets".
 */
export function Steps(props: StepsProps): JSX.Element {
  const { graph, onPathChange } = props
  const nav = useMemo(() => navigableNodes(graph), [graph])
  const navIds = useMemo(() => new Set(nav.map((n) => n.id)), [nav])

  const first = nav[0]?.id ?? ''
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(() => (first === '' ? '' : defaultTarget(graph, first, nav)))

  // Re-seed endpoints when the graph changes so they always point at live navigable nodes.
  useEffect(() => {
    if (!navIds.has(from)) {
      const nextFrom = first
      setFrom(nextFrom)
      setTo(nextFrom === '' ? '' : defaultTarget(graph, nextFrom, nav))
    } else if (!navIds.has(to)) {
      setTo(defaultTarget(graph, from, nav))
    }
  }, [graph, nav, navIds, first, from, to])

  const fromLabel = useMemo(() => nav.find((n) => n.id === from)?.label ?? from, [nav, from])
  const toLabel = useMemo(() => nav.find((n) => n.id === to)?.label ?? to, [nav, to])

  const path = useMemo<PlanStep[] | null>(() => {
    if (from === '' || to === '') return null
    return planPath(graph, from, to)
  }, [graph, from, to])

  const pathKey = path ? path.map((s) => s.edge.id).join(',') : ''
  useEffect(() => {
    onPathChange(pathKey === '' ? [] : pathKey.split(','))
  }, [pathKey, onPathChange])

  if (nav.length === 0) {
    return (
      <section className="steps">
        <h2>Plan path</h2>
        <p className="muted">No navigable screens in this graph.</p>
      </section>
    )
  }

  return (
    <section className="steps">
      <h2>Plan path</h2>
      <div className="steps-controls">
        <label>
          <span>from</span>
          <NavSelect nodes={nav} value={from} onChange={setFrom} />
        </label>
        <label>
          <span>to</span>
          <NavSelect nodes={nav} value={to} onChange={setTo} />
        </label>
      </div>
      {from === to ? (
        <p className="muted">Start and target are the same node.</p>
      ) : path === null ? (
        <p className="muted">
          No directed path from <strong>{fromLabel}</strong> to <strong>{toLabel}</strong>.
        </p>
      ) : (
        <ol className="steps-list">
          {path.map((s, i) => (
            <li key={s.edge.id}>
              <span className="step-index">{i + 1}.</span> {s.from.label} → {s.to.label}
              <span className="step-meta">
                {s.edge.event}
                {s.edge.guard ? ` [${s.edge.guard}]` : ''} · {s.edge.modality}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * A <select> over navigable nodes, grouped by route via <optgroup> so targets read
 * by their location (route, or "(no route)" for nodes without one).
 */
function NavSelect(props: { nodes: GraphNode[]; value: string; onChange: (id: string) => void }): JSX.Element {
  const { nodes, value, onChange } = props
  const groups = useMemo(() => groupByRoute(nodes), [nodes])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {[...groups.entries()].map(([route, items]) => (
        <optgroup key={route} label={route}>
          {items.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** Group navigable nodes into an insertion-ordered Map keyed by route ("(no route)" when null). */
function groupByRoute(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const out = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const key = n.route ?? '(no route)'
    const bucket = out.get(key)
    if (bucket) bucket.push(n)
    else out.set(key, [n])
  }
  return out
}
