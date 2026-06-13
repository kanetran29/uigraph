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
import type { Proposal, Proposals } from './proposals'
import type { Observation } from './runtime'
import { validateGraph } from './validate'
import { validateProposals } from './proposals'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT, "from" TEXT, "to" TEXT, event TEXT, effect TEXT,
  outcome TEXT, proposal_id TEXT, screenshot TEXT, ts TEXT
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, kind TEXT, category TEXT, screen TEXT, title TEXT,
  event TEXT, control TEXT, "from" TEXT, "to" TEXT, guard TEXT, effect TEXT,
  rationale TEXT, evidenced INTEGER, confidence REAL, source TEXT, status TEXT, screenshot TEXT
);
`

/** Optional filters for a proposals query, mirroring the get_proposals tool. */
export interface ProposalQuery {
  screen?: string
  category?: string
  evidencedOnly?: boolean
  minConfidence?: number
}

const PROPOSAL_COLS = [
  'id', 'kind', 'category', 'screen', 'title', 'event', 'control', 'from', 'to',
  'guard', 'effect', 'rationale', 'evidenced', 'confidence', 'source', 'status', 'screenshot',
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
  for (const k of ['event', 'control', 'from', 'to', 'guard', 'effect', 'screenshot']) {
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
  }

  getBaseGraph(): UiGraph | null {
    return this.getDoc<UiGraph>('graph')
  }

  getSoundiness(): SoundinessNote[] {
    return this.getDoc<SoundinessNote[]>('soundiness') ?? []
  }

  getOverlay(): Overlay | null {
    return this.getDoc<Overlay>('overlay')
  }

  setOverlay(overlay: Overlay): void {
    this.setDoc('overlay', overlay)
  }

  /** Append one runtime observation; returns the stored entry. */
  appendObservation(o: Observation): Observation {
    this.db
      .prepare('INSERT INTO observations(id, "from", "to", event, effect, outcome, proposal_id, screenshot, ts) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(o.id, o.from, o.to, o.event, o.effect ?? null, o.outcome, o.proposalId ?? null, o.screenshot ?? null, o.ts ?? null)
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
  }

  /** The full proposals sidecar, or null when none has been stored. */
  getProposals(): Proposals | null {
    const meta = this.db.prepare('SELECT value FROM proposals_meta WHERE key = ?').get('base') as { value: string } | undefined
    if (meta === undefined) return null
    return { version: 0, base: meta.value, proposals: this.queryProposals() }
  }

  /** Query proposals with optional filters; returns matching rows as Proposals. */
  queryProposals(filter: ProposalQuery = {}): Proposal[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.screen !== undefined) { where.push('screen = ?'); params.push(filter.screen) }
    if (filter.category !== undefined) { where.push('category = ?'); params.push(filter.category) }
    if (filter.evidencedOnly === true) where.push('evidenced = 1')
    if (filter.minConfidence !== undefined) { where.push('confidence >= ?'); params.push(filter.minConfidence) }
    const sql = `SELECT * FROM proposals${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY rowid`
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(rowToProposal)
  }
}

/** Open (creating if needed) the SQLite store for a workspace database file. */
export function openStore(dbPath: string): Store {
  return new Store(dbPath)
}
