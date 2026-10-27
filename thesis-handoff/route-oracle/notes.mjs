#!/usr/bin/env node
//
// Dumps the extractor's own soundiness notes for one application, as JSON on stdout.
// These are what the extractor says it could not resolve; the thesis counts dead links
// and route-set completeness from them, so every note kind is emitted and the filtering
// is left to the consumer.
//   usage: node notes.mjs <app-dir> > <slug>.fin.notes.json
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { buildProject, extractGraph } = await import(path.join(here, '../../packages/adapter-angular/src/extract.ts'))

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node notes.mjs <app-dir>')
  process.exit(2)
}
const r = extractGraph(buildProject(dir), dir, { notes: true, attribution: true })
console.log(JSON.stringify(r.soundiness ?? [], null, 1))
