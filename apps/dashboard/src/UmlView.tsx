// The UML statechart view: fetches the Mermaid source for the active workspace from the
// serve API and renders it client-side (the offline build ships no PlantUML renderer). It
// re-renders whenever the dashboard theme flips so the diagram tracks light/dark, and falls
// back to showing the raw Mermaid source in a <pre> if the renderer throws — a single
// malformed label should degrade to legible text, never blank the view. A real app's
// statechart is large, so the SVG sits on a TRANSFORM-based pan/zoom surface like the graph
// view: drag anywhere to move it (works at any zoom, not only when it overflows), wheel to
// zoom toward the cursor, Fit to frame the whole thing. A screen picker drills the wide
// hub-shaped overview down to one screen's readable statechart.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import type { CoverageReport } from '@ui-graph/core'
import { fetchUml } from './api'

/** Monotonic id for each mermaid.render call — mermaid needs a unique element id per render. */
let renderSeq = 0

/** A pan/zoom transform: translation in pane px + a scale factor. */
interface Transform {
  x: number
  y: number
  k: number
}

/** The natural pixel size a rendered mermaid SVG declares in its viewBox. */
function naturalSize(host: HTMLElement): { w: number; h: number } | null {
  const el = host.querySelector('svg')
  const vb = el?.getAttribute('viewBox')?.split(/\s+/).map(Number)
  if (el === null || vb === undefined || vb.length !== 4) return null
  return { w: vb[2] ?? 0, h: vb[3] ?? 0 }
}

/** One screen the picker can drill into: its node id and a human label. */
export interface UmlScreen {
  id: string
  label: string
}

/** The Graph|UML main-canvas view showing the state machine, trust legend, and the product KPI. */
export function UmlView(props: { wsId: string | null; theme: 'light' | 'dark'; coverage: CoverageReport | null; screens: UmlScreen[] }): JSX.Element {
  const { wsId, theme, coverage, screens } = props
  const [screenId, setScreenId] = useState<string>('')
  const [source, setSource] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [tf, setTf] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const paneRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const natRef = useRef<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setSvg(null)
    setFailed(false)
    void fetchUml(wsId, screenId || null).then((s) => {
      if (!cancelled) setSource(s)
    })
    return () => {
      cancelled = true
    }
  }, [wsId, screenId])

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

  // The transform that frames the whole diagram centered in the pane (with a small margin).
  const fitTransform = useCallback((): Transform => {
    const pane = paneRef.current
    const nat = natRef.current
    if (pane === null || nat === null || nat.w === 0 || nat.h === 0) return { x: 0, y: 0, k: 1 }
    const k = Math.min((pane.clientWidth - 32) / nat.w, (pane.clientHeight - 32) / nat.h, 1)
    return { k, x: (pane.clientWidth - nat.w * k) / 2, y: (pane.clientHeight - nat.h * k) / 2 }
  }, [])

  // After each render, strip mermaid's scale-to-width sizing (it would squash a wide diagram),
  // pin the SVG to its natural size, and frame it to Fit.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (svg === null || host === null) return
    const el = host.querySelector('svg')
    if (el === null) return
    const nat = naturalSize(host)
    natRef.current = nat
    if (nat !== null) {
      el.style.maxWidth = 'none'
      el.setAttribute('width', String(nat.w))
      el.setAttribute('height', String(nat.h))
    }
    setTf(fitTransform())
  }, [svg, fitTransform])

  const clampK = (k: number): number => Math.min(3, Math.max(0.05, k))
  // Wheel zooms toward the cursor: keep the graph point under the pointer fixed.
  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const pane = paneRef.current
    if (pane === null) return
    const rect = pane.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    setTf((t) => {
      const k = clampK(t.k * (e.deltaY < 0 ? 1.12 : 0.89))
      const ratio = k / t.k
      return { k, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio }
    })
  }
  const zoomBy = (factor: number): void => {
    const pane = paneRef.current
    if (pane === null) return
    const px = pane.clientWidth / 2
    const py = pane.clientHeight / 2
    setTf((t) => {
      const k = clampK(t.k * factor)
      const ratio = k / t.k
      return { k, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio }
    })
  }
  // Drag anywhere on the pane to pan the whole diagram — works at any zoom, unlike native scroll.
  const onPointerDown = (e: React.PointerEvent): void => {
    const pane = paneRef.current
    if (pane === null || e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    const origin = tf
    try {
      pane.setPointerCapture(e.pointerId)
    } catch {
      // a synthetic/absent pointer id can't be captured — panning still works via the listeners
    }
    pane.classList.add('uml-grabbing')
    const move = (ev: PointerEvent): void => {
      setTf({ ...origin, x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) })
    }
    const up = (): void => {
      pane.classList.remove('uml-grabbing')
      pane.removeEventListener('pointermove', move)
      pane.removeEventListener('pointerup', up)
    }
    pane.addEventListener('pointermove', move)
    pane.addEventListener('pointerup', up)
  }

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
        {svg !== null && !failed ? (
          <span className="uml-zoombar">
            <button type="button" onClick={() => zoomBy(0.83)} aria-label="Zoom out">
              −
            </button>
            <span className="uml-zoompct">{Math.round(tf.k * 100)}%</span>
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => setTf(fitTransform())}>
              Fit
            </button>
          </span>
        ) : null}
      </div>
      <div className="uml-diagram" ref={paneRef} onWheel={onWheel} onPointerDown={onPointerDown}>
        {failed && source !== null ? (
          <pre className="uml-source">{source}</pre>
        ) : svg !== null ? (
          <div className="uml-svg" ref={hostRef} style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})`, transformOrigin: '0 0' }} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="muted uml-status">Rendering diagram…</p>
        )}
      </div>
    </div>
  )
}
