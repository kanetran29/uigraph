/**
 * Merges the source readings of PREREGISTRATION.txt M3 and M4 (a reader's verdict per pair, overridden
 * by the final gate's where the gate re-checked it) and writes the counts as LaTeX macros.
 *
 * Usage: node verdicts.mjs --raw a.json[,b.json:slug] --input adjudication-input.json --out adjudication.json --causes spurious-causes.json --corrections corrections.json --results results.json --gt <gt dir> --tex out.tex
 * Each raw file is a workflow result { readers: [...], gate: [{ items }] | { items } }; a ':slug' suffix
 * names the subject of a file whose items carry none.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { referencePairs } from './score.mjs'

const key = (x) => [x.slug, x.kind, x.from, x.to].join('\u0000')

/**
 * Returns one final verdict per input pair: the gate's when the gate re-checked the pair, else the
 * reader's. `runs` are { slug?, readers, gateItems }; a run without slugs on its items supplies one.
 * Throws when a pair of `input` has no reading, so a dropped batch cannot pass unnoticed.
 */
export function merge(runs, input) {
  const readers = new Map()
  const gate = new Map()
  for (const r of runs) {
    for (const x of r.readers) readers.set(key({ slug: r.slug, ...x }), { slug: r.slug, ...x })
    for (const x of r.gateItems) gate.set(key({ slug: r.slug, kind: 'extra', ...x }), { slug: r.slug, kind: 'extra', ...x })
  }
  const out = []
  for (const [slug, v] of Object.entries(input))
    for (const p of [...v.misses.map((m) => ({ ...m, kind: 'miss' })), ...v.extras.map((x) => ({ ...x, kind: 'extra' }))]) {
      const k = key({ slug, kind: p.kind, from: p.from, to: p.to })
      const r = readers.get(k)
      if (!r) throw new Error(`no reading for ${slug} ${p.kind} ${p.from} -> ${p.to}`)
      const g = gate.get(k)
      out.push({ slug, kind: p.kind, from: p.from, to: p.to, top: p.top ?? null, readerVerdict: r.verdict, verdict: g ? g.verdict : r.verdict, gated: !!g, site: g ? g.site : r.site, reason: g ? g.reason : r.reason })
    }
  return out
}

/**
 * Replaces the verdict, site and reason of each pair named in `corrections` (keys "slug kind from to"),
 * marking it corrected ('verdict' when the verdict changes, 'site' when only the evidence does).
 * Throws on a key that names no pair.
 */
export function applyCorrections(final, corrections) {
  for (const [k, c] of Object.entries(corrections)) {
    if (k.startsWith('_')) continue
    const x = final.find((y) => `${y.slug} ${y.kind} ${y.from} ${y.to}` === k)
    if (!x) throw new Error(`correction for an unknown pair: ${k}`)
    Object.assign(x, { corrected: x.verdict !== c.verdict ? 'verdict' : 'site', verdict: c.verdict, site: c.site, reason: c.reason })
  }
  return final
}

/** Reads every raw workflow result into runs for merge(). */
function runsOf(files) {
  return files.map((spec) => {
    const [f, slug] = spec.split(':')
    const d = JSON.parse(readFileSync(f, 'utf8'))
    const gates = Array.isArray(d.gate) ? d.gate : [d.gate]
    return { slug, readers: d.readers, gateItems: gates.flatMap((g) => g?.items ?? []) }
  })
}

