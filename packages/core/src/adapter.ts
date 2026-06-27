// The adapter contract (docs/40-adapter-contract.md). The core defines this
// interface; React/Angular adapters implement it. No framework or ts-morph type
// is imported here — the context exposes only generic services so the core stays
// framework-agnostic. Adapters create their own TS project internally.

import type { UiGraph } from './ir'
import type { Proposal } from './proposals'

/** Level-gated structured logger handed to an adapter by its host. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** Shared services an adapter uses instead of touching the filesystem directly. */
export interface AdapterContext {
  readFile(path: string): string
  log: Logger
}

/** Content-addressing inputs so an extraction result is reproducible. */
export interface ExtractOptions {
  commit?: string
  rulesetVersion?: string
  /** When true, also extract interactive controls (buttons/inputs/etc.) as nested nodes. */
  controls?: boolean
}

/** One declared-but-unresolved case an adapter deliberately over-approximated. */
export interface SoundinessNote {
  kind: string
  file?: string
  loc?: { line: number; col: number }
  detail: string
}

/** The graph plus the honest account of what could not be statically resolved. */
export interface ExtractResult {
  graph: UiGraph
  soundiness: SoundinessNote[]
  /**
   * Optional Tier-2 PROPOSALS the adapter derived statically (e.g. state-driven
   * "screens"/transitions an enum-like state var implies). These NEVER enter the
   * base graph — they are quarantined (`source:'proposal'`) and persisted into the
   * proposals store by `map`. Omitted/empty when an adapter emits none.
   */
  proposals?: Proposal[]
}

/**
 * A framework plugin: turns one framework's source into the shared IR. `extract`
 * is the only required v1 capability and is bound by the golden invariant — it
 * emits only `source: 'static'` edges with deterministic witnesses. `register`
 * and `stamp` are future stubs.
 */
export interface Adapter {
  name: string
  detect(projectDir: string): boolean
  extract(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<ExtractResult>
  register?(...args: unknown[]): never
  stamp?(...args: unknown[]): never
}
