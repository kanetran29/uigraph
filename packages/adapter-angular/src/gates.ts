// Guard→gate reduction for the Angular adapter: reduce a target route's
// `canActivate` guards to the reachability gate they impose on an incoming edge
// (guarded?, guard texts, confidence, async/signal guards), and emit one
// soundiness note per distinct undecidable (Observable/Promise or Angular-signal)
// guard.

import type { GuardInfo } from './guards'
import type { SoundinessNote } from '@uigraph/core'

/** The reachability gate a target route's `canActivate` guards impose on an incoming edge. */
export interface Gate {
  guarded: boolean
  guardTexts: string[]
  confidence: number
  asyncGuards: GuardInfo[]
  signalGuards: GuardInfo[]
}

const FUNCTIONAL_GUARD_CONFIDENCE = 0.6
const ASYNC_GUARD_CONFIDENCE = 0.5

/**
 * Reduce a target route's guards to a gate. A guard whose body is the literal
 * `true` does not gate (it always passes), so it is dropped; every other guard
 * gates the edge to `may`. Confidence is the minimum across guards:
 * Observable/Promise-returning guards (whose body cannot be evaluated statically)
 * pull it down to ~0.5, otherwise functional/class guards sit at 0.6. The
 * `asyncGuards` are surfaced so the caller can owe one soundiness note each.
 */
export function gateFromGuards(guards: GuardInfo[]): Gate {
  const gating = guards.filter((g) => g.literalBoolean !== true)
  if (gating.length === 0) return { guarded: false, guardTexts: [], confidence: 1, asyncGuards: [], signalGuards: [] }
  const asyncGuards = gating.filter((g) => g.async)
  const signalGuards = gating.filter((g) => g.signal === true)
  const confidence = asyncGuards.length > 0 ? ASYNC_GUARD_CONFIDENCE : FUNCTIONAL_GUARD_CONFIDENCE
  return { guarded: true, guardTexts: gating.map((g) => g.text), confidence, asyncGuards, signalGuards }
}

/**
 * Push one soundiness note per distinct undecidable guard on `routePath`: an
 * `async-guard` note for an Observable/Promise-returning guard (decided at
 * runtime) and a `signal-guard` note for a guard that reads its decision from an
 * Angular signal (resolves synchronously but is reactive, so its value can change
 * between map-time and run-time). Deduped via `seen` (keyed by kind+route+guard)
 * so a guard gating several incoming edges still yields a single note per kind.
 */
export function noteGuards(gate: Gate, routePath: string, sink: SoundinessNote[], seen: Set<string>): void {
  for (const g of gate.asyncGuards) {
    const key = `async ${routePath} ${g.text}`
    if (seen.has(key)) continue
    seen.add(key)
    sink.push({ kind: 'async-guard', detail: `guard "${g.text}" on route ${routePath} returns an Observable/Promise; gate decided at runtime` })
  }
  for (const g of gate.signalGuards) {
    const key = `signal ${routePath} ${g.text}`
    if (seen.has(key)) continue
    seen.add(key)
    sink.push({ kind: 'signal-guard', detail: `guard "${g.text}" on route ${routePath} reads an Angular signal; gate resolves synchronously but is reactive (value may change between map-time and run-time)` })
  }
}
