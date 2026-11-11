/**
 * Serves a blind reading sheet to the author on localhost and records each answer as it is given.
 * The page shows each item's source lines and claim, never a verdict; every change is written at
 * once to the verdicts file with the time it was given, so the record shows when each item was read.
 *
 * Usage: node serve.mjs --sheet must-sheet.json --verdicts must-verdicts.json [--port 4610]
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback)
const SHEET = arg('sheet', 'must-sheet.json')
const VERDICTS = arg('verdicts', 'must-verdicts.json')
const PORT = Number(arg('port', 4610))

/** Reads the verdicts recorded so far, keyed by item id. */
const loadVerdicts = () => (existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, 'utf8')) : { sheet: SHEET, verdicts: {} })

/** Escapes text for HTML so source code shows as written. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Renders one item card: location, claim, numbered source lines and the two questions. */
function card(it, i, saved) {
  const v = saved[it.id] ?? {}
  const radio = (q, val, label) => `<label><input type="radio" name="${q}-${it.id}" value="${val}" ${v[q] === val ? 'checked' : ''}> ${label}</label>`
  const sources = it.sources.length > 6 ? `${it.sources.slice(0, 6).map(esc).join(', ')} and ${it.sources.length - 6} more` : it.sources.map(esc).join(', ')
  const code = it.lines.map((l) => `<div class="${l.cited ? 'cited' : ''}"><span class="n">${l.n}</span>${esc(l.text) || ' '}</div>`).join('')
  return `<section class="item" data-id="${it.id}">
<h3>${i + 1}. ${esc(it.app)} · <code>${esc(it.file)}:${it.line}</code> <span class="ok">${v.at ? 'saved' : ''}</span></h3>
<p>Claim: on each source screen below, clicking the highlighted construct navigates to <code>${esc(it.target)}</code>.<br>Source screens (${it.sources.length}): ${sources}</p>
<pre>${code}</pre>
<p class="q">1. Does triggering it go to <code>${esc(it.target)}</code>? ${radio('target', 'yes', 'Yes')} ${radio('target', 'no', 'No')} ${radio('target', 'unsure', 'Unsure')}</p>
<p class="q">2. On every listed source screen, is it always shown and is the navigation never stopped (no template condition, guard, resolver or canDeactivate)? ${radio('always', 'yes', 'Yes')} ${radio('always', 'no', 'No')} ${radio('always', 'unsure', 'Unsure')}</p>
<textarea placeholder="Note (optional)">${esc(v.note ?? '')}</textarea>
</section>`
}

/** Builds the whole page from the sheet and the answers recorded so far. */
function page() {
  const { items } = JSON.parse(readFileSync(SHEET, 'utf8'))
  const saved = loadVerdicts().verdicts
  return `<!doctype html><html><head><meta charset="utf-8"><title>Blind reading</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:0 auto;padding:16px;color:#1f1f1f;background:#fafaf8}
.item{background:#fff;border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin:16px 0}
pre{background:#f4f3ef;padding:8px;overflow-x:auto;font-size:12.5px;line-height:1.45}
.n{display:inline-block;width:3.2em;color:#999;user-select:none}.cited{background:#fde7a6}
.ok{color:#2e7d32;font-size:13px;font-weight:400}.q label{margin-left:10px}textarea{width:100%;height:38px}
#bar{position:sticky;top:0;background:#fafaf8;padding:6px 0;border-bottom:1px solid #ddd}
</style></head><body>
<div id="bar"><b>Blind reading: ${items.length} constructs</b> · answered <span id="done">0</span> / ${items.length}. Decide from the source (open the files in your editor if the excerpt is not enough) before looking at any earlier reading. Answers save as you click.</div>
${items.map((it, i) => card(it, i, saved)).join('\n')}
<script>
const count=()=>{document.getElementById('done').textContent=[...document.querySelectorAll('.item')].filter(s=>s.querySelector('input[name^="target-"]:checked')&&s.querySelector('input[name^="always-"]:checked')).length}
async function save(sec){const id=sec.dataset.id;const g=q=>sec.querySelector('input[name="'+q+'-'+id+'"]:checked')?.value??null
const r=await fetch('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,target:g('target'),always:g('always'),note:sec.querySelector('textarea').value})})
sec.querySelector('.ok').textContent=r.ok?'saved':'NOT SAVED';count()}
document.querySelectorAll('.item').forEach(sec=>{sec.addEventListener('change',()=>save(sec))});count()
</script></body></html>`
}

/** Records one answer with its time; refuses ids that are not on the sheet. */
function record(body) {
  const ids = new Set(JSON.parse(readFileSync(SHEET, 'utf8')).items.map((it) => it.id))
  if (!ids.has(body.id)) return false
  const v = loadVerdicts()
  v.verdicts[body.id] = { target: body.target, always: body.always, note: body.note || '', at: new Date().toISOString() }
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
