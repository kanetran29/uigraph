// OpenAPI binding (dossier §7 intent layer / §8 test setup). The adapters emit
// API effects as opaque strings like "api:POST /api/orders"; this module resolves
// each against an OpenAPI spec (the backend's source of truth) to recover the
// request payload and the success/error responses, so the AI consumer knows the
// full contract behind a control. It is framework-agnostic and dependency-free:
// it consumes a parsed JSON spec object (the CLI handles file/YAML loading).
//
// Effects with no matching operation are reported as drift (code ↔ docs mismatch).

import type { UiGraph } from './ir'

/** A top-level request-body field recovered from an operation's JSON schema. */
export interface ApiField {
  name: string
  type: string
  required: boolean
}

/** A compact summary of one response of an operation. */
export interface ApiResponseSummary {
  status: string
  description?: string
  schema?: string
}

/** The resolved contract for one API effect. */
export interface ApiOperationSummary {
  effect: string
  method: string
  path: string
  operationId?: string
  summary?: string
  request: ApiField[]
  responses: ApiResponseSummary[]
}

/** The api-bindings sidecar: resolved contracts plus the drift (unmatched) list. */
export interface ApiBindings {
  version: 0
  base: string
  spec: string
  bindings: ApiOperationSummary[]
  unmatched: string[]
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse an "api:METHOD /path" effect string into its method and path. */
export function parseApiEffect(effect: string): { method: string; path: string } | null {
  if (!effect.startsWith('api:')) return null
  const rest = effect.slice(4).trim()
  const sp = rest.indexOf(' ')
  if (sp === -1) return null
  const method = rest.slice(0, sp).toUpperCase()
  const path = (rest.slice(sp + 1).split('?')[0] ?? '').trim()
  return path ? { method, path } : null
}

/** Follow a local "#/components/schemas/X" $ref one hop; returns the target or null. */
function resolveRef(spec: Json, ref: unknown): Json | null {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null
  let cur: unknown = spec
  for (const seg of ref.slice(2).split('/')) {
    if (!isObject(cur)) return null
    cur = cur[seg]
  }
  return isObject(cur) ? cur : null
}

/** Best-effort compact type name for a JSON-schema node ($ref → its target name). */
function schemaType(spec: Json, schema: unknown): string {
  if (!isObject(schema)) return 'unknown'
  if (typeof schema['$ref'] === 'string') {
    const name = schema['$ref'].split('/').pop()
    return name ?? 'object'
  }
  const t = schema['type']
  if (t === 'array') {
    const items = schema['items']
    return `array<${schemaType(spec, items)}>`
  }
  return typeof t === 'string' ? t : 'object'
}

/** Whether a path pattern (possibly with {param}) matches a concrete-ish path. */
function pathMatches(specPath: string, effectPath: string): boolean {
  const a = specPath.split('/').filter(Boolean)
  const b = effectPath.split('/').filter(Boolean)
  if (a.length !== b.length) return false
  return a.every((seg, i) => seg.startsWith('{') || seg === b[i])
}

/** Resolve a method+path to an operation object in the spec, with {param} matching. */
function resolveOperation(spec: Json, method: string, path: string): { op: Json; specPath: string } | null {
  const paths = isObject(spec['paths']) ? spec['paths'] : {}
  const lower = method.toLowerCase()
  const direct = paths[path]
  if (isObject(direct) && isObject(direct[lower])) return { op: direct[lower], specPath: path }
  for (const [p, item] of Object.entries(paths)) {
    if (isObject(item) && isObject(item[lower]) && pathMatches(p, path)) return { op: item[lower], specPath: p }
  }
  return null
}

/** Extract the top-level request-body fields (application/json) of an operation. */
function requestFields(spec: Json, op: Json): ApiField[] {
  const body = op['requestBody']
  if (!isObject(body)) return []
  const content = isObject(body['content']) ? body['content'] : {}
  const json = content['application/json']
  if (!isObject(json)) return []
  let schema = json['schema']
  if (isObject(schema) && typeof schema['$ref'] === 'string') schema = resolveRef(spec, schema['$ref']) ?? schema
  if (!isObject(schema) || !isObject(schema['properties'])) return []
  const required = Array.isArray(schema['required']) ? (schema['required'] as unknown[]) : []
  return Object.entries(schema['properties']).map(([name, sub]) => ({
    name,
    type: schemaType(spec, sub),
    required: required.includes(name),
  }))
}

/** Summarize the declared responses of an operation. */
function responseSummaries(spec: Json, op: Json): ApiResponseSummary[] {
  const responses = isObject(op['responses']) ? op['responses'] : {}
  return Object.entries(responses).map(([status, r]) => {
    const ro = isObject(r) ? r : {}
    const content = isObject(ro['content']) ? ro['content'] : {}
    const json = isObject(content['application/json']) ? content['application/json'] : undefined
    const schema = json && isObject(json['schema']) ? schemaType(spec, json['schema']) : undefined
    return {
      status,
      ...(typeof ro['description'] === 'string' ? { description: ro['description'] } : {}),
      ...(schema ? { schema } : {}),
    }
  })
}

/** Resolve one "api:..." effect to its full contract summary, or null if absent from the spec. */
export function summarizeApiEffect(spec: Json, effect: string): ApiOperationSummary | null {
  const parsed = parseApiEffect(effect)
  if (!parsed) return null
  const found = resolveOperation(spec, parsed.method, parsed.path)
  if (!found) return null
  const op = found.op
  return {
    effect,
    method: parsed.method,
    path: found.specPath,
    ...(typeof op['operationId'] === 'string' ? { operationId: op['operationId'] } : {}),
    ...(typeof op['summary'] === 'string' ? { summary: op['summary'] } : {}),
    request: requestFields(spec, op),
    responses: responseSummaries(spec, op),
  }
}

/** Collect every distinct "api:..." effect referenced by a graph's edges and controls. */
export function collectApiEffects(graph: UiGraph): string[] {
  const set = new Set<string>()
  for (const e of graph.edges) if (e.effect && e.effect.startsWith('api:')) set.add(e.effect)
  for (const n of graph.nodes) {
    for (const eff of n.control?.effects ?? []) if (eff.startsWith('api:')) set.add(eff)
  }
  return [...set]
}

/**
 * Resolve every API effect in a graph against an OpenAPI spec. Matched effects
 * become bindings (the contract); unmatched effects are drift — the code calls an
 * endpoint the docs do not declare.
 */
export function buildApiBindings(graph: UiGraph, spec: Json, baseHash: string): ApiBindings {
  const effects = collectApiEffects(graph)
  const bindings: ApiOperationSummary[] = []
  const unmatched: string[] = []
  for (const eff of effects) {
    const summary = summarizeApiEffect(spec, eff)
    if (summary) bindings.push(summary)
    else unmatched.push(eff)
  }
  const info = isObject(spec['info']) ? spec['info'] : {}
  const specName = `${typeof info['title'] === 'string' ? info['title'] : 'OpenAPI'} ${typeof info['version'] === 'string' ? info['version'] : ''}`.trim()
  return { version: 0, base: baseHash, spec: specName, bindings, unmatched }
}
