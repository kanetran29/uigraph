// Resolve i18next translation KEYS to their real VALUES from the app's locale
// resource file, so a t('a.b.c') call names a control by what the user actually
// reads ("Open menu") instead of a humanized key fragment ("Open menu aria").
// Deterministic and best-effort: a missing/malformed/unresolvable locale file
// yields an empty map and every caller falls back to its existing
// humanize(key) behavior unchanged — this module never throws.

import { Node, SyntaxKind } from 'ts-morph'
import type { Project, SourceFile } from 'ts-morph'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** A conventional default-locale (English) resource path — covers CRA/react-i18next's
 *  `src/locales/en/translation.ts` (and its `index.ts` sibling) plus the common
 *  `src/i18n/en.*` layout. Cheapest possible discovery: the adapter's ts-morph project
 *  already loaded every project source file, so this just filters that list. */
const LOCALE_PATH_RE = /(^|\/)(locales\/en(\/(translation|index))?|i18n\/en)\.(ts|tsx|js|jsx|json)$/

/** Recursively collect every string-literal leaf of a plain nested object into `into`,
 *  keyed by its dotted path (`a.b.c`) — shared by the ts-morph object-literal reader and
 *  the JSON reader below so both locale-file shapes resolve identically. Non-string,
 *  non-object leaves (numbers, arrays, i18next plural/interpolation placeholders left
 *  inside a string) are either skipped or passed through as part of the string value. */
function collectStringLeaves(obj: unknown, prefix: string, into: Map<string, string>): void {
  if (typeof obj !== 'object' || obj === null) return
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key
    if (typeof val === 'string') into.set(path, val)
    else if (typeof val === 'object' && val !== null) collectStringLeaves(val, path, into)
  }
}

/** Evaluate a ts-morph literal expression into a plain JS value — string leaves and
 *  nested object literals only. Any non-literal property value (an expression, a
 *  function call, a spread, an identifier reference) is simply omitted rather than
 *  evaluated, since only static string leaves feed the key->value map. */
function evalObjectLiteral(node: Node): unknown {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue()
  if (!Node.isObjectLiteralExpression(node)) return undefined
  const out: Record<string, unknown> = {}
  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue
    const init = prop.getInitializer()
    if (!init) continue
    const key = prop.getNameNode().getText().replace(/^['"]|['"]$/g, '')
    const val = evalObjectLiteral(init)
    if (val !== undefined) out[key] = val
  }
  return out
}

/** The first top-level exported object literal in a locale module: `export const en =
 *  {...}` (react-i18next's usual resources shape) or `export default {...}`. */
function exportedObjectLiteral(sf: SourceFile): Node | undefined {
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (init && Node.isObjectLiteralExpression(init)) return init
  }
  const exportAssignment = sf.getDescendantsOfKind(SyntaxKind.ExportAssignment)[0]
  const expr = exportAssignment?.getExpression()
  return expr && Node.isObjectLiteralExpression(expr) ? expr : undefined
}

/** One located locale resource: a ts-morph-parsed module (object-literal leaves) or a
 *  plain JSON file (only reachable via an explicit override — the project's ts-morph
 *  glob never loads .json). */
type LocaleSource = { kind: 'module'; sf: SourceFile } | { kind: 'json'; absPath: string }

/** Locate the app's locale-resource file: an explicit override path first, else the
 *  first already-loaded project source file matching a conventional locale location.
 *  Never throws — an unresolvable override or no conventional match yields undefined. */
function locateLocaleFile(project: Project, projectDir: string, i18nFile?: string): LocaleSource | undefined {
  if (i18nFile !== undefined) {
    const abs = isAbsolute(i18nFile) ? i18nFile : join(projectDir, i18nFile)
    if (abs.endsWith('.json')) return existsSync(abs) ? { kind: 'json', absPath: abs } : undefined
    const sf = project.getSourceFile(abs) ?? project.addSourceFileAtPathIfExists(abs)
    return sf ? { kind: 'module', sf } : undefined
  }
  const sf = project.getSourceFiles().find((f) => LOCALE_PATH_RE.test(f.getFilePath()))
  return sf ? { kind: 'module', sf } : undefined
}

/**
 * Build the dotted-path -> translated-string map for the app's locale file, so i18n
 * key resolution (a `t('a.b.c')` call or `<Trans i18nKey>`) can use the real translated
 * text instead of humanizing the key. Returns an empty map (never throws) when no
 * locale file is found or it fails to parse — every call site degrades to its existing
 * humanize(key) fallback unchanged.
 */
export function buildI18nMap(project: Project, projectDir: string, i18nFile?: string): Map<string, string> {
  const map = new Map<string, string>()
  const loc = locateLocaleFile(project, projectDir, i18nFile)
  if (loc === undefined) return map
  if (loc.kind === 'json') {
    try {
      collectStringLeaves(JSON.parse(readFileSync(loc.absPath, 'utf8')), '', map)
    } catch {
      // Malformed JSON: empty map, callers fall back to humanize(key).
    }
    return map
  }
  const obj = exportedObjectLiteral(loc.sf)
  if (obj !== undefined) collectStringLeaves(evalObjectLiteral(obj), '', map)
  return map
}
