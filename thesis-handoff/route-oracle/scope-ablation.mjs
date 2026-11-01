#!/usr/bin/env node
// The attribution ablation: what each mechanism of Section 3 contributes, on the same corpus.
//
// The width table compares the computed attribution with the widest attribution there is. That
// says how much narrower the analysis is than doing nothing, but not whether its extra
// mechanisms earn their place against a simpler analysis. This harness answers that by
// extracting every application once per level, each level withholding every mechanism above
// it, and reporting what each one recovers and how wide its scopes are. The width table is
// read from the `full` rows of the same measurement (a script of its own once measured it from
// whatever graph was last on disk, and went stale when the extractor changed), so the two
// tables cannot disagree about the computed attribution:
//
//   owned    the routed component's own file only -- direct ownership.
//   nesting  plus component containment.
//   rooted   plus the shell rule: what Oshima and Kishi (2018) reach, since they assemble
//            page information from the root component as well as the components beneath it.
//   outlet   plus router-outlet descent.
//   full     plus the injected-service join: the proposed analysis.
//
// `full` is not re-extracted: the level that produced the published graph is the graph on
// disk, so the corpus is extracted LEVELS.length - 1 times per application.
//
// `class` is measured beside the chain: `full` with the per-class service join of the earlier
// version in place of the call graph. `full` minus `outlet` is therefore what the service join,
// the call graph and the guard and effect stand-ins earn together, and only `full` minus `class`
// is the call graph's own contribution, which is emitted as \AblationCallGraph* in sites, in
// pairs, and as the site sets that differ in each direction.
//
// The levels are nested by construction (attribute.ts withholds results rather than computing
// them differently), and that is checked here on the real graphs rather than assumed: a level
// whose (site, screen) set is not a subset of the next one's is a defect in the switch, and
// this harness refuses to emit a table in that case.
//
// Usage: pnpm exec tsx scope-ablation.mjs --corpus <dir> --out <dir> [--tex <file>] [--apps a,b,c]
//        [--keep <slug>]  which application's per-level databases to keep (default realworld)
//        [--from <ablation.json>]  write --tex from counts an earlier run recorded, extracting nothing
import { DatabaseSync } from 'node:sqlite'
import { scopeMembers } from '@ui-graph/core'
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { extractorStamp } from './provenance.mjs'

const LEVELS = ['owned', 'nesting', 'rooted', 'outlet', 'full']
// Measured beside the chain, not in it: `full` with the per-class join of the earlier version in
// place of the call graph, so what the call graph changes can be counted pair by pair.
const BESIDE = ['class']
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

/**
 * The width table and its inline macros, from the `full` rows: how many (site, screen) pairs the
 * computed attribution asserts against the pairs of the widest attribution there is, which
 * assigns every site to every screen. The ratio is the factor by which the analysis is narrower;
 * near one it discriminates little. Refuses an application with no site or no screen, for which
 * no ratio exists, and one that attributes more pairs than the widest attribution, which a set
 * of pairs cannot.
 */
