// The coverage panel: how much of the proven graph is runtime-witnessed (Tier-3
// confirmed) vs static/manual, with the list of unverified edges. Clicking an
// unverified edge selects it on the canvas so the user can see what to confirm.

import { useMemo, useState } from 'react'
import type { CoverageReport, EdgeCoverage, GraphEdge, UiGraph } from '@uigraph/core'
import { matchCoverageRow } from './search'
import { FilterChip, toggled } from './Chips'
import { CollapsibleSection } from './CollapsibleSection'
import { useT } from './i18n'
import type { Selection } from './GraphCanvas'

/** Props: the coverage report, the graph (to resolve an edge id back to a GraphEdge), and select. */
export interface CoverageProps {
  coverage: CoverageReport
  graph: UiGraph
  onSelect: (selection: Selection) => void
}

/** A labelled count chip (e.g. "must 12"). */
function CountChip(props: { label: string; n: number }): JSX.Element {
  return (
    <span className="cov-chip">
      {props.label} <strong>{props.n}</strong>
    </span>
  )
}

/**
 * Render the coverage panel: a verified/total bar, modality + source breakdowns,
 * and the unverified-edge list. An edge row selects that edge on the canvas.
 */
export function Coverage(props: CoverageProps): JSX.Element {
  const { coverage, graph, onSelect } = props
  const { t } = useT()
  // Headline is the HONEST "done" metric (accounted-for); runtime-verified is always
  // co-reported beside it so a parked-heavy graph can never read as "100% verified".
  const accountedPct = Math.round((coverage.accountedRatio ?? coverage.ratio) * 100)
  const runtimePct = Math.round(coverage.runtimeRatio * 100)
  const allOpen = coverage.open ?? coverage.unverified
  const allParked = coverage.parked ?? []
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]))
  const selectEdge = (id: string): void => {
    const e: GraphEdge | undefined = edgeById.get(id)
    if (e) onSelect({ kind: 'edge', edge: e })
  }

  // Local filter chips over the edge lists (empty axis = all). Built from the values
  // actually present across the open + parked rows so no stale option is offered.
  const [statuses, setStatuses] = useState<Set<EdgeCoverage['status']>>(new Set())
  const [modalities, setModalities] = useState<Set<string>>(new Set())
  const rows = useMemo(() => [...allOpen, ...allParked], [allOpen, allParked])
  const presentStatuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort() as EdgeCoverage['status'][], [rows])
  const presentModalities = useMemo(() => [...new Set(rows.map((r) => r.modality))].sort(), [rows])
  const filter = { statuses, modalities, sources: new Set<string>() }
  const open = useMemo(() => allOpen.filter((r) => matchCoverageRow(r, filter)), [allOpen, statuses, modalities])
  const parked = useMemo(() => allParked.filter((r) => matchCoverageRow(r, filter)), [allParked, statuses, modalities])

  return (
    <CollapsibleSection id="coverage" className="coverage" title={t('panel.coverage')}>
      <div className="cov-headline" title={`${coverage.accounted} of ${coverage.total} edges accounted-for (witnessed or parked)`}>
        <div className="cov-bar">
          <div className="cov-bar-fill" style={{ width: `${accountedPct}%` }} />
        </div>
        <span className="cov-pct">
          {accountedPct}% accounted-for <span className="muted">({coverage.accounted ?? coverage.verified}/{coverage.total})</span>
        </span>
      </div>
      <p className="muted cov-sub">
        runtime-verified {runtimePct}% ({coverage.runtimeVerified ?? coverage.verified}/{coverage.total}) · parked {allParked.length}
      </p>

      <div className="cov-chips">
        {Object.entries(coverage.bySource).map(([k, n]) => (
          <CountChip key={`s-${k}`} label={k} n={n} />
        ))}
      </div>
      <div className="cov-chips">
        {Object.entries(coverage.byModality).map(([k, n]) => (
          <CountChip key={`m-${k}`} label={k} n={n} />
        ))}
      </div>

      {presentStatuses.length > 1 || presentModalities.length > 1 ? (
        <div className="filter-chips" role="group" aria-label="Filter edges by status and modality">
          {presentStatuses.map((s) => (
            <FilterChip key={`st-${s}`} label={s} active={statuses.has(s)} onClick={() => setStatuses((p) => toggled(p, s))} />
          ))}
          {presentModalities.map((m) => (
            <FilterChip key={`mo-${m}`} label={m} active={modalities.has(m)} onClick={() => setModalities((p) => toggled(p, m))} />
          ))}
        </div>
      ) : null}

      <h3>open ({open.length})</h3>
      {open.length > 0 ? (
        <ul className="cov-list">
          {open.map((e) => (
            <li key={e.id}>
              <button className="cov-row" onClick={() => selectEdge(e.id)} title="select this edge">
                <span className="cov-modality">{e.status ?? e.modality}</span>
                <span className="cov-edge">
                  {e.from} → {e.to}
                </span>
                <span className="cov-event">{e.event}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">100% accounted-for — every edge is witnessed or parked.</p>
      )}

      {parked.length > 0 && (
        <>
          <h3>parked ({parked.length})</h3>
          <ul className="cov-list">
            {parked.map((e) => (
              <li key={e.id}>
                <button className="cov-row cov-row--stacked" onClick={() => selectEdge(e.id)} title={e.reason ?? 'parked'}>
                  <span className="cov-row-head">
                    <span className="cov-modality">parked</span>
                    <span className="cov-edge">
                      {e.from} → {e.to}
                    </span>
                  </span>
                  {e.reason ? <span className="cov-reason">{e.reason}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </CollapsibleSection>
  )
}
