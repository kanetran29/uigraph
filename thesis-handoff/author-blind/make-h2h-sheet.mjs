/**
 * Builds the author's blind reading sheet for the head-to-head samples no person has re-read
 * (rima/head2head, readings in results-v3/score.json): every pair of the mifos sample, and one pair
 * per stratum (application and which tool found it) on Rima et al.'s subjects, drawn with a fixed
 * seed among the pairs the first comparison did not also read (those are sheet A's pool). The 41
 * pairs the author re-read (author-check.json) lie on the other five corpus applications and are
 * not drawn. Each item shows the pair and the sites the AI reader was given; no verdict, stratum
 * or tool is written.
 *
 * Usage: node make-h2h-sheet.mjs
 */
import { appDirs, blocksOf, hash, PAIR_RULE, readJson, tilde, writeSheet } from './sheet-lib.mjs'
import { sample } from '../rima/adjudication-input.mjs'

const SEED = 20261111
const PER_STRATUM = 1
const CONTEXT = 6
const RIMA = ['posts-users-ui-ng', 'heroes-angular', 'airbus-inventory', 'spring-petclinic-angular', 'ever-traduora', 'angular-jumpstart', 'event-booking-mean']

/** Builds and writes h2h-sheet.json. */
function main() {
  const dirs = appDirs()
  const read = readJson('../rima/head2head/results-v3/score.json').verdicts
  const given = readJson('../rima/head2head/results-v3/reading.json')
  const first = new Set(readJson('../rima/adjudication.json').map((x) => `${x.slug} ${x.from} ${x.to}`))
  const sitesOf = (x) => given[x.slug].pairs.find((p) => p.from === x.from && p.to === x.to).sites
  const picked = read.filter((x) => x.slug === 'mifos')
  const cells = Object.groupBy(read.filter((x) => RIMA.includes(x.slug) && !first.has(`${x.slug} ${x.from} ${x.to}`)), (x) => `${x.slug} ${x.stratum}`)
  for (const xs of Object.values(cells)) picked.push(...sample(xs, PER_STRATUM, SEED))
  const items = picked.map((x) => ({
    id: hash(`h2h|${x.slug}|${x.from}|${x.to}`),
    app: x.slug,
    from: x.from,
    to: x.to,
    title: `${x.slug} · ${x.from} → ${x.to}`,
    claim: 'Claim: a user on {from} can trigger a navigation that lands on {to}.',
    context: [`Application directory: ${tilde(dirs[x.slug])}`],
    blocks: blocksOf(dirs[x.slug], sitesOf(x), CONTEXT),
  }))
  writeSheet('h2h-sheet.json', {
    built: 'make-h2h-sheet.mjs',
    title: 'Head-to-head samples',
    intro: PAIR_RULE,
    questions: [{ key: 'verdict', text: 'Can a user on {from} trigger a navigation that lands on {to}, the trigger shown while the user stays on {from}?', options: ['real', 'spurious', 'unclear'] }],
    items,
  })
  console.log(`${items.length} items -> h2h-sheet.json (${Object.keys(cells).length} strata on Rima et al.'s subjects)`)
}

main()
