/**
 * Checks every site a source reading cites for a real pair: the file exists in the subject's checkout
 * and a navigation construct (routerLink, href, navigate, a submit or click binding, a redirect, a
 * dispatch or an emit) stands within two lines of the cited line. Exits 1 and lists the failures.
 *
 * Usage: node check-sites.mjs --verdicts adjudication.json --src <work dir>/src --subjects subjects.txt
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const dirs = {}
for (const l of readFileSync(a.subjects, 'utf8').split('\n')) {
  if (!l.trim() || l.startsWith('#')) continue
  const [slug, repo, , sub] = l.split(/\s+/)
  dirs[slug] = join(a.src, repo.replace('/', '__'), sub)
}
const nav = /routerLink|navigate|href|ngSubmit|\(click\)|\(submit\)|redirectTo|dispatch|emit|location/i
const bad = []
let checked = 0
for (const x of JSON.parse(readFileSync(a.verdicts, 'utf8'))) {
  if (x.verdict !== 'real') continue
  checked++
  const m = /^(.+?):(\d+)/.exec(x.site ?? '')
  const file = m && join(dirs[x.slug], m[1])
  if (!m || !existsSync(file)) { bad.push(`${x.slug} ${x.from} -> ${x.to}: no file at ${x.site}`); continue }
  const n = Number(m[2])
  const lines = readFileSync(file, 'utf8').split('\n').slice(Math.max(0, n - 3), n + 2).join('\n')
  if (!nav.test(lines)) bad.push(`${x.slug} ${x.from} -> ${x.to}: no navigation near ${x.site}`)
}
console.log(`checked ${checked} cited sites, ${bad.length} failed`)
for (const b of bad) console.log('  ' + b)
process.exit(bad.length ? 1 : 0)
