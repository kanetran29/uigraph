// The inspector panel: a read-only display of every field of the selected node or
// edge (route, componentPath, event, guard, effect, modality, source, confidence,
// witness). Editing lives in uigraph studio.

import type { ReactNode } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import { useT } from './i18n'
import type { Selection } from './GraphCanvas'

/** Props for the inspector: the current selection. */
export interface InspectorProps {
  selection: Selection
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
 * Render the inspector for the current selection. Shows a placeholder when
 * nothing is selected, the node's fields for a node, and the full edge fields
 * for an edge.
 */
export function Inspector(props: InspectorProps): JSX.Element {
  const { selection } = props
  const { t } = useT()
  let title: ReactNode = t('panel.inspector')
  let body: ReactNode = <p className="muted">Select a node or edge to inspect it.</p>

  if (selection !== null && selection.kind === 'node') {
    const n = selection.node
    const manual = n.id.startsWith('n_manual')

    if (n.kind === 'control' && n.control) {
      const c = n.control
      title = (
        <>
          Control <Badge text={c.controlType} tone="#334155" />
          {manual ? <Badge text="manual" tone="#7c3aed" /> : null}
        </>
      )
      body = (
        <>
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
        </>
      )
    } else {
      title = <>Node {manual ? <Badge text="manual" tone="#7c3aed" /> : null}</>
      body = (
        <>
          <Field label="id" value={n.id} />
          <Field label="label" value={n.label} />
          <Field label="route" value={n.route ?? '—'} />
          <Field label="componentPath" value={n.componentPath ?? '—'} />
          <Field label="kind" value={n.kind} />
        </>
      )
    }
  } else if (selection !== null) {
    const e = selection.edge
    const w = e.witness
    title = (
      <>
        Edge <Badge text={e.modality} tone="#334155" /> <Badge text={e.source} tone={sourceTone(e.source)} />
        {e.witnessStale === true ? <Badge text="stale witness" tone="#b45309" /> : null}
      </>
    )
    body = (
      <>
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
      </>
    )
  }

  return (
    <CollapsibleSection id="inspector" className="inspector" title={title}>
      {body}
    </CollapsibleSection>
  )
}
