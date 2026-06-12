// Runtime shape validation for the IR (feature F1.1). Hand-rolled structural
// checks — no schema dependency — returning a flat list of human-readable error
// strings (empty = valid). Used by load and by validate() before invariants run.

import type { GraphEdge, GraphNode, Overlay, UiGraph } from './ir'

const MODALITIES = new Set(['must', 'may', 'unknown'])
const SOURCES = new Set(['static', 'manual', 'runtime'])
const NODE_KINDS = new Set(['screen', 'route', 'modal', 'unknown', 'control'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkNode(n: unknown, i: number, errs: string[]): void {
  if (!isObject(n)) {
    errs.push(`nodes[${i}] is not an object`)
    return
  }
  if (typeof n['id'] !== 'string') errs.push(`nodes[${i}].id must be a string`)
  if (!(typeof n['route'] === 'string' || n['route'] === null)) errs.push(`nodes[${i}].route must be string|null`)
  if (!(typeof n['componentPath'] === 'string' || n['componentPath'] === null))
    errs.push(`nodes[${i}].componentPath must be string|null`)
  if (typeof n['label'] !== 'string') errs.push(`nodes[${i}].label must be a string`)
  if (typeof n['kind'] !== 'string' || !NODE_KINDS.has(n['kind'])) errs.push(`nodes[${i}].kind is invalid`)
  if (n['parent'] !== undefined && typeof n['parent'] !== 'string') errs.push(`nodes[${i}].parent must be a string`)
  if (n['control'] !== undefined) {
    const c = n['control']
    if (!isObject(c)) errs.push(`nodes[${i}].control must be an object`)
    else {
      if (typeof c['element'] !== 'string') errs.push(`nodes[${i}].control.element must be a string`)
      if (typeof c['controlType'] !== 'string') errs.push(`nodes[${i}].control.controlType must be a string`)
      for (const arr of ['events', 'effects']) {
        if (c[arr] !== undefined && !(Array.isArray(c[arr]) && c[arr].every((s) => typeof s === 'string')))
          errs.push(`nodes[${i}].control.${arr} must be a string array`)
      }
    }
  }
}

function checkEdge(e: unknown, i: number, errs: string[]): void {
  if (!isObject(e)) {
    errs.push(`edges[${i}] is not an object`)
    return
  }
  if (typeof e['id'] !== 'string') errs.push(`edges[${i}].id must be a string`)
  if (typeof e['from'] !== 'string') errs.push(`edges[${i}].from must be a string`)
  if (typeof e['to'] !== 'string') errs.push(`edges[${i}].to must be a string`)
  if (typeof e['event'] !== 'string') errs.push(`edges[${i}].event must be a string`)
  if (!(typeof e['guard'] === 'string' || e['guard'] === null)) errs.push(`edges[${i}].guard must be string|null`)
  if (!(typeof e['effect'] === 'string' || e['effect'] === null)) errs.push(`edges[${i}].effect must be string|null`)
  if (typeof e['modality'] !== 'string' || !MODALITIES.has(e['modality'])) errs.push(`edges[${i}].modality is invalid`)
  if (typeof e['source'] !== 'string' || !SOURCES.has(e['source'])) errs.push(`edges[${i}].source is invalid`)
  if (typeof e['confidence'] !== 'number' || Number.isNaN(e['confidence'])) errs.push(`edges[${i}].confidence must be a number`)
}

/** Validate the structural shape of a UiGraph. Returns error strings (empty = ok). */
export function validateGraphShape(value: unknown): string[] {
  const errs: string[] = []
  if (!isObject(value)) return ['graph is not an object']
  if (value['version'] !== 0) errs.push('graph.version must be 0')
  if (!isObject(value['meta'])) {
    errs.push('graph.meta must be an object')
  } else {
    const meta = value['meta']
    for (const k of ['adapter', 'adapterVersion', 'rulesetVersion']) {
      if (typeof meta[k] !== 'string') errs.push(`graph.meta.${k} must be a string`)
    }
  }
  if (!Array.isArray(value['nodes'])) errs.push('graph.nodes must be an array')
  else value['nodes'].forEach((n, i) => checkNode(n, i, errs))
  if (!Array.isArray(value['edges'])) errs.push('graph.edges must be an array')
  else value['edges'].forEach((e, i) => checkEdge(e, i, errs))
  return errs
}

/** Validate the structural shape of an Overlay. Returns error strings (empty = ok). */
export function validateOverlayShape(value: unknown): string[] {
  const errs: string[] = []
  if (!isObject(value)) return ['overlay is not an object']
  if (value['version'] !== 0) errs.push('overlay.version must be 0')
  if (typeof value['base'] !== 'string') errs.push('overlay.base must be a string')
  for (const arr of ['addedNodes', 'addedEdges', 'editedEdges', 'removedRefs']) {
    if (!Array.isArray(value[arr])) errs.push(`overlay.${arr} must be an array`)
  }
  if (Array.isArray(value['addedNodes'])) value['addedNodes'].forEach((n, i) => checkNode(n, i, errs))
  if (Array.isArray(value['addedEdges'])) value['addedEdges'].forEach((e, i) => checkEdge(e, i, errs))
  if (Array.isArray(value['editedEdges'])) value['editedEdges'].forEach((e, i) => checkEdge(e, i, errs))
  if (Array.isArray(value['removedRefs']))
    value['removedRefs'].forEach((r, i) => {
      if (typeof r !== 'string') errs.push(`overlay.removedRefs[${i}] must be a string`)
    })
  return errs
}

/** Narrowing parse: returns the value typed as UiGraph after a shape check throws on failure. */
export function assertGraphShape(value: unknown): asserts value is UiGraph {
  const errs = validateGraphShape(value)
  if (errs.length > 0) throw new Error(`Invalid UiGraph shape:\n  ${errs.join('\n  ')}`)
}

/** Narrowing parse for overlays. */
export function assertOverlayShape(value: unknown): asserts value is Overlay {
  const errs = validateOverlayShape(value)
  if (errs.length > 0) throw new Error(`Invalid Overlay shape:\n  ${errs.join('\n  ')}`)
}

export type { GraphNode, GraphEdge }
