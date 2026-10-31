// The template conditions enclosing a navigation site, read from the template text.
//
// Split out of must-context.mjs so that it can be checked without a corpus: that script reads
// the corpus graphs at import time. template-context.test.mjs is the check.

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
export const BLOCKS = /@(else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/y
export const STRUCTURAL = /(?:^|\s)(\*[a-zA-Z][\w.-]*|\[ngIf\]|\[ngForOf\])(?=[\s=>\/]|$)/

/**
 * The template conditions enclosing a site, read by scanning the template from its start to the
 * site with two stacks: one for control-flow blocks, closed by the brace that ends them, and one
 * for elements, so that a structural directive on an ancestor counts. Interpolations are masked
 * first, since their braces are not blocks. Returns null when either stack underflows, so the
 * caller refuses rather than reporting a context from a parse it cannot trust.
 */
export function templateContextsOf(text, siteOffset) {
  const t = text.replace(/\{\{[\s\S]*?\}\}/g, (m) => ' '.repeat(m.length))
  const blocks = [], tags = []
  let siteAttrs = null
  let i = 0
  while (i < siteOffset) {
    if (t[i] === '@') {
      BLOCKS.lastIndex = i
      const m = BLOCKS.exec(t)
      if (m) {
        let j = i + m[0].length
        while (j < t.length && /\s/.test(t[j])) j += 1
        if (t[j] === '(') { let d = 0; for (; j < t.length; j += 1) { if (t[j] === '(') d += 1; else if (t[j] === ')') { d -= 1; if (!d) { j += 1; break } } } }
        while (j < t.length && /\s/.test(t[j])) j += 1
        if (t[j] === '{' && j < siteOffset) { blocks.push(m[1].replace(/\s+/g, ' ')); i = j + 1; continue }
      }
    }
    if (t[i] === '}') { if (!blocks.length) return null; blocks.pop(); i += 1; continue }
    if (t[i] === '<') {
      const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(t.slice(i, i + 200))
      if (close) {
        const k = tags.map((x) => x.name).lastIndexOf(close[1].toLowerCase())
        if (k < 0) return null
        tags.length = k
        i += close[0].length
        continue
      }
      const open = /^<([a-zA-Z][\w-]*)([^>]*?)(\/?)>/.exec(t.slice(i))
      if (open) {
        const name = open[1].toLowerCase()
        if (i + open[0].length > siteOffset) { siteAttrs = open[2]; break }
        if (!open[3] && !VOID.has(name)) tags.push({ name, attrs: open[2] })
        i += open[0].length
        continue
      }
    }
    i += 1
  }
  if (siteAttrs === null) {
    const site = /^[^<]*<([a-zA-Z][\w-]*)([^>]*)>/.exec(t.slice(siteOffset))
    siteAttrs = site ? site[2] : ''
  }
  const found = new Set(blocks.map((b) => `@${b}`))
  for (const tag of [...tags, { attrs: siteAttrs }]) {
    const m = STRUCTURAL.exec(tag.attrs)
    if (m) found.add(m[1].replace(/[\[\]]/g, ''))
  }
  return [...found]
}