function baselineTex(rows) {
  const b = rows.map((r) => ({ slug: r.slug, screens: r.screens, sites: r.levels.full.sites, attributed: r.levels.full.pairs,
    trivial: r.levels.full.sites * r.screens }))
  const empty = b.filter((r) => !r.sites || !r.screens)
  if (empty.length) throw new Error(`${empty.map((r) => r.slug).join(', ')} yielded no site or no screen, so no ratio can be formed for them`)
  const broken = b.filter((r) => r.attributed > r.trivial)
  if (broken.length) throw new Error(`${broken.map((r) => r.slug).join(', ')} attributed more (site, screen) pairs than the all-screens baseline, which is impossible`)
  const fac = (r) => r.trivial / r.attributed
  const sharpest = b.reduce((a, r) => (fac(r) > fac(a) ? r : a))
  const bluntest = b.reduce((a, r) => (fac(r) < fac(a) ? r : a))
  let out = '\\newcommand{\\TabScopeBaseline}{%\n\\begin{tabular}{@{}lrrrrr@{}}\n\\toprule\n'
  out += 'Application & Screens & Sites & \\shortstack[r]{Attributed\\\\pairs} & '
  out += '\\shortstack[r]{Mean\\\\scope} & \\shortstack[r]{All-screens\\\\pairs} \\\\\n\\midrule\n'
  for (const r of b) out += `${r.slug} & ${r.screens} & ${r.sites} & ${r.attributed} & ${(r.attributed / r.sites).toFixed(2)} & ${r.trivial} \\\\\n`
  out += '\\bottomrule\n\\end{tabular}}\n'
  const mean = (r) => r.attributed / r.sites
  out += `\\newcommand{\\BaselineApps}{${b.length}}\n`
  out += `\\newcommand{\\BaselineFactorMin}{${fac(bluntest).toFixed(1)}}\n`
  out += `\\newcommand{\\BaselineFactorMax}{${fac(sharpest).toFixed(1)}}\n`
  out += `\\newcommand{\\BaselineBluntest}{${bluntest.slug}}\n`
  out += `\\newcommand{\\BaselineBluntestScope}{${mean(bluntest).toFixed(1)}}\n`
  out += `\\newcommand{\\BaselineBluntestScreens}{${bluntest.screens}}\n`
  out += `\\newcommand{\\BaselineBluntestShare}{${((mean(bluntest) / bluntest.screens) * 100).toFixed(0)}\\,\\%}\n`
  out += `\\newcommand{\\BaselineSharpest}{${sharpest.slug}}\n`
  out += `\\newcommand{\\BaselineSharpestAttributed}{${sharpest.attributed}}\n`
  out += `\\newcommand{\\BaselineSharpestTrivial}{${sharpest.trivial}}\n`
  out += `\\newcommand{\\BaselineMeanScopeMin}{${Math.min(...b.map(mean)).toFixed(1)}}\n`
  out += `\\newcommand{\\BaselineMeanScopeMax}{${Math.max(...b.map(mean)).toFixed(1)}}\n`
  return out
}

