// Shared value-objects that flow through the Vue extraction pipeline: a
// classified navigation target and the raw (pre-route-match) navigation record
// built from it, imported by the target/nav/template modules and the orchestrator.

/** A classified navigation target: exact literal path, static template prefix, a set of route names, or fully dynamic. */
export type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'names'; values: string[] }
  | { kind: 'dynamic' }

/** A navigation observed at a source location before it is matched to a route: target, event, effect, rule id, position and guard. */
export interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  ruleId: string
  loc: { line: number; col: number }
  guard: string | null
}
