// Vue Single-File-Component parsing without @vue/compiler-sfc: a small,
// depth-counted block splitter + a tag tokenizer. The interface (splitSfc /
// parseTemplateElements) is a deliberate seam — a real compiler can be swapped in
// later without touching extract.ts. The failure mode is UNDER-extraction (a note),
// never a phantom edge, because every must-edge still requires an exact literal
// route match downstream.

/** The split pieces of a .vue file: the root template HTML + the merged script TS. */
export interface Sfc {
  template: string
  templateOffset: number
  script: string
  scriptOffset: number
}

/** One element parsed out of a template: tag, raw attribute map, inner text, source offset. */
export interface TemplateEl {
  tag: string
  attrs: Map<string, string>
  text: string | undefined
  offset: number
}

/** A bound DOM event handler: the event name (modifiers stripped) and its JS expression. */
export interface EventHandler {
  event: string
  expr: string
}

/** Find the matching close for the FIRST `<tag ...>` block, counting nesting. Returns inner text + its source offset. */
function matchBlock(source: string, tag: string): { inner: string; offset: number } | null {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i')
  const m = open.exec(source)
  if (!m) return null
  const innerStart = m.index + m[0].length
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, 'gi')
  re.lastIndex = innerStart
  let depth = 1
  let tok: RegExpExecArray | null
  while ((tok = re.exec(source)) !== null) {
    if (tok[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return { inner: source.slice(innerStart, tok.index), offset: innerStart }
    } else {
      depth += 1
    }
  }
  return null
}

/** Split a .vue source into its root template and its (merged) script blocks. */
export function splitSfc(source: string): Sfc {
  const t = matchBlock(source, 'template')
  let script = ''
  let scriptOffset = 0
  const scriptRe = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let sm: RegExpExecArray | null
  while ((sm = scriptRe.exec(source)) !== null) {
    if (scriptOffset === 0) scriptOffset = sm.index + sm[0].indexOf(sm[1] ?? '')
    script += (sm[1] ?? '') + '\n'
  }
  return { template: t?.inner ?? '', templateOffset: t?.offset ?? 0, script, scriptOffset }
}

/** Parse a Vue attribute span into a name→value map keyed by the RAW name (':to', '@click', 'v-on:click.prevent', 'data-testid'). */
export function parseAttrs(attrStr: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([@:#]?[\w:.-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrStr)) !== null) {
    if (m[1] === undefined || m[1].length === 0) continue
    out.set(m[1], m[2] ?? m[3] ?? '')
  }
  return out
}

/** Tokenize template HTML into elements, capturing inner text for text-bearing tags. */
export function parseTemplateElements(template: string, baseOffset: number): TemplateEl[] {
  const out: TemplateEl[] = []
  const OPEN = /<([a-zA-Z][\w-]*)((?:[^<>]|"[^"]*"|'[^']*')*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = OPEN.exec(template)) !== null) {
    const tag = m[1] ?? ''
    const attrs = parseAttrs(m[2] ?? '')
    let text: string | undefined
    if (m[3] !== '/' && !VOID_TAGS.has(tag.toLowerCase())) {
      const close = template.indexOf(`</${tag}`, OPEN.lastIndex)
      if (close !== -1) {
        const inner = template.slice(OPEN.lastIndex, close).replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (inner.length > 0) text = inner
      }
    }
    out.push({ tag, attrs, text, offset: baseOffset + m.index })
  }
  return out
}

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

/** A plain (non-bound) attribute value, e.g. `to="/x"`. */
export function stringAttr(el: TemplateEl, name: string): string | undefined {
  return el.attrs.get(name)
}

/** A bound attribute's JS expression, e.g. `:to="expr"` / `v-bind:to="expr"`. */
export function boundAttr(el: TemplateEl, name: string): string | undefined {
  return el.attrs.get(`:${name}`) ?? el.attrs.get(`v-bind:${name}`)
}

/** Every `@event` / `v-on:event` handler on an element (modifiers stripped from the event name). */
export function eventHandlers(el: TemplateEl): EventHandler[] {
  const out: EventHandler[] = []
  for (const [k, v] of el.attrs) {
    const m = /^(?:@|v-on:)([a-zA-Z][\w-]*)(?:\.[\w.]+)?$/.exec(k)
    if (m && m[1] !== undefined) out.push({ event: m[1], expr: v })
  }
  return out
}
