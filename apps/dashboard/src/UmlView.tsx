// The UML statechart view: fetches the workspace's StateModel from the serve API and renders
// it in React Flow via StatechartCanvas, so the state nodes are DRAGGABLE (mermaid could only
// draw a static SVG). Zoom/pan + Fit come from React Flow's built-ins, so this component only
// owns the surrounding chrome: the trust legend, the product KPI, and the screen picker that
// drills the wide overview down to one screen's readable statechart (re-fetching its model).

import { useEffect, useState } from 'react'
import type { CoverageReport, StateModel } from '@ui-graph/core'
import { fetchUmlModel } from './api'
import { StatechartCanvas } from './StatechartCanvas'

/** One screen the picker can drill into: its node id and a human label. */
export interface UmlScreen {
  id: string
  label: string
}

/** The Graph|UML main-canvas view showing the state machine, trust legend, and the product KPI. */
export function UmlView(props: { wsId: string | null; theme: 'light' | 'dark'; coverage: CoverageReport | null; screens: UmlScreen[] }): JSX.Element {
  const { wsId, theme, coverage, screens } = props
  const [screenId, setScreenId] = useState<string>('')
  const [model, setModel] = useState<StateModel | null>(null)

  useEffect(() => {
    let cancelled = false
    setModel(null)
    void fetchUmlModel(wsId, screenId || null).then((m) => {
      if (!cancelled) setModel(m)
    })
    return () => {
      cancelled = true
    }
  }, [wsId, screenId])

  const pct = coverage ? Math.round(coverage.verifiedOfReached * 100) : null

  return (
    <div className="uml-view">
      <div className="uml-legend" role="note" aria-label="State trust legend">
        <span className="uml-legend-item">
          <span className="uml-swatch uml-verified" aria-hidden="true" />
          verified
        </span>
        <span className="uml-legend-item">
          <span className="uml-swatch uml-gated" aria-hidden="true" />
          gated
        </span>
        <span className="uml-legend-item">
          <span className="uml-swatch uml-refuted" aria-hidden="true" />
          refuted
        </span>
        {pct !== null ? (
          <span className="uml-kpi">
            verified/reached <strong>{pct}%</strong> ({coverage!.reachedCount} reached)
          </span>
        ) : null}
        <select className="uml-screen-picker" value={screenId} onChange={(e) => setScreenId(e.target.value)} aria-label="Focus one screen">
          <option value="">Overview (all screens)</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="uml-diagram">
        {model !== null ? (
          <StatechartCanvas key={`${wsId ?? ''}|${screenId || 'overview'}`} model={model} colorMode={theme} />
        ) : (
          <p className="muted uml-status">Rendering diagram…</p>
        )}
      </div>
    </div>
  )
}
