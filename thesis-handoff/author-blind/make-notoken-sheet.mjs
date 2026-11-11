/**
 * Builds the author's blind reading sheet for the head-to-head sites without a navigation token:
 * every pair judged real whose cited site has no token within two lines by the rule of
 * rima/head2head/check-sites.mjs (\HHSitesNoToken), mixed with decoys, the pairs not judged real
 * whose cited site exists and has no token either, so that neither the verdict nor the look of the
 * line tells the kinds apart. Each item shows the pair and the cited line; no verdict is written.
 *
 * Usage: node make-notoken-sheet.mjs
 */
import { readFileSync } from 'node:fs'
import { appDirs, hash, readJson, snippet, tilde, writeSheet } from './sheet-lib.mjs'

const CONTEXT = 12
const NAV = /routerLink|navigate|href|ngSubmit|\(click\)|\(submit\)|redirectTo|dispatch|emit|location/i

/** The cited file and line of a reading, its excerpt, and whether a token stands within two lines (check-sites.mjs). */
function cited(dirs, x) {
  const m = /^(.+?):(\d+)/.exec(x.site ?? '')
  const lines = m && snippet(dirs[x.slug], m[1], Number(m[2]), CONTEXT)
  if (!lines) return null
  const near = lines.filter((l) => Math.abs(l.n - Number(m[2])) <= 2).map((l) => l.text).join('\n')
  return { file: m[1], line: Number(m[2]), lines, token: NAV.test(near) }
}

/** Builds and writes notoken-sheet.json, checking the count against the thesis macro. */
function main() {
  const dirs = appDirs()
  const items = []
  let real = 0
  for (const x of readJson('../rima/head2head/results-v3/score.json').verdicts) {
    const c = cited(dirs, x)
    if (x.verdict === 'real' && !c?.token) real++
    if (!c || c.token) continue
    items.push({
      id: hash(`notoken|${x.slug}|${x.from}|${x.to}`),
      app: x.slug,
      from: x.from,
      to: x.to,
      file: c.file,
      line: c.line,
      title: `${x.slug} · ${x.from} → ${x.to}`,
      claim: 'Claim: the highlighted line belongs to a trigger that is shown on {from} and lands on {to}.',
      context: [`Application directory: ${tilde(dirs[x.slug])}`],
      blocks: [{ label: `${c.file}:${c.line}`, lines: c.lines }],
    })
  }
  const macro = /\\HHSitesNoToken\}\{(\d+)\}/.exec(readFileSync(new URL('../thesis/generated-h2h-sites.tex', import.meta.url), 'utf8'))
  if (Number(macro?.[1]) !== real) throw new Error(`${real} real pairs without a token, the thesis says ${macro?.[1]}`)
  writeSheet('notoken-sheet.json', {
    built: 'make-notoken-sheet.mjs',
    title: 'Cited lines',
    intro: 'Each item names a screen pair and highlights one source line. Decide from the source whether the construct the line belongs to (a link, a handler, a configuration entry, a service call, a guard) is a trigger that lands on the target, and whether that trigger is shown while the user stays on the start screen (rendered there, not only during a transition away). A route parameter may take any value; a redirect counts. Open the files in your editor when the excerpt is not enough.',
    questions: [
      { key: 'target', text: 'Does triggering what the highlighted line belongs to land on {to}?', options: ['yes', 'no', 'unsure'] },
      { key: 'shown', text: 'Is that trigger shown to a user who stays on {from}?', options: ['yes', 'no', 'unsure'] },
    ],
    items,
  })
  console.log(`${items.length} items (${real} real without a token) -> notoken-sheet.json`)
}

main()
