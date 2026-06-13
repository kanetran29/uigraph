// The planning panel: sketch a new feature on the graph. Add a new screen node
// (lands in the manual overlay, never the proven base) and export the overlay as a
// markdown "planned changes" spec to hand to a dev or agent. Editing/connecting the
// new screens uses the existing canvas affordances (drag-to-connect, edit edge).

import { useState } from 'react'

/** Props: live status, an add-screen callback, and an export-plan callback. */
export interface PlanProps {
  live: boolean
  onAddScreen: (label: string, route: string) => void
  onExport: () => void
}

/** Render the add-screen form + export button. */
export function Plan(props: PlanProps): JSX.Element {
  const [label, setLabel] = useState('')
  const [route, setRoute] = useState('')
  const submit = (): void => {
    if (label.trim().length === 0) return
    props.onAddScreen(label.trim(), route.trim())
    setLabel('')
    setRoute('')
  }
  return (
    <section className="plan">
      <h2>Plan a feature</h2>
      <div className="plan-form">
        <input className="plan-input" placeholder="New screen label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="plan-input" placeholder="/route (optional)" value={route} onChange={(e) => setRoute(e.target.value)} />
        <button className="plan-add" disabled={label.trim().length === 0} onClick={submit}>
          + Add screen
        </button>
      </div>
      <button className="plan-export" onClick={props.onExport}>
        Export plan ↓
      </button>
      {!props.live ? <p className="muted">Connect a live project (uigraph serve) to persist planned edits.</p> : null}
    </section>
  )
}
