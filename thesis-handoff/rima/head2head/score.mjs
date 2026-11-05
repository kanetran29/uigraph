/**
 * Scores the head-to-head comparison under PREREGISTRATION.txt: merges the blind readings (the gate's
 * verdict where it re-read a pair, else the reader's), estimates each stratum's real pairs from its
 * sample, and derives each tool's precision and relative recall per application and pooled over
 * groups of applications. An unclear verdict counts as not real. Writes the result and LaTeX macros.
 *
 * Usage: node score.mjs --reading results/reading.json --strata results/strata.json \
 *          --raw <workflow result json> [--corrections results/corrections.json] --json results/score.json --tex <out.tex>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const RIMA = ['posts-users-ui-ng', 'heroes-angular', 'airbus-inventory', 'spring-petclinic-angular', 'ever-traduora', 'angular-jumpstart', 'event-booking-mean']
export const CORPUS = ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']

const key = (slug, from, to) => `${slug}\u0000${from}\u0000${to}`

/**
 * One verdict per sampled pair: the gate's where it re-read the pair, else the reader's. Throws when a
 * sampled pair has no reading, so a dropped batch cannot pass unnoticed.
 */
export function mergeReadings(reading, readers, gateItems, corrections = {}) {
  const r = new Map(readers.map((x) => [key(x.slug, x.from, x.to), x]))
  const g = new Map(gateItems.map((x) => [key(x.slug, x.from, x.to), x]))
  // A hand correction (corrections.json, "slug|from|to") takes precedence over both readings.
  const c = new Map(Object.entries(corrections).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [key(...k.split('|')), v]))
  const out = []
  for (const [slug, v] of Object.entries(reading))
    for (const p of v.pairs) {
      const k = key(slug, p.from, p.to)
      const x = c.get(k) ?? g.get(k) ?? r.get(k)
      if (!x) throw new Error(`no reading for ${slug} ${p.from} -> ${p.to}`)
      out.push({ slug, from: p.from, to: p.to, stratum: p.stratum, verdict: x.verdict, gated: g.has(k), corrected: c.has(k), readerVerdict: r.get(k)?.verdict ?? null, site: x.site, reason: x.reason })
    }
  return out
}

/** Wilson 95 % interval of k successes in n trials. */
export function wilson(k, n) {
  if (n === 0) return [0, 1]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [(c - h) / d, (c + h) / d]
}

/**
 * Per stratum of one application: its size, the sample read, the real ones among it and the estimated
 * real pairs; then each tool's pairs, estimated real pairs, precision and relative recall.
 */
export function scoreApp(strata, verdicts) {
  const st = {}
  for (const [name, size] of [['both', strata.both], ['theirs', strata.theirsOnly], ['ours', strata.oursOnly]]) {
    const read = verdicts.filter((v) => v.stratum === name)
    const real = read.filter((v) => v.verdict === 'real').length
    st[name] = { size, read: read.length, real, unclear: read.filter((v) => v.verdict === 'unclear').length, est: read.length ? (size * real) / read.length : 0, ci: wilson(real, read.length) }
  }
  const tool = (own) => {
    const pairs = st.both.size + st[own].size
    const real = st.both.est + st[own].est
    return { pairs, real }
  }
  const theirs = tool('theirs')
  const ours = tool('ours')
  const all = st.both.est + st.theirs.est + st.ours.est
  return { strata: st, all, theirs, ours }
}

/** Precision and relative recall from summed pairs and estimated real pairs. */
export function rates(t, all) {
  return { precision: t.pairs ? t.real / t.pairs : null, recall: all ? t.real / all : null }
}

/** Sums application scores over a group. */
export function pool(apps) {
  const s = { theirs: { pairs: 0, real: 0 }, ours: { pairs: 0, real: 0 }, all: 0 }
  for (const a of apps) {
    s.all += a.all
    for (const t of ['theirs', 'ours']) { s[t].pairs += a[t].pairs; s[t].real += a[t].real }
  }
  return s
}

/** Reads the inputs, scores every application and group, and writes the json and the macros. */
function main() {
  const a = {}
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const reading = JSON.parse(readFileSync(a.reading, 'utf8'))
  const strata = JSON.parse(readFileSync(a.strata, 'utf8'))
  const raw = JSON.parse(readFileSync(a.raw, 'utf8'))
  const res = raw.result ?? raw
  const gateItems = res.gate.flatMap((g) => g.items.map((x) => ({ slug: g.slug, ...x })))
  const verdicts = mergeReadings(reading, res.readers, gateItems, a.corrections ? JSON.parse(readFileSync(a.corrections, 'utf8')) : {})
  const apps = {}
  for (const slug of Object.keys(reading)) apps[slug] = scoreApp(strata[slug], verdicts.filter((v) => v.slug === slug))
  const groups = { Rima: RIMA, Corpus: CORPUS, CorpusNoMifos: CORPUS.filter((x) => x !== 'mifos'), All: [...RIMA, ...CORPUS] }
  const pct = (x) => (x === null ? '--' : `${(100 * x).toFixed(1)}\\,\\%`)
  const name = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  let tex = '% Generated by rima/head2head/score.mjs from the blind readings. Do not edit.\n'
  const m = (k, v) => { tex += `\\newcommand{\\HH${k}}{${v}}\n` }
  for (const [g, list] of Object.entries(groups)) {
    const p = pool(list.map((s) => apps[s]))
    for (const t of ['theirs', 'ours']) {
      const r = rates(p[t], p.all)
      const T = t === 'theirs' ? 'Theirs' : 'Ours'
      m(`${g}${T}Pairs`, p[t].pairs)
      m(`${g}${T}Precision`, pct(r.precision))
      m(`${g}${T}Recall`, pct(r.recall))
    }
  }
  for (const [slug, s] of Object.entries(apps)) {
    const N = name(slug)
    for (const t of ['theirs', 'ours']) {
      const r = rates(s[t], s.all)
      const T = t === 'theirs' ? 'Theirs' : 'Ours'
      m(`${N}${T}Pairs`, s[t].pairs)
      m(`${N}${T}Precision`, pct(r.precision))
      m(`${N}${T}Recall`, pct(r.recall))
    }
    m(`${N}Both`, s.strata.both.size)
  }
  const n = (f) => verdicts.filter(f).length
  m('Read', verdicts.length)
  m('ReadReal', n((v) => v.verdict === 'real'))
  m('ReadSpurious', n((v) => v.verdict === 'spurious'))
  m('ReadUnclear', n((v) => v.verdict === 'unclear'))
  m('Gated', n((v) => v.gated))
  m('GateChanged', n((v) => v.gated && !v.corrected && v.readerVerdict !== v.verdict))
  m('Corrected', n((v) => v.corrected))
  writeFileSync(a.json, JSON.stringify({ apps, verdicts }, null, 1) + '\n')
  writeFileSync(a.tex, tex)
  for (const [g, list] of Object.entries(groups)) {
    const p = pool(list.map((s) => apps[s]))
    console.log(g, 'theirs', JSON.stringify(rates(p.theirs, p.all)), p.theirs.pairs, '| ours', JSON.stringify(rates(p.ours, p.all)), p.ours.pairs)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
