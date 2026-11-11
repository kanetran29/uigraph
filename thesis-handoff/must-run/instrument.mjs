/**
 * Marks each preregistered must construct in a temporary copy of an application: on the cited
 * template line it inserts data-must-site="<file:line>" before the first routerLink binding, so
 * the driver can click exactly that element. Refuses a line with no routerLink, and never runs
 * on the corpus checkouts themselves.
 *
 * Usage: node instrument.mjs --app <slug> --dir <temporary app copy>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
if (resolve(a.dir).startsWith(join(homedir(), 'personal/uigraph-corpus'))) throw new Error('refusing to patch a corpus checkout')
const sites = JSON.parse(readFileSync(new URL('./sites.json', import.meta.url), 'utf8')).filter((s) => s.app === a.app)
for (const s of sites) {
  const [file, line] = s.site.split(':')
  const path = join(a.dir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const i = Number(line) - 1
  if (lines[i].includes('data-must-site=')) continue
  const m = lines[i].match(/\[?routerLink\]?=/)
  if (!m) throw new Error(`no routerLink on ${s.site}`)
  lines[i] = lines[i].slice(0, m.index) + `data-must-site="${s.site}" ` + lines[i].slice(m.index)
  writeFileSync(path, lines.join('\n'))
}
console.log(`${a.app}: marked ${sites.length} constructs`)
