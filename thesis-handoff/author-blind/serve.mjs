/**
 * Serves a blind reading sheet to the author on localhost and records each answer as it is given.
 * The page shows each item's source lines and claim, never a verdict; every change is written at
 * once to the verdicts file with the time it was given, so the record shows when each item was read.
 * The sheet supplies its own questions ({"questions": [{key, text, options}]}); a question's text may
 * name an item field as {field}. Sheets without questions get the must-tier pair.
 *
 * Usage: node serve.mjs --sheet must-sheet.json --verdicts must-verdicts.json [--port 4610]
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback)
const SHEET = arg('sheet', 'must-sheet.json')
const VERDICTS = arg('verdicts', 'must-verdicts.json')
const PORT = Number(arg('port', 4610))
const YES_NO = ['yes', 'no', 'unsure']
const MUST_QUESTIONS = [
  { key: 'target', text: 'Does triggering it go to {target}?', options: YES_NO },
  { key: 'always', text: 'On every listed source screen, is it always shown and is the navigation never stopped (no template condition, guard, resolver or canDeactivate)?', options: YES_NO },
]

/** Reads the sheet and fills in the default questions for sheets written before questions existed. */
const loadSheet = () => {
  const sheet = JSON.parse(readFileSync(SHEET, 'utf8'))
  return { ...sheet, questions: sheet.questions ?? MUST_QUESTIONS }
}

/** Reads the verdicts recorded so far, keyed by item id. */
const loadVerdicts = () => (existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, 'utf8')) : { sheet: SHEET, verdicts: {} })

/** Escapes text for HTML so source code shows as written. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Replaces {field} in a question or claim with the item's value, shown as code. */
const fill = (text, it) => esc(text).replace(/\{(\w+)\}/g, (_, k) => `<code>${esc(it[k] ?? '')}</code>`)

/** Renders one item card: location, claim, context, numbered source lines and the questions. */
function card(it, i, saved, questions) {
  const v = saved[it.id] ?? {}
  const radios = (q) => q.options.map((o) => `<label><input type="radio" name="${q.key}-${it.id}" value="${esc(o)}" ${v[q.key] === o ? 'checked' : ''}> ${esc(o)}</label>`).join(' ')
  const title = it.title ?? `${it.app} · <code>${esc(it.file)}:${it.line}</code>`
  const sources = it.sources ? `<br>Source screens (${it.sources.length}): ${it.sources.length > 6 ? `${it.sources.slice(0, 6).map(esc).join(', ')} and ${it.sources.length - 6} more` : it.sources.map(esc).join(', ')}` : ''
  const claim = it.claim ? fill(it.claim, it) : `Claim: on each source screen below, clicking the highlighted construct navigates to <code>${esc(it.target)}</code>.`
  const context = (it.context ?? []).map((c) => `<li>${esc(c)}</li>`).join('')
  const blocks = (it.blocks ?? [{ label: it.file ? `${it.file}` : '', lines: it.lines }]).filter((b) => b.lines?.length)
  const code = blocks.map((b) => `${b.label ? `<div class="lbl">${esc(b.label)}</div>` : ''}<pre>${b.lines.map((l) => `<div class="${l.cited ? 'cited' : ''}"><span class="n">${l.n}</span>${esc(l.text) || ' '}</div>`).join('')}</pre>`).join('')
  return `<section class="item" data-id="${it.id}">
<h3>${i + 1}. ${title} <span class="ok">${v.at ? 'saved' : ''}</span></h3>
<p>${claim}${sources}</p>${context ? `<ul>${context}</ul>` : ''}
${code}
${questions.map((q, k) => `<p class="q">${k + 1}. ${fill(q.text, it)} ${radios(q)}</p>`).join('\n')}
<textarea placeholder="Reason, one line: what you read to decide (file, guard, condition)">${esc(v.reason ?? v.note ?? '')}</textarea>
</section>`
}

/** Builds the whole page from the sheet and the answers recorded so far. */
function page() {
  const { items, questions, title } = loadSheet()
  const saved = loadVerdicts().verdicts
  return `<!doctype html><html><head><meta charset="utf-8"><title>Blind reading</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:0 auto;padding:16px;color:#1f1f1f;background:#fafaf8}
.item{background:#fff;border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin:16px 0}
pre{background:#f4f3ef;padding:8px;overflow-x:auto;font-size:12.5px;line-height:1.45;margin-top:4px}
.n{display:inline-block;width:3.2em;color:#999;user-select:none}.cited{background:#fde7a6}.lbl{font-size:12.5px;color:#666}
.ok{color:#2e7d32;font-size:13px;font-weight:400}.q label{margin-left:10px}textarea{width:100%;height:38px}
#bar{position:sticky;top:0;background:#fafaf8;padding:6px 0;border-bottom:1px solid #ddd}
</style></head><body>
<div id="bar"><b>${esc(title ?? 'Blind reading')}: ${items.length} items</b> · complete <span id="done">0</span> / ${items.length}. Decide from the source (open the files in your editor if the excerpt is not enough) before looking at any earlier reading, and write one line on what you read. Answers save as you go.</div>
${items.map((it, i) => card(it, i, saved, questions)).join('\n')}
<script>
const KEYS=${JSON.stringify(questions.map((q) => q.key))}
const count=()=>{document.getElementById('done').textContent=[...document.querySelectorAll('.item')].filter(s=>KEYS.every(k=>s.querySelector('input[name^="'+k+'-"]:checked'))&&s.querySelector('textarea').value.trim()).length}
async function save(sec){const id=sec.dataset.id;const body={id,reason:sec.querySelector('textarea').value}
for(const k of KEYS)body[k]=sec.querySelector('input[name="'+k+'-'+id+'"]:checked')?.value??null
const r=await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
sec.querySelector('.ok').textContent=r.ok?'saved':'NOT SAVED';count()}
document.querySelectorAll('.item').forEach(sec=>{sec.addEventListener('change',()=>save(sec))});count()
</script></body></html>`
}

/** Records one answer with its time; refuses ids that are not on the sheet. */
function record(body) {
  const { items, questions } = loadSheet()
  if (!items.some((it) => it.id === body.id)) return false
  const v = loadVerdicts()
  const entry = { reason: body.reason || '', at: new Date().toISOString() }
  for (const q of questions) entry[q.key] = body[q.key] ?? null
  v.verdicts[body.id] = entry
  writeFileSync(VERDICTS, JSON.stringify(v, null, 1) + '\n')
  return true
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let ok = false
    try { ok = record(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch {}
    res.writeHead(ok ? 204 : 400)
    return res.end()
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page())
}).listen(PORT, '127.0.0.1', () => console.log(`blind sheet on http://127.0.0.1:${PORT}`))
