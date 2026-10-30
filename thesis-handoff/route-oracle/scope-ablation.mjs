#!/usr/bin/env node
// The attribution ablation: what each mechanism of Section 3 contributes, on the same corpus.
//
// The baseline table (scope-baseline.mts) compares the computed attribution with the widest
// attribution there is. That says how much narrower the analysis is than doing nothing, but
// not whether its extra mechanisms earn their place against a simpler analysis. This harness
// answers that by extracting every application four times, withholding one mechanism at a
// time, and reporting what each level recovers and how wide its scopes are:
//
//   owned    the routed component's own file only -- direct ownership.
//   nesting  plus component containment, which is the mechanism of Oshima and Kishi (2018).
//   outlet   plus router-outlet descent.
//   full     plus the shell rule and the injected-service join: the proposed analysis.
//
// The levels are nested by construction (attribute.ts withholds results rather than computing
// them differently), and that is checked here on the real graphs rather than assumed: a level
// whose (site, screen) set is not a subset of the next one's is a defect in the switch, and
// this harness refuses to emit a table in that case.
//
// Usage: pnpm exec tsx scope-ablation.mjs --corpus <dir> --out <dir> [--tex <file>] [--apps a,b,c]
//        [--keep <slug>]  which application's per-level databases to keep (default realworld)
import { DatabaseSync } from 'node:sqlite'
import { scopeMembers } from '@ui-graph/core'
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const LEVELS = ['owned', 'nesting', 'rooted', 'outlet', 'full']
const EXTRACTOR = path.resolve(path.join(import.meta.dirname, '..', '..'))
const CLI = `pnpm -s --dir ${EXTRACTOR} exec tsx ${path.join(EXTRACTOR, 'packages', 'cli', 'src', 'cli.ts')}`

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const corpus = flag('--corpus')
const outDir = flag('--out')
if (!corpus || !outDir) {
  console.error('usage: pnpm exec tsx scope-ablation.mjs --corpus <dir> --out <dir> [--tex <file>] [--apps a,b,c]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

// Where each application's database lives under the corpus. The same layout the other
// harnesses use; a workspace application keeps its database beside the project it maps.
const APPS = {
  realworld: '.',
  alfresco: 'projects/aca-content',
  ghostfolio: 'apps/client',
  k8sdash: 'modules/web',
  bitwarden: 'apps/web',
  mifos: '.',
}
const only = flag('--apps') ? flag('--apps').split(',') : Object.keys(APPS)
/** The one application whose per-level databases are kept, for scoring against a ground truth. */
const keep = flag('--keep', 'realworld')

/** The (site, screen) pairs a graph asserts: one per source construct, per screen it fires from. */
function pairsOf(dbPath) {
  const db = new DatabaseSync(dbPath)
  const g = JSON.parse(db.prepare("select json from docs where key='graph'").get().json)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const screens = new Set(g.nodes
    .filter((n) => n.kind === 'screen' && typeof n.route === 'string' && n.route.startsWith('/'))
    .map((n) => n.id))
  // A scope anchor stands for the screens in its subtree, so an edge held there is an
  // assertion about each of them. Expanded with the model's own membership function rather
  // than a rule written again here, which would be a second implementation to get wrong.
  const pairs = new Set()
  const sites = new Set()
  for (const e of g.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const srcs = (from.kind === 'scope' ? scopeMembers(g, from) : [e.from]).filter((s) => screens.has(s))
    if (!srcs.length) continue
    for (const w of [e.witness, ...(e.mergedWitnesses || [])]) {
      if (!w || w.source !== 'static' || !w.file) continue
      const site = `${w.file}:${w.loc?.line ?? '?'}`
      sites.add(site)
      for (const s of srcs) pairs.add(`${site}\u0000${s}`)
    }
  }
  return { pairs, sites, screens: screens.size, edges: g.edges.length, nodes: g.nodes.length }
}

const rows = []
for (const slug of only) {
  if (!APPS[slug]) { console.error(`  ${slug}: not a corpus application, skipped`); continue }
  const appPath = path.join(corpus, slug, APPS[slug])
  const db = path.join(appPath, 'uigraph.db')
  if (!existsSync(db)) { console.error(`  ${slug}: no uigraph.db at ${db}, skipped`); continue }

  // The published figures are measured on this database, so it is restored byte for byte
  // before this harness returns, and the restore is verified by hash.
  const backup = path.join(outDir, `${slug}.full.uigraph.db`)
  copyFileSync(db, backup)
  const before = createHash('sha256').update(readFileSync(db)).digest('hex')

  const measured = {}
  try {
    for (const level of LEVELS) {
      if (level === 'full') {
        // Not re-extracted: the level that produced the published graph is the graph on disk.
        measured.full = pairsOf(backup)
        continue
      }
      execSync(`${CLI} map ${appPath} --adapter angular --attribution`, {
        stdio: 'pipe', env: { ...process.env, UIGRAPH_SCOPE_LAYERS: level },
      })
      const snap = path.join(outDir, `${slug}.${level}.uigraph.db`)
      copyFileSync(db, snap)
      measured[level] = pairsOf(snap)
      // Only the application scored against a ground truth needs its databases afterwards.
      // Keeping one per level for every application is several gigabytes of derived data
      // whose only published form is the counts below.
      if (keep !== slug) rmSync(snap, { force: true })
    }
  } finally {
    copyFileSync(backup, db)
    if (keep !== slug) rmSync(backup, { force: true })
    const after = createHash('sha256').update(readFileSync(db)).digest('hex')
    if (after !== before) throw new Error(`${slug}: the corpus database was not restored (${before.slice(0, 12)} -> ${after.slice(0, 12)})`)
  }

  // Nested by construction; checked, because a switch that is not nested makes every
  // comparison below meaningless and the defect would otherwise be invisible.
  for (let i = 1; i < LEVELS.length; i += 1) {
    const lo = measured[LEVELS[i - 1]].pairs, hi = measured[LEVELS[i]].pairs
    const escaped = [...lo].filter((p) => !hi.has(p))
    if (escaped.length) {
      throw new Error(`${slug}: ${escaped.length} (site, screen) pairs are in ${LEVELS[i - 1]} but not in ${LEVELS[i]}, ` +
        `so the levels are not nested; first: ${escaped[0].replace('\u0000', ' @ ')}`)
    }
  }

  const row = { slug, screens: measured.full.screens, levels: {} }
  for (const l of LEVELS) {
    const m = measured[l]
    row.levels[l] = { pairs: m.pairs.size, sites: m.sites.size, edges: m.edges, nodes: m.nodes,
      mean: m.sites.size ? m.pairs.size / m.sites.size : 0 }
  }
  rows.push(row)
  console.error(`  ${slug.padEnd(11)} screens=${String(row.screens).padStart(3)} ` +
    LEVELS.map((l) => `${l}=${row.levels[l].pairs}/${row.levels[l].sites}`).join(' '))
}

writeFileSync(path.join(outDir, 'ablation.json'), JSON.stringify({ levels: LEVELS, rows }, null, 2))

const tex = flag('--tex')
if (tex) {
  if (!rows.length) throw new Error('no application was measured, so the ablation table would be empty')
  const sum = (l, k) => rows.reduce((a, r) => a + r.levels[l][k], 0)
  let out = '% Generated by scope-ablation.mjs. Do not edit by hand.\n'
  out += '\\newcommand{\\TabAblation}{%\n\\begin{tabular}{@{}lr' + 'rr'.repeat(LEVELS.length) + '@{}}\n\\toprule\n'
  out += 'Application & Screens & ' + LEVELS.map((l) => `\\shortstack[r]{${l}\\\\sites} & \\shortstack[r]{${l}\\\\pairs}`).join(' & ') + ' \\\\\n\\midrule\n'
  for (const r of rows) {
    out += `${r.slug} & ${r.screens} & ` + LEVELS.map((l) => `${r.levels[l].sites} & ${r.levels[l].pairs}`).join(' & ') + ' \\\\\n'
  }
  out += '\\midrule\nAll & ' + rows.reduce((a, r) => a + r.screens, 0) + ' & '
  out += LEVELS.map((l) => `${sum(l, 'sites')} & ${sum(l, 'pairs')}`).join(' & ') + ' \\\\\n'
  out += '\\bottomrule\n\\end{tabular}}\n'
  out += `\\newcommand{\\AblationApps}{${rows.length}}\n`
  for (const l of LEVELS) {
    const S = sum(l, 'sites'), P = sum(l, 'pairs')
    const cap = l[0].toUpperCase() + l.slice(1)
    out += `\\newcommand{\\Ablation${cap}Sites}{${S}}\n`
    out += `\\newcommand{\\Ablation${cap}Pairs}{${P}}\n`
    out += `\\newcommand{\\Ablation${cap}Mean}{${S ? (P / S).toFixed(1) : 'n/a'}}\n`
    out += `\\newcommand{\\Ablation${cap}SiteShare}{${sum('full', 'sites') ? ((S / sum('full', 'sites')) * 100).toFixed(1) : '0'}\\,\\%}\n`
  }
  writeFileSync(tex, out)
  console.error(`wrote ${tex}`)
}
