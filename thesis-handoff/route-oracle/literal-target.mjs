/**
 * Whether the extractor can build a route pattern from a navigation construct's target text: a
 * plain routerLink attribute, a bound array of quoted parts and simple variables, or a call whose
 * first argument is a quoted string or an array starting with one. Shared by loss-breakdown.mjs,
 * which files a construct with a non-literal target as CONSTANT_TARGET, and compare.mjs, which
 * counts the attribution-class constructs that would fall in that class under a target-first order.
 */
export const isLiteralTarget = (c) => {
  const t = c.target
  if (c.kind === 'routerLink') {
    // plain attribute routerLink="/a/b" is a literal; a bound array of quoted parts plus
    // simple variables is literal enough for the extractor to build a pattern.
    if (!/^\s*\[/.test(t) && !/[.()]/.test(t)) return true
    return !/\b[a-zA-Z_]\w*\.(?!id\b|slug\b|username\b|name\b)\w+/.test(t.replace(/'[^']*'|"[^"]*"/g, ''))
  }
  return /^\s*\[\s*['"`]/.test(t) || /^\s*['"`]/.test(t)
}
