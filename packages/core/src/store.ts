// SQLite-backed workspace store (Node's built-in `node:sqlite`, no native dep).
// One `uigraph.db` per workspace is the canonical database, replacing the JSON
// sidecars. Documents that must round-trip byte-faithfully for content-hashing and
// validation — the base graph, the manual overlay, the soundiness report — are
// stored as JSON in a `docs` table. The high-cardinality, queryable data — Tier-2
// proposals and Tier-3 observations — are stored as relational rows, so filters map
// straight to SQL. The IR, validation and fold logic stay pure and unchanged; only
// persistence moves from files to SQLite.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Overlay, UiGraph } from './ir'
import type { SoundinessNote } from './adapter'
import type { Proposal, Proposals, ProposalGraph } from './proposals'
import type { Observation } from './runtime'
import type { Fingerprint } from './fingerprint'
import { validateGraph } from './validate'
import { validateRefs, type StalenessReport } from './staleness'
import { validateProposals, materializeProposalGraph, type ProposalStatus } from './proposals'
import { reconcileProposals } from './reconcile'
import type { ParkedEdge } from './coverage'
import { hashValue } from './hash'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT, "from" TEXT, "to" TEXT, event TEXT, effect TEXT,
  outcome TEXT, proposal_id TEXT, screenshot TEXT, ts TEXT,
  evidence TEXT, reported_by TEXT, base TEXT
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, kind TEXT, category TEXT, screen TEXT, title TEXT,
  event TEXT, control TEXT, "from" TEXT, "to" TEXT, guard TEXT, effect TEXT,
  rationale TEXT, evidenced INTEGER, confidence REAL, source TEXT, status TEXT, reason TEXT, screenshot TEXT
);
`

/** Optional filters for a proposals query, mirroring the get_proposals tool. */
/** A snapshot of a base graph at a point in time — the previous map, for the temporal diff. */
export interface GraphSnapshot {
  graph: UiGraph
  mappedAt: string
}

export interface ProposalQuery {
  screen?: string
  category?: string
  evidencedOnly?: boolean
  minConfidence?: number
  status?: ProposalStatus
}

const PROPOSAL_COLS = [
  'id', 'kind', 'category', 'screen', 'title', 'event', 'control', 'from', 'to',
  'guard', 'effect', 'rationale', 'evidenced', 'confidence', 'source', 'status', 'reason', 'screenshot',
] as const

/** Map a proposals DB row back into a Proposal, dropping null optionals. */
function rowToProposal(row: Record<string, unknown>): Proposal {
  const p: Record<string, unknown> = {
    id: row['id'],
    kind: row['kind'],
    category: row['category'],
    screen: row['screen'],
    title: row['title'],
    rationale: row['rationale'],
    evidenced: row['evidenced'] === 1,
    confidence: row['confidence'],
    source: row['source'],
    status: row['status'],
  }
  for (const k of ['event', 'control', 'from', 'to', 'guard', 'effect', 'reason', 'screenshot']) {
    if (row[k] !== null && row[k] !== undefined) p[k] = row[k]
  }
  return p as unknown as Proposal
}

/**
 * The SQLite-backed workspace store. Construct via `openStore(dbPath)`; call
 * `close()` when done. All document getters return null when absent so callers can
 * distinguish "empty workspace" from "empty value".
 */
export class Store {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(SCHEMA)
    // Older workspaces predate the proposals.reason column; add it if missing.
    try {
      this.db.exec('ALTER TABLE proposals ADD COLUMN reason TEXT')
    } catch {
      // column already exists
    }
    // Older workspaces predate the observation proof columns; add them if missing.
    for (const col of ['evidence TEXT', 'reported_by TEXT', 'base TEXT']) {
      try {
        this.db.exec(`ALTER TABLE observations ADD COLUMN ${col}`)
      } catch {
        // column already exists
      }
    }
  }

  close(): void {
    this.db.close()
  }

  private getDoc<T>(key: string): T | null {
    const row = this.db.prepare('SELECT json FROM docs WHERE key = ?').get(key) as { json: string } | undefined
    return row ? (JSON.parse(row.json) as T) : null
  }

  private setDoc(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO docs(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json')
      .run(key, JSON.stringify(value))
  }

  /** Persist the extracted base graph (validated) and its soundiness report. */
  setBaseGraph(graph: UiGraph, soundiness: SoundinessNote[] = []): void {
    const errs = validateGraph(graph)
    if (errs.length > 0) throw new Error(`refusing to store invalid graph:\n  ${errs.map((e) => e.message).join('\n  ')}`)
    this.setDoc('graph', graph)
    this.setDoc('soundiness', soundiness)
    this.rebuildProposalGraph()
  }

  getBaseGraph(): UiGraph | null {
    return this.getDoc<UiGraph>('graph')
  }

  getSoundiness(): SoundinessNote[] {
    return this.getDoc<SoundinessNote[]>('soundiness') ?? []
  }

  // Source fingerprint stamped by `map` (the CLI supplies mappedAt — the store stays
  // clock-free); read back by `uigraph status` / get_freshness to detect a stale graph.
  setFingerprint(fp: Fingerprint): void {
    this.setDoc('fingerprint', fp)
  }

  getFingerprint(): Fingerprint | null {
    return this.getDoc<Fingerprint>('fingerprint')
  }

  /**
   * Rotate the current base graph into the 'previous' slot so the next map's delta is
   * computable (temporal diff — "what did this re-map do to the graph?"). MUST be called
   * BEFORE setBaseGraph (which overwrites 'graph') and BEFORE setFingerprint (which
   * overwrites the mappedAt this reads). No-op (returns false, no write) on the first map
   * when there is no current graph yet. Clock-free: the envelope's mappedAt is the prior
   * map's stored fingerprint timestamp ('' when the graph predates fingerprinting, e.g. a
   * migrate import), never a fresh clock read.
   */
  snapshotCurrentAsPrevious(): boolean {
    const current = this.getBaseGraph()
    if (current === null) return false
    this.setDoc('graph_prev', { graph: current, mappedAt: this.getFingerprint()?.mappedAt ?? '' })
    return true
  }

  /** The previous base graph snapshot (the map before the current one), or null when absent. */
  getPreviousGraph(): GraphSnapshot | null {
    return this.getDoc<GraphSnapshot>('graph_prev')
  }

  // Named scenarios = one overlay per name (a feature you draft, toggle, compare).
  // The 'default' scenario is the legacy single 'overlay' doc (back-compat); others
  // live under 'overlay::<name>'. Edits + the merged graph target the ACTIVE scenario.
  private overlayKey(name: string): string {
    return name === 'default' ? 'overlay' : `overlay::${name}`
  }

  /** The active scenario name (defaults to 'default'). */
  getActiveScenario(): string {
    return this.getDoc<string>('active_scenario') ?? 'default'
  }

  /** Switch the active scenario, creating an empty overlay for it if new. */
  setActiveScenario(name: string): void {
    this.setDoc('active_scenario', name)
    if (this.getDoc<Overlay>(this.overlayKey(name)) === null) {
      const base = this.getBaseGraph()
      this.setDoc(this.overlayKey(name), { version: 0, base: base ? hashValue(base) : '', addedNodes: [], addedEdges: [], editedEdges: [], editedNodes: [], removedRefs: [] })
    }
  }

  /** All scenario names ('default' first, then any named overlays). */
  listScenarios(): string[] {
    const rows = this.db.prepare("SELECT key FROM docs WHERE key LIKE 'overlay::%'").all() as { key: string }[]
    return ['default', ...rows.map((r) => r.key.slice('overlay::'.length))]
  }

  /** The overlay for a scenario (the active one by default), or null when absent. */
  getOverlay(name = this.getActiveScenario()): Overlay | null {
    return this.getDoc<Overlay>(this.overlayKey(name))
  }

  /** Persist the overlay for a scenario (the active one by default). */
  setOverlay(overlay: Overlay, name = this.getActiveScenario()): void {
    this.setDoc(this.overlayKey(name), overlay)
  }

  /** Append one runtime observation; returns the stored entry. */
  appendObservation(o: Observation): Observation {
    this.db
      .prepare('INSERT INTO observations(id, "from", "to", event, effect, outcome, proposal_id, screenshot, ts, evidence, reported_by, base) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        o.id, o.from, o.to, o.event, o.effect ?? null, o.outcome, o.proposalId ?? null, o.screenshot ?? null, o.ts ?? null,
        o.evidence !== undefined ? JSON.stringify(o.evidence) : null, o.reportedBy ?? null, o.base ?? null,
      )
    return o
  }

  getObservations(): Observation[] {
    const rows = this.db.prepare('SELECT * FROM observations ORDER BY seq').all() as Record<string, unknown>[]
    return rows.map((r) => {
      const o: Record<string, unknown> = { id: r['id'], from: r['from'], to: r['to'], event: r['event'], outcome: r['outcome'] }
      if (r['effect'] !== null) o['effect'] = r['effect']
      if (r['proposal_id'] !== null) o['proposalId'] = r['proposal_id']
      if (r['screenshot'] !== null) o['screenshot'] = r['screenshot']
      if (r['ts'] !== null) o['ts'] = r['ts']
      if (r['evidence'] !== null && r['evidence'] !== undefined) o['evidence'] = JSON.parse(r['evidence'] as string)
      if (r['reported_by'] !== null && r['reported_by'] !== undefined) o['reportedBy'] = r['reported_by']
      if (r['base'] !== null && r['base'] !== undefined) o['base'] = r['base']
      return o as unknown as Observation
    })
  }

  /** Replace the whole proposals sidecar (validated) in one transaction. */
  setProposals(sidecar: Proposals): void {
    const errs = validateProposals(sidecar)
    if (errs.length > 0) throw new Error(`refusing to store invalid proposals:\n  ${errs.map((e) => e.message).join('\n  ')}`)
    const insert = this.db.prepare(
      `INSERT INTO proposals(${PROPOSAL_COLS.map((c) => `"${c}"`).join(',')}) VALUES(${PROPOSAL_COLS.map(() => '?').join(',')})`,
    )
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM proposals')
      for (const p of sidecar.proposals) {
        const r = p as unknown as Record<string, unknown>
        insert.run(
          ...PROPOSAL_COLS.map((c) => {
            if (c === 'evidenced') return p.evidenced ? 1 : 0
            const v = r[c]
            return v === undefined ? null : (v as string | number | null)
          }),
        )
      }
      this.db.prepare('INSERT INTO proposals_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('base', sidecar.base)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    this.rebuildProposalGraph()
  }

  /**
   * Recompute and store the proposal graph (proposals projected to nodes + edges,
   * quarantined from the proven IR) from the current base graph + proposals. Called
   * whenever either changes. No-op until a base graph exists.
   */
  rebuildProposalGraph(): void {
    const graph = this.getBaseGraph()
    if (graph === null) return
    this.setDoc('proposed', materializeProposalGraph(graph, this.queryProposals()))
  }

  /** The stored proposal graph (proposals as nodes + edges), or empty when none. */
  getProposalGraph(): ProposalGraph {
    return this.getDoc<ProposalGraph>('proposed') ?? { nodes: [], edges: [] }
  }

  /** The full proposals sidecar, or null when none has been stored. */
  getProposals(): Proposals | null {
    const meta = this.db.prepare('SELECT value FROM proposals_meta WHERE key = ?').get('base') as { value: string } | undefined
    if (meta === undefined) return null
    return { version: 0, base: meta.value, proposals: this.queryProposals() }
  }

  /**
   * Set one proposal's lifecycle status (and optional reason), then rebuild the
   * active proposal graph so a resolved proposal leaves the worklist. Returns
   * whether a row changed. Touches only the proposals table — never the proven graph.
   */
  setProposalStatus(id: string, status: ProposalStatus, reason?: string): boolean {
    const res = this.db.prepare('UPDATE proposals SET status = ?, reason = ? WHERE id = ?').run(status, reason ?? null, id)
    const changed = Number(res.changes) > 0
    if (changed) this.rebuildProposalGraph()
    return changed
  }

  /**
   * Derive proposal statuses from the observation log (confirmed→archived,
   * refuted→withdrawn) and persist any that changed in one transaction, then
   * rebuild the proposal graph. Pure-fold-backed + idempotent: a second call with
   * no new observations changes nothing. Returns the proposals whose status changed.
   */
  reconcileFromObservations(): { id: string; status: ProposalStatus }[] {
    const current = this.queryProposals()
    const reconciled = reconcileProposals(current, this.getObservations())
    const byId = new Map(current.map((p) => [p.id, p.status]))
    const changed = reconciled.filter((p) => byId.get(p.id) !== p.status)
    if (changed.length === 0) return []
    const update = this.db.prepare('UPDATE proposals SET status = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      for (const p of changed) update.run(p.status, p.id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    this.rebuildProposalGraph()
    return changed.map((p) => ({ id: p.id, status: p.status }))
  }

  /**
   * Park a may/unknown edge out of the verify worklist with an auditable reason
   * (upsert, deduped by edge id). Pure sidecar metadata in the docs table — never
   * edits the edge, its modality, witness, or source, so the proven graph is
   * untouched. A reason is mandatory.
   */
  parkEdge(edgeId: string, reason: string, by: 'agent' | 'runner' = 'agent'): ParkedEdge {
    if (reason.trim().length === 0) throw new Error('parkEdge requires a non-empty reason')
    const entry: ParkedEdge = { edgeId, reason, by, ts: new Date().toISOString() }
    const next = this.getParkedEdges().filter((p) => p.edgeId !== edgeId)
    next.push(entry)
    this.setDoc('parked_edges', next)
    return entry
  }

  /**
   * Batch-park many edges in a SINGLE doc write (upsert, deduped by edge id) — the
   * pattern-dedup path parks thousands of duplicate fan-out edges at once, so looping
   * parkEdge (each a full read+rewrite of the sidecar) would be O(n²). Every reason
   * must be non-empty. Returns how many distinct edges were parked.
   */
  parkEdges(entries: readonly { edgeId: string; reason: string }[], by: 'agent' | 'runner' = 'agent'): number {
    if (entries.length === 0) return 0
    for (const e of entries) if (e.reason.trim().length === 0) throw new Error('parkEdges requires a non-empty reason')
    const ts = new Date().toISOString()
    const incoming = new Map<string, ParkedEdge>()
    for (const e of entries) incoming.set(e.edgeId, { edgeId: e.edgeId, reason: e.reason, by, ts })
    const merged = this.getParkedEdges().filter((p) => !incoming.has(p.edgeId))
    for (const v of incoming.values()) merged.push(v)
    this.setDoc('parked_edges', merged)
    return incoming.size
  }

  /** Un-park an edge (return it to the worklist); returns whether one was removed. */
  unparkEdge(edgeId: string): boolean {
    const current = this.getParkedEdges()
    const next = current.filter((p) => p.edgeId !== edgeId)
    if (next.length === current.length) return false
    this.setDoc('parked_edges', next)
    return true
  }

  /** The parked-edge sidecar (empty when none). */
  getParkedEdges(): ParkedEdge[] {
    return this.getDoc<ParkedEdge[]>('parked_edges') ?? []
  }

  /**
   * Report staleness/dangling refs of the current sidecars (active overlay,
   * proposals, observations) against the current base, so serve/coverage can
   * surface what would be dropped instead of silently trusting it. Returns an
   * `ok: true` empty report when there is no base graph yet (nothing to be stale
   * against). Pure read — touches no rows.
   */
  stalenessReport(): StalenessReport {
    const base = this.getBaseGraph()
    if (base === null) {
      return { ok: true, baseHash: '', issues: [], droppedObservationIds: [], overlayStaleHash: false, proposalsStaleHash: false }
    }
    return validateRefs({
      base,
      overlay: this.getOverlay(),
      proposals: this.getProposals(),
      observations: this.getObservations(),
    })
  }

  /** Query proposals with optional filters; returns matching rows as Proposals. */
  queryProposals(filter: ProposalQuery = {}): Proposal[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.screen !== undefined) { where.push('screen = ?'); params.push(filter.screen) }
    if (filter.category !== undefined) { where.push('category = ?'); params.push(filter.category) }
    if (filter.evidencedOnly === true) where.push('evidenced = 1')
    if (filter.minConfidence !== undefined) { where.push('confidence >= ?'); params.push(filter.minConfidence) }
    if (filter.status !== undefined) { where.push('status = ?'); params.push(filter.status) }
    const sql = `SELECT * FROM proposals${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY rowid`
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(rowToProposal)
  }
}

/** Open (creating if needed) the SQLite store for a workspace database file. */
export function openStore(dbPath: string): Store {
  return new Store(dbPath)
}
