// The planning panel: sketch a new feature on the graph. Add a new screen node
// (lands in the manual overlay, never the proven base) and export the overlay as a
// markdown "planned changes" spec to hand to a dev or agent. Editing/connecting the
// new screens uses the existing canvas affordances (drag-to-connect, edit edge).

import { useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'

/** Props: live status, scenarios, and add-screen/export/switch callbacks. */
export interface PlanProps {
  live: boolean
  scenarios: { active: string; names: string[] }
  onAddScreen: (label: string, route: string) => void
  onExport: () => void
  onSwitchScenario: (name: string) => void
}

/** Render the scenario selector + add-screen form + export button. */
export function Plan(props: PlanProps): JSX.Element {
  const [label, setLabel] = useState('')
  const [route, setRoute] = useState('')
  const [newScenario, setNewScenario] = useState('')
  const submit = (): void => {
    if (label.trim().length === 0) return
    props.onAddScreen(label.trim(), route.trim())
    setLabel('')
    setRoute('')
  }
  return (
    <CollapsibleSection id="plan" className="plan" title="Plan a feature">
      <label className="field-edit">
        <span>scenario</span>
        <select value={props.scenarios.active} onChange={(e) => props.onSwitchScenario(e.target.value)}>
          {props.scenarios.names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="plan-form" style={{ marginTop: 8 }}>
        <input className="plan-input" placeholder="New scenario name" value={newScenario} onChange={(e) => setNewScenario(e.target.value)} />
        <button
          className="plan-add"
          disabled={newScenario.trim().length === 0}
          onClick={() => {
            props.onSwitchScenario(newScenario.trim())
            setNewScenario('')
          }}
        >
          + New scenario
        </button>
      </div>
      <div className="plan-form" style={{ marginTop: 8 }}>
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
    </CollapsibleSection>
  )
}
