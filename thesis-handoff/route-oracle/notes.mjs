#!/usr/bin/env node
// Dumps the extractor's own soundiness notes for one application, as JSON on stdout.
//
// These are what the extractor says it could not resolve; the thesis counts dead links and
// route-set completeness from them, so every note kind is emitted and the filtering is left
// to the consumer.
//
// The notes are read out of the db the map run wrote, not re-extracted. An earlier version
// imported the adapter and ran it again, which needed tsx for the extensionless imports and,
// worse, meant the notes and the edges could come from two different builds of the
// extractor with nothing on disk recording that they had.
//
//   usage: node notes.mjs <uigraph.db> [--json out.json]

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: node notes.mjs <uigraph.db> [--json out.json]')
  process.exit(2)
}
const jIdx = process.argv.indexOf('--json')
const jsonOut = jIdx > -1 ? process.argv[jIdx + 1] : null

const db = new DatabaseSync(path.resolve(dbPath))
const raw = db.prepare("select json from docs where key='soundiness'").get()?.json
const parsed = raw ? JSON.parse(raw) : []
const notes = parsed.notes ?? parsed

console.log(`notes: ${notes.length}`)
const byKind = {}
for (const n of notes) byKind[n.kind] = (byKind[n.kind] || 0) + 1
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(notes, null, 1))
