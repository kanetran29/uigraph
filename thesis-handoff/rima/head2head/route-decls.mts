/**
 * Writes, for each application of apps.txt, this extractor's declared screens keyed by where each
 * route object is written ("absolute file:start line" -> full path), so a route another tool names by
 * its declaration can be identified with ours whatever path text it records.
 * Usage: tsx route-decls.mts <work dir> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildProject, collectRoutes } from '../../../packages/adapter-angular/src/index.ts'

const [work, out] = process.argv.slice(2)
const here = new URL('.', import.meta.url).pathname
const res: Record<string, Record<string, string>> = {}
for (const line of readFileSync(join(here, 'apps.txt'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [slug, dir] = line.split(/\s+/)
  const routes = collectRoutes(buildProject(join(work!, dir!)))
  const m: Record<string, string> = {}
  for (const r of routes) {
    const o = r.routeObj
    m[`${o.getSourceFile().getFilePath()}:${o.getStartLineNumber()}`] = r.fullPath
  }
  res[slug!] = m
  console.log(slug, Object.keys(m).length)
}
writeFileSync(out!, JSON.stringify(res, null, 1) + '\n')