const rows = []
// Re-emitting the table from counts already measured, so the wording or the layout can be
// changed without extracting the corpus twenty-four times again.
const from = flag('--from')
if (from) rows.push(...JSON.parse(readFileSync(from, 'utf8')).rows)
for (const slug of from ? [] : only) {
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
    for (const level of [...LEVELS, ...BESIDE]) {
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

  const row = { slug, screens: measured.full.screens, levels: {},
    // Pairs only one of the two service treatments asserts: what the call graph drops from the
    // per-class join, and what it reaches that the join never did (a service another calls).
    classOnly: [...measured.class.pairs].filter((x) => !measured.full.pairs.has(x)).length,
    fullOnly: [...measured.full.pairs].filter((x) => !measured.class.pairs.has(x)).length,
    // The same two differences on the sites themselves, which is what coverage counts.
    classOnlySites: [...measured.class.sites].filter((x) => !measured.full.sites.has(x)).length,
    fullOnlySites: [...measured.full.sites].filter((x) => !measured.class.sites.has(x)).length }
  for (const l of [...LEVELS, ...BESIDE]) {
    const m = measured[l]
    row.levels[l] = { pairs: m.pairs.size, sites: m.sites.size, edges: m.edges, nodes: m.nodes,
      mean: m.sites.size ? m.pairs.size / m.sites.size : 0 }
  }
  rows.push(row)
  console.error(`  ${slug.padEnd(11)} screens=${String(row.screens).padStart(3)} ` +
    LEVELS.map((l) => `${l}=${row.levels[l].pairs}/${row.levels[l].sites}`).join(' '))
}

writeFileSync(path.join(outDir, 'ablation.json'), JSON.stringify({ levels: LEVELS, beside: BESIDE, rows }, null, 2))

const tex = flag('--tex')
if (tex) {
  if (!rows.length) throw new Error('no application was measured, so the ablation table would be empty')
  const sum = (l, k) => rows.reduce((a, r) => a + r.levels[l][k], 0)
  let out = '% Generated by scope-ablation.mjs. Do not edit by hand.\n' + extractorStamp() + '\n'
  // One column per level, holding sites and pairs together: a column pair per level is
  // twelve columns and does not fit the text width.
  out += '\\newcommand{\\TabAblation}{%\n\\begin{tabular}{@{}lr' + 'r'.repeat(LEVELS.length) + '@{}}\n\\toprule\n'
  out += ' & & \\multicolumn{' + LEVELS.length + '}{c@{}}{sites / (site, screen) pairs} \\\\\n'
  out += `\\cmidrule(l){3-${LEVELS.length + 2}}\n`
  out += 'Application & Screens & ' + LEVELS.join(' & ') + ' \\\\\n\\midrule\n'
  for (const r of rows) {
    out += `${r.slug} & ${r.screens} & ` + LEVELS.map((l) => `${r.levels[l].sites}\\,/\\,${r.levels[l].pairs}`).join(' & ') + ' \\\\\n'
  }
  out += '\\midrule\nAll & ' + rows.reduce((a, r) => a + r.screens, 0) + ' & '
  out += LEVELS.map((l) => `${sum(l, 'sites')}\\,/\\,${sum(l, 'pairs')}`).join(' & ') + ' \\\\\n'
  out += '\\bottomrule\n\\end{tabular}}\n'
  out += `\\newcommand{\\AblationApps}{${rows.length}}\n`
  out += `\\newcommand{\\AblationLevels}{${LEVELS.length}}\n`
  // What a level ADDS over the one below it. The share of the full count that a level
  // reaches is a different quantity, and for `full` it is trivially 100 per cent, so a
  // sentence about what the last mechanisms contribute needs this one. The count of
  // applications where a level adds no site is emitted too, because a sentence saying a
  // mechanism widens scopes without placing a new site has to say on how many it holds.
  for (let i = 1; i < LEVELS.length; i += 1) {
    const cap = LEVELS[i][0].toUpperCase() + LEVELS[i].slice(1)
    const added = sum(LEVELS[i], 'sites') - sum(LEVELS[i - 1], 'sites')
    const same = rows.filter((r) => r.levels[LEVELS[i]].sites === r.levels[LEVELS[i - 1]].sites).length
    out += `\\newcommand{\\Ablation${cap}AddedSites}{${added}}\n`
    out += `\\newcommand{\\Ablation${cap}AddedShare}{${((added / sum('full', 'sites')) * 100).toFixed(1)}\\,\\%}\n`
    out += `\\newcommand{\\Ablation${cap}SameSitesApps}{${same}}\n`
  }
  out += `\\newcommand{\\AblationClassOnlyPairs}{${rows.reduce((a, r) => a + r.classOnly, 0)}}\n`
  out += `\\newcommand{\\AblationFullOnlyPairs}{${rows.reduce((a, r) => a + r.fullOnly, 0)}}\n`
  out += `\\newcommand{\\AblationClassChangedApps}{${rows.filter((r) => r.classOnly + r.fullOnly > 0).length}}\n`
  // The call graph's own contribution is `full` against `class`, never against `outlet`: both keep
  // the service join and the stand-ins, and differ only in how a service navigation is placed.
  if (rows.some((r) => !Number.isInteger(r.classOnlySites) || !Number.isInteger(r.fullOnlySites))) {
    throw new Error('the rows were measured before the site sets of full and class were compared, so the call graph\'s contribution cannot be stated; run the ablation again')
  }
  const cgAdded = rows.reduce((a, r) => a + r.fullOnlySites, 0), cgRemoved = rows.reduce((a, r) => a + r.classOnlySites, 0)
  const netSites = sum('full', 'sites') - sum('class', 'sites')
  if (netSites !== cgAdded - cgRemoved) throw new Error(`full has ${netSites} more sites than class, but ${cgAdded} sites only full places less ${cgRemoved} only class places is ${cgAdded - cgRemoved}`)
  out += `\\newcommand{\\AblationCallGraphNetSites}{${netSites}}\n`
  out += `\\newcommand{\\AblationCallGraphNetShare}{${((netSites / sum('full', 'sites')) * 100).toFixed(1)}\\,\\%}\n`
  out += `\\newcommand{\\AblationCallGraphNetPairs}{${sum('full', 'pairs') - sum('class', 'pairs')}}\n`
  out += `\\newcommand{\\AblationCallGraphAddedSites}{${cgAdded}}\n`
  out += `\\newcommand{\\AblationCallGraphRemovedSites}{${cgRemoved}}\n`
  out += baselineTex(rows)
  for (const l of [...LEVELS, ...BESIDE]) {
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
