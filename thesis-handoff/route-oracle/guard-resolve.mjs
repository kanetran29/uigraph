// Resolving the route a guard property belongs to, and what that route's subtree renders.
//
// Split out of mutate.mjs so that it can be checked without running the harness, which
// extracts a corpus at import time. guard-resolve.test.mjs is that check.

/**
 * A same-length copy of the source with the contents of comments and string literals replaced
 * by spaces, so that braces inside them cannot be mistaken for structure. Indices into the
 * result are indices into the original. A template literal's `${...}` substitutions are left
 * as code, since the braces they contain are real and balanced. One corpus route file ends a
 * line with `children: [], // ... work, },`, whose comment closes the enclosing object nine
 * hundred characters early if it is counted.
 */
export function maskCode(src) {
  const out = src.split('')
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' ' }
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      blank(i, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      blank(i, end < 0 ? src.length : end + 2)
      i = end < 0 ? src.length : end + 2
    } else if (src[i] === "'" || src[i] === '"') {
      const q = src[i]
      let j = i + 1
      while (j < src.length && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      blank(i + 1, j)
      i = j + 1
    } else if (src[i] === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue }
        // A substitution is code: leave it visible and resume masking after its closing brace.
        if (src.slice(j, j + 2) === '${') {
          let d = 1
          let k = j + 2
          while (k < src.length && d > 0) { if (src[k] === '{') d += 1; else if (src[k] === '}') d -= 1; k += 1 }
          j = k
          continue
        }
        out[j] = ' '
        j += 1
      }
      i = j + 1
    } else i += 1
  }
  return out.join('')
}

/**
 * The source span of the object literal that encloses the property at `index`, found by
 * matching braces outwards over the masked source. Counting braces is the only way to tell a
 * route's own properties from its children's, and the children are what a nearest-literal
 * search picks up instead. Returns null when the braces do not balance, so the caller treats
 * the route as unresolved and keeps the mutant rather than dropping it on a parse it does not
 * trust.
 */
export function enclosingObject(src, index, masked = maskCode(src)) {
  let depth = 0, start = -1
  for (let i = index; i >= 0; i -= 1) {
    if (masked[i] === '}') depth += 1
    else if (masked[i] === '{') {
      if (depth === 0) { start = i; break }
      depth -= 1
    }
  }
  if (start < 0) return null
  let d = 0
  for (let i = start; i < masked.length; i += 1) {
    if (masked[i] === '{') d += 1
    else if (masked[i] === '}') { d -= 1; if (d === 0) return { start, end: i + 1 } }
  }
  return null
}

/**
 * What the route enclosing a guard property declares: its own path where that is a string
 * literal, and what its subtree renders, named either by component class or by the module a
 * `loadComponent` imports. Both are needed because a screen node carries the class that
 * renders it and the path of that class's file, but not the source location of the route entry
 * that declares it, and a route may name its component either way.
 */
export function guardedRoute(src, index) {
  const masked = maskCode(src)
  const span = enclosingObject(src, index, masked)
  if (span === null) return null
  const text = src.slice(span.start, span.end)
  const struct = masked.slice(span.start, span.end)
  let own = null
  let d = 0
  for (let i = 1; i < struct.length; i += 1) {
    const c = struct[i]
    if (c === '{' || c === '[') d += 1
    else if (c === '}' || c === ']') d -= 1
    else if (d === 0 && struct.startsWith('path:', i)) {
      const m = /^path:\s*(['"])([^'"]*)\1/.exec(text.slice(i))
      own = m ? m[2] : null
      break
    }
  }
  return {
    own,
    components: [...new Set([...text.matchAll(/\b([A-Z][A-Za-z0-9_$]*Component)\b/g)].map((m) => m[1]))],
    modules: [...new Set([...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))],
    lazy: /\bloadChildren\s*:/.test(struct),
    declaresTarget: /\b(?:component|loadComponent|loadChildren)\s*:/.test(struct) ||
      /\bchildren\s*:\s*\[\s*[^\]\s]/.test(struct),
  }
}

/**
 * The guards a `canActivate: [...]` text lists, as the extractor writes them on an edge, and
 * whether every element could be named. An identifier is its own name; a factory call
 * `f(args)` is written `f()`, without its arguments, which is why two guards of one factory
 * print alike. Anything else, an inline arrow function, a member access, a spread or a chained
 * call, is written from a hash or a source position the text does not give (a chain
 * `f(a).g(b)` is printed by the extractor as `f(a).g()`, which is no name this function can
 * rebuild from the call's head), so the list is then not `complete` and a guard an edge loses
 * cannot be attributed to the list by name.
 */
export function namedGuards(listText) {
  const open = listText.indexOf('[')
  const close = listText.lastIndexOf(']')
  if (open < 0 || close < open) return { names: [], complete: false }
  const inner = listText.slice(open + 1, close)
  const masked = maskCode(inner)
  const elements = []
  let depth = 0
  let from = 0
  for (let i = 0; i <= masked.length; i += 1) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    else if ((c === ',' && depth === 0) || i === masked.length) {
      const el = inner.slice(from, i).trim()
      if (el) elements.push(el)
      from = i + 1
    }
  }
  const names = []
  let complete = elements.length > 0
  for (const el of elements) {
    const call = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(el)
    if (/^[A-Za-z_$][\w$]*$/.test(el)) names.push(el)
    else if (call && closesAtEnd(maskCode(el), call[0].length - 1)) names.push(`${call[1]}()`)
    else complete = false
  }
  return { names, complete }
}

/**
 * Whether the parenthesis at `open` in `masked` is closed by the last character of the text, so
 * that the call it opens is the whole element and nothing, a further member or call, follows it.
 */
function closesAtEnd(masked, open) {
  let depth = 0
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1
    else if (masked[i] === ')') {
      depth -= 1
      if (depth === 0) return i === masked.length - 1
    }
  }
  return false
}

/**
 * Whether some edge lost a guard it carried, from the `guardChanged` lines the mutation
 * harness records ("<from> -> <to>: guard <before>-><after>, modality ..."). Guards are counted
 * rather than looked up, because a factory prints without its arguments and a route can carry
 * several that print alike. With `only`, the names of the guards the removed list names, the lost
 * guard has to be one of them: an edge that lost some other guard is a different change, not a
 * detection. Without it any lost guard counts.
 */
export function lostGuard(guardChanged, only = null) {
  const count = (list, x) => list.filter((y) => y === x).length
  return guardChanged.some((c) => {
    const g = /: guard (.*)->(.*), modality /.exec(c)
    if (!g) return false
    const before = (g[1] ?? '').split(',')
    const after = (g[2] ?? '').split(',')
    return before.some((x) => x !== 'null' && (only === null || only.includes(x)) && count(after, x) < count(before, x))
  })
}
