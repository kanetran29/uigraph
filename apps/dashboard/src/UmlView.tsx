// The UML statechart view: fetches the Mermaid source for the active workspace from the
// serve API and renders it client-side (the offline build ships no PlantUML renderer). It
// re-renders whenever the dashboard theme flips so the diagram tracks light/dark, and falls
// back to showing the raw Mermaid source in a <pre> if the renderer throws — a single
// malformed label should degrade to legible text, never blank the view.

import { useEffect, useState } from 'react'
import mermaid from 'mermaid'
import type { CoverageReport } from '@ui-graph/core'
import { fetchUml } from './api'

/** Monotonic id for each mermaid.render call — mermaid needs a unique element id per render. */
let renderSeq = 0

/** The Graph|UML main-canvas view showing the state machine, trust legend, and the product KPI. */
export function UmlView(props: { wsId: string | null; theme: 'light' | 'dark'; coverage: CoverageReport | null }): JSX.Element {
  const { wsId, theme, coverage } = props
  const [source, setSource] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setSvg(null)
    setFailed(false)
    void fetchUml(wsId).then((s) => {
      if (!cancelled) setSource(s)
    })
    return () => {
      cancelled = true
    }
  }, [wsId])

  useEffect(() => {
    if (source === null) return
    let cancelled = false
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict', suppressErrorRendering: true })
    mermaid
      .render(`uml-svg-${renderSeq++}`, source)
      .then(({ svg: out }) => {
        if (cancelled) return
        setSvg(out)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setSvg(null)
        setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [source, theme])

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
      </div>
      <div className="uml-diagram">
        {failed && source !== null ? (
          <pre className="uml-source">{source}</pre>
        ) : svg !== null ? (
          <div className="uml-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="muted uml-status">Rendering diagram…</p>
        )}
      </div>
    </div>
  )
}
