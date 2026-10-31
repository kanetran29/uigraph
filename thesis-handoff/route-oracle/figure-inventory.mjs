#!/usr/bin/env node
// Every artefact that holds a reported figure, and every figure that is not behind a macro.
//
// A number in this thesis can live in nine places: a result file, a generated \newcommand, a
// plot coordinate, a hand-written caption, a chapter sentence, a commit message, the email
// draft, HANDOFF.md, and a diagnostics text file. Fixing a figure in one or two of them is how
// a superseded number survives four rounds of correction, which is what happened to "eight
// failures" and to Figure 5.4's guard row. This hunts the complement: text that states a value
// a generated macro already carries, so the number is a copy rather than a citation.
//
// Spelled-out numerals are checked as well as digits, because the one instance a hand sweep
// missed was written "twenty-six" rather than 26.
//
// Matching on value alone does not discriminate: in this thesis 0, 1 and 2 are each the value
// of dozens of macros, and every "one paragraph" or "2 Nov" in a draft note then reads as a
// finding. A numeral is reported only when its value is carried by a macro whose subject also
// appears on the line, and small values are dropped outright, since a figure worth citing from
// a macro is almost never under four.
//
// Usage: node figure-inventory.mjs [--thesis <dir>] [--also <file> ...]
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const thesisDir = path.resolve(flag('--thesis', path.join(import.meta.dirname, '..', 'thesis')))
const also = argv.reduce((a, v, i) => (argv[i - 1] === '--also' ? [...a, v] : a), [])

const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

/** The value every generated macro carries, by macro name, with percentages normalised. */
function macroValues(dir) {
  const byName = new Map()
  for (const f of readdirSync(dir).filter((f) => /^generated-.*\.tex$/.test(f))) {
    const src = readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/\\newcommand\{\\([A-Za-z]+)\}\{([^}]*)\}/g)) {
      const raw = m[2].replace(/\\,|\\%|\\\$|\s/g, '')
      if (/^-?\d+(\.\d+)?$/.test(raw)) byName.set(m[1], { value: Number(raw), file: f, text: m[2] })
    }
  }
  return byName
}

/** Lines of a file with the LaTeX that cannot hold a reported figure masked out. */
function scannableLines(src) {
  return src.split('\n').map((l) => l
    .replace(/%.*$/, '')
    .replace(/^\s*\d+\.\s/, ' ')
    .replace(/\\(?:ref|label|cite|input|include|newcommand|renewcommand|path|texttt|url)\{[^}]*\}/g, ' ')
    .replace(/\\[A-Za-z]+\{\}/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:pt|cm|mm|em|ex|in|\\textwidth|\\linewidth)/g, ' ')
    .replace(/\b(?:19|20)\d\d\b/g, ' ')
    .replace(/\b\d+\.\d+\.\d+\b/g, ' '))
}

// What each macro family is about, so that a value can be required to sit in a sentence on the
// same subject. A family with no keyword here is never reported on value alone.
const FAMILIES = [
  [/^Mut/, ['mutant', 'mutation', 'operator', 'detect', 'guard', 'retarget', 'routerlink', 'rename', 'exclud', 'scored', 'sampled', 'sensitiv']],
  [/^GT/, ['ground truth', 'annotat', 'recall', 'precision', 'site', 'pair', 'excess', 'missing', 'by hand']],
  [/^Probe/, ['probe', 'run time', 'runtime', 'mounted', 'address', 'answer', 'browser', 'invent']],
  [/^Ablation/, ['ablation', 'level', 'owned', 'nesting', 'rooted', 'outlet', 'mechanism', 'site', 'pair', 'scope']],
  [/^Census/, ['node', 'edge', 'modality', 'screen', 'anchor', 'unknown', 'must', 'may', 'graph']],
  [/^Attr/, ['attribution', 'recover', 'convert', 'loss', 'edge', 'must', 'may']],
  [/^RoundTwo/, ['round', 'repair', 'defect', 'loss', 'site', 'screen', 'edge', 'must', 'violat', 'coverage', 'declared', 'accounted', 'witness']],
  [/^Earlier/, ['earlier', 'superseded', 'commit', 'instrument', 'must', 'violat', 'conversion']],
  [/^Scope/, ['scope', 'rendered', 'confirm', 'predict', 'screen', 'pattern']],
  [/^EtoE/, ['end-to-end', 'test source', 'specification', 'recall', 'url']],
  [/^Expansion/, ['expansion', 'anchor', 'materialis']],
  [/^NodeAudit/, ['node', 'audit', 'declared', 'unmatched']],
]

/** The keywords a macro's subject can appear as, or null when its family is not described. */
function subjectWords(name) {
  for (const [re, words] of FAMILIES) if (re.test(name)) return words
  return null
}

const SMALLEST = 4

const macros = macroValues(thesisDir)
const byValue = new Map()
for (const [name, m] of macros) {
  if (!byValue.has(m.value)) byValue.set(m.value, [])
  byValue.get(m.value).push(name)
}

const targets = [
  ...readdirSync(thesisDir).filter((f) => f.endsWith('.tex') && !f.startsWith('generated-')).map((f) => path.join(thesisDir, f)),
  ...(existsSync(path.join(thesisDir, 'figures'))
    ? readdirSync(path.join(thesisDir, 'figures')).filter((f) => f.endsWith('.tex')).map((f) => path.join(thesisDir, 'figures', f))
    : []),
  ...also.map((f) => path.resolve(f)),
].filter((f) => existsSync(f))

let findings = 0
for (const file of targets) {
  const rel = path.relative(path.join(thesisDir, '..'), file)
  scannableLines(readFileSync(file, 'utf8')).forEach((line, i) => {
    const seen = new Set()
    const low = line.toLowerCase()
    const hit = (value, token) => {
      if (!byValue.has(value) || seen.has(token) || Math.abs(value) < SMALLEST) return
      const onSubject = byValue.get(value).filter((name) => {
        const words = subjectWords(name)
        return words !== null && words.some((w) => low.includes(w))
      })
      if (!onSubject.length) return
      seen.add(token)
      findings += 1
      console.log(`${rel}:${i + 1}: ${JSON.stringify(token)} = ${value}, carried by ${onSubject.map((n) => '\\' + n).join(', ')}`)
      console.log(`    ${line.trim().slice(0, 150)}`)
    }
    for (const m of line.matchAll(/(?<![\w.\\])(\d{1,6})(?![\w.])/g)) hit(Number(m[1]), m[1])
    for (const m of line.matchAll(/\b([a-z]+)(?:-([a-z]+))?\b/g)) {
      const a = WORDS[m[1]]
      if (a === undefined) continue
      const b = m[2] ? WORDS[m[2]] : undefined
      hit(m[2] && b !== undefined ? a + b : a, m[0])
    }
  })
}

console.log(`\n${macros.size} generated macros carry a numeric value; ${byValue.size} distinct values.`)
console.log(findings
  ? `${findings} place${findings === 1 ? '' : 's'} state a value a macro already carries. Each is a copy that can drift, or a coincidence to confirm.`
  : 'No prose, caption or draft states a value that a generated macro carries.')
