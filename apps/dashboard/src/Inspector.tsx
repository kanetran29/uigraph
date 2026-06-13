// The inspector panel: shows every field of the selected node or edge (route,
// componentPath, event, guard, effect, modality, source, confidence, witness) and
// exposes the manual-edit controls. Editing an edge's label/guard or deleting an
// element raises a request the parent turns into an overlay POST.

import { useEffect, useState } from 'react'
import type { GraphEdge } from '@uigraph/core'
import type { Selection } from './GraphCanvas'

/** Props for the inspector: the current selection plus edit/delete callbacks. */
export interface InspectorProps {
  selection: Selection
  onEditEdge: (edge: GraphEdge, event: string, guard: string | null) => void
  onDelete: (id: string) => void
}

/** A single label/value row in the inspector's field list. */
function Field(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <span className="field-value">{props.value}</span>
    </div>
  )
}

/** Small coloured chip used for source/modality badges. */
function Badge(props: { text: string; tone: string }): JSX.Element {
  return (
    <span className="badge" style={{ background: props.tone }}>
      {props.text}
    </span>
  )
}

/** A background colour per source provenance, matching the canvas legend (manual violet, runtime emerald, static slate). */
function sourceTone(source: string): string {
  if (source === 'manual') return '#7c3aed'
  if (source === 'runtime') return '#047857'
  return '#475569'
}

/**
 * The edge editor: editable event + guard fields with a save button, plus delete.
 * Local state is seeded from the edge and re-seeded when a different edge is
 * selected, so switching selection never shows a stale draft.
 */
function EdgeEditor(props: {
  edge: GraphEdge
  onEditEdge: InspectorProps['onEditEdge']
  onDelete: InspectorProps['onDelete']
}): JSX.Element {
  const { edge, onEditEdge, onDelete } = props
  const [event, setEvent] = useState(edge.event)
  const [guard, setGuard] = useState(edge.guard ?? '')

  useEffect(() => {
    setEvent(edge.event)
    setGuard(edge.guard ?? '')
  }, [edge.id, edge.event, edge.guard])

  return (
    <div className="editor">
      <label className="edit-row">
        <span>event</span>
        <input value={event} onChange={(e) => setEvent(e.target.value)} />
      </label>
      <label className="edit-row">
        <span>guard</span>
        <input value={guard} onChange={(e) => setGuard(e.target.value)} placeholder="(none)" />
      </label>
      <div className="editor-actions">
        <button onClick={() => onEditEdge(edge, event, guard.trim() === '' ? null : guard.trim())}>Save edit</button>
        <button className="danger" onClick={() => onDelete(edge.id)}>
          Delete
        </button>
      </div>
    </div>
  )
}

/**
 * Render the inspector for the current selection. Shows a placeholder when
 * nothing is selected, the node's fields for a node, and the full edge fields
 * plus the manual editor for an edge.
 */
export function Inspector(props: InspectorProps): JSX.Element {
  const { selection, onEditEdge, onDelete } = props

  if (selection === null) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="muted">Select a node or edge to inspect it.</p>
      </aside>
    )
  }

  if (selection.kind === 'node') {
    const n = selection.node
    const manual = n.id.startsWith('n_manual')

    if (n.kind === 'control' && n.control) {
      const c = n.control
      return (
        <aside className="inspector">
          <h2>
            Control <Badge text={c.controlType} tone="#334155" />
            {manual ? <Badge text="manual" tone="#7c3aed" /> : null}
          </h2>
          <Field label="id" value={n.id} />
          <Field label="label" value={n.label} />
          <Field label="parent" value={n.parent ?? '—'} />
          <Field label="element" value={c.element} />
          <Field label="controlType" value={c.controlType} />
          <Field label="name" value={c.name ?? '—'} />
          <Field
            label="selector"
            value={c.selector ? `${c.selector.strategy}: ${c.selector.value}${c.selector.nth ? ` #${c.selector.nth}` : ''}` : '—'}
          />
          {c.input ? (
            <Field
              label="input"
              value={[c.input.type, c.input.required ? 'required' : null, c.input.pattern].filter(Boolean).join(' · ') || '—'}
            />
          ) : null}
          <h3>events</h3>
          {c.events && c.events.length > 0 ? (
            <ul className="effects-list">
              {c.events.map((ev) => (
                <li key={ev}>{ev}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No events.</p>
          )}
          <h3>effects</h3>
          {c.effects && c.effects.length > 0 ? (
            <ul className="effects-list">
              {c.effects.map((eff) => (
                <li key={eff}>{eff}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No effects.</p>
          )}
          <div className="editor-actions">
            <button className="danger" onClick={() => onDelete(n.id)}>
              Delete
            </button>
          </div>
        </aside>
      )
    }

    return (
      <aside className="inspector">
        <h2>
          Node {manual ? <Badge text="manual" tone="#7c3aed" /> : null}
        </h2>
        <Field label="id" value={n.id} />
        <Field label="label" value={n.label} />
        <Field label="route" value={n.route ?? '—'} />
        <Field label="componentPath" value={n.componentPath ?? '—'} />
        <Field label="kind" value={n.kind} />
        <div className="editor-actions">
          <button className="danger" onClick={() => onDelete(n.id)}>
            Delete
          </button>
        </div>
      </aside>
    )
  }

  const e = selection.edge
  const w = e.witness
  return (
    <aside className="inspector">
      <h2>
        Edge <Badge text={e.modality} tone="#334155" /> <Badge text={e.source} tone={sourceTone(e.source)} />
      </h2>
      <Field label="id" value={e.id} />
      <Field label="from → to" value={`${e.from} → ${e.to}`} />
      <Field label="event" value={e.event} />
      <Field label="guard" value={e.guard ?? '—'} />
      <Field label="effect" value={e.effect ?? '—'} />
      <Field label="modality" value={e.modality} />
      <Field label="source" value={e.source} />
      <Field label="confidence" value={e.confidence.toFixed(2)} />
      <Field
        label="witness"
        value={w ? `${w.source}${w.file ? ` ${w.file}` : ''}${w.loc ? `:${w.loc.line}:${w.loc.col}` : ''}${w.ruleId ? ` (${w.ruleId})` : ''}` : '—'}
      />
      <h3>Manual edit</h3>
      <EdgeEditor edge={e} onEditEdge={onEditEdge} onDelete={onDelete} />
    </aside>
  )
}