/** Merges the raw files given and writes adjudication.json and the macros. */
function main() {
  const a = {}
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const input = JSON.parse(readFileSync(a.input, 'utf8'))
  const runs = runsOf(a.raw.split(','))
  const final = merge(runs, input)
  // Corrections made after the gate, each with its reason (corrections.json); they are counted apart.
  applyCorrections(final, a.corrections ? JSON.parse(readFileSync(a.corrections, 'utf8')) : {})
  writeFileSync(a.out, JSON.stringify(final, null, 1) + '\n')
  const n = (f) => final.filter(f).length
  const extra = (v) => n((x) => x.kind === 'extra' && x.verdict === v)
  const m = {
    Judged: n((x) => x.kind === 'extra'),
    JudgedReal: extra('real'),
    JudgedSpurious: extra('spurious'),
    JudgedUnclear: extra('unclear'),
    Gated: n((x) => x.gated),
    GateChanged: n((x) => x.gated && !x.corrected && x.verdict !== x.readerVerdict),
    Corrected: n((x) => x.corrected === 'verdict'),
    Recited: n((x) => x.corrected === 'site'),
    Missed: n((x) => x.kind === 'miss'),
    ...Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ['Miss' + c.toUpperCase(), n((x) => x.kind === 'miss' && x.verdict === c)])),
  }
  // Hand-recorded causes of the spurious pairs; they must name exactly the pairs judged spurious.
  const causes = JSON.parse(readFileSync(a.causes, 'utf8'))
  const spurious = final.filter((x) => x.kind === 'extra' && x.verdict === 'spurious').map((x) => `${x.slug} ${x.from} ${x.to}`).sort()
  const named = Object.keys(causes).filter((k) => !k.startsWith('_')).sort()
  if (spurious.join('|') !== named.join('|')) throw new Error(`spurious-causes.json does not match the spurious pairs: ${spurious.join(', ')}`)
  m.SpuriousAttribution = named.filter((k) => causes[k] === 'attribution').length
  m.SpuriousTarget = named.filter((k) => causes[k] === 'target').length
  // Reference pairs the source shows to be wrong (class e) leave the denominator of the corrected recall.
  const results = JSON.parse(readFileSync(a.results, 'utf8'))
  const wrong = new Set(final.filter((x) => x.kind === 'miss' && x.verdict === 'e').map((x) => `${x.slug} ${x.from} ${x.to}`))
  const pairs = Object.values(results).reduce((s, r) => s + r.pairs, 0)
  m.PairsValid = pairs - wrong.size
  for (const l of ['noattr', 'rooted', 'outlet', 'full']) {
    let hit = 0
    for (const [slug, r] of Object.entries(results)) {
      const missed = new Set(r.levels[l].missed.map((x) => `${slug} ${x.from} ${x.to}`))
      hit += r.levels[l].hit
      for (const w of wrong) if (w.startsWith(slug + ' ') && !missed.has(w)) hit--
    }
    const L = l.charAt(0).toUpperCase() + l.slice(1)
    m['HitValid' + L] = hit
    m['RecallValid' + L] = `${((100 * hit) / m.PairsValid).toFixed(1)}\\,\\%`
  }
  // A spurious pair with a must edge would be a soundness failure of the must tier; the input lists
  // at most six edges per pair, so a pair at the cap could hide one and is refused.
  const edgesOf = (x) => input[x.slug].extras.find((y) => y.from === x.from && y.to === x.to).edges
  const spuriousPairs = final.filter((x) => x.kind === 'extra' && x.verdict === 'spurious')
  if (spuriousPairs.some((x) => edgesOf(x).length >= 6)) throw new Error('a spurious pair lists six edges; its modality cannot be read from the input')
  m.SpuriousMust = spuriousPairs.filter((x) => edgesOf(x).some((e) => e.modality === 'must')).length
  // Real extra pairs whose target no reference pair reaches: destinations the reference does not cover.
  const p = (r) => r.split('/').map((x) => (x.startsWith(':') ? ':_' : x)).join('/')
  const terminals = Object.fromEntries(Object.keys(input).map((slug) => [slug, new Set(referencePairs(JSON.parse(readFileSync(join(a.gt, `${slug}.json`), 'utf8'))).pairs.map(([, t]) => p(t)))]))
  m.RealNewTarget = n((x) => x.kind === 'extra' && x.verdict === 'real' && !terminals[x.slug].has(p(x.to)))
  const macroName = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  for (const slug of Object.keys(input)) {
    const N = macroName(slug)
    m[N + 'Real'] = n((x) => x.slug === slug && x.kind === 'extra' && x.verdict === 'real')
    m[N + 'Spurious'] = n((x) => x.slug === slug && x.kind === 'extra' && x.verdict === 'spurious')
    m[N + 'Judged'] = n((x) => x.slug === slug && x.kind === 'extra')
  }
  let tex = '% Generated by rima/verdicts.mjs from the source readings. Do not edit.\n'
  for (const [k, v] of Object.entries(m)) tex += `\\newcommand{\\Rima${k}}{${v}}\n`
  writeFileSync(a.tex, tex)
  console.log(m)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
