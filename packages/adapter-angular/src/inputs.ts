// Route-parameter → component-input binding analysis (Angular 16+
// `withComponentInputBinding()`). When that router feature is enabled, the router
// binds each route `:param`, each `data` entry, and resolved data to a component
// `@Input()` / signal `input()` of the SAME NAME. That is a DATA-FLOW relationship
// (param → input), not a navigation transition, so it is NOT a base GraphEdge — the
// golden invariant reserves base edges for witnessed transitions. Instead each
// witnessed binding is surfaced as a `route-input-binding` SOUNDINESS NOTE: a
// deterministic, fully-resolved fact carrying the component-file witness loc.
//
// SOUND scope (witness required): a binding is reported ONLY when (1) the project
// enables `withComponentInputBinding()` in a `provideRouter(...)` call — without it
// the runtime does no binding, so there is no witness — AND (2) a route source
// (a `:param` segment, or a static `data: { key }` key) name-matches a declared
// component input (decorator `@Input()`/`@Input('alias')` or signal
// `name = input(...)`). No match ⇒ no note (never invent a binding).

import { Node, SyntaxKind } from 'ts-morph'
import type { Project, SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import type { SoundinessNote } from '@uigraph/core'

/** A route whose component inputs we want to check for param/data bindings. */
export interface InputBindingRoute {
  fullPath: string
  componentFile: SourceFile | undefined
}

/** One declared component input: the binding NAME the router matches against (alias if present), plus its witness loc. */
interface ComponentInput {
  name: string
  loc: { line: number; col: number }
  kind: 'decorator' | 'signal'
}

/**
 * Whether the project enables route input binding, i.e. a `provideRouter(...)`
 * call (or any call) passes `withComponentInputBinding()` as an argument. This is
 * the global precondition: without it the router performs no param→input binding,
 * so no binding witness exists and nothing should be reported.
 */
export function hasComponentInputBinding(project: Project): boolean {
  for (const sf of project.getSourceFiles()) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression()
      if (Node.isIdentifier(callee) && callee.getText() === 'withComponentInputBinding') return true
    }
  }
  return false
}

/**
 * Read the `@Input()` name from a property's `Input` decorator, honoring an alias
 * argument (`@Input('alias')` binds as `alias`, not the field name). Returns the
 * binding name, or null when the property has no `Input` decorator.
 */
function decoratorInputName(prop: Node): string | null {
  if (!Node.isPropertyDeclaration(prop)) return null
  for (const dec of prop.getDecorators()) {
    if (dec.getName() !== 'Input') continue
    const arg = dec.getArguments()[0]
    if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue()
    return prop.getName()
  }
  return null
}

/**
 * Read a signal-input binding name from a property initialized with `input(...)`,
 * `input.required(...)`, or `input<T>(...)` (with or without an explicit alias in
 * the options object: `input(0, { alias: 'x' })`). Returns the binding name, or
 * null when the property is not a signal input.
 */
function signalInputName(prop: Node): string | null {
  if (!Node.isPropertyDeclaration(prop)) return null
  const init = prop.getInitializer()
  if (!init || !Node.isCallExpression(init)) return null
  const callee = init.getExpression()
  const isInput = (Node.isIdentifier(callee) && callee.getText() === 'input') || (Node.isPropertyAccessExpression(callee) && callee.getExpression().getText() === 'input' && callee.getName() === 'required')
  if (!isInput) return null
  for (const arg of init.getArguments()) {
    if (!Node.isObjectLiteralExpression(arg)) continue
    const aliasProp = arg.getProperty('alias')
    if (aliasProp && Node.isPropertyAssignment(aliasProp)) {
      const aliasInit = aliasProp.getInitializer()
      if (aliasInit && (Node.isStringLiteral(aliasInit) || Node.isNoSubstitutionTemplateLiteral(aliasInit))) return aliasInit.getLiteralValue()
    }
  }
  return prop.getName()
}

/** Collect every declared input (decorator + signal) of a component source file, by binding name. */
function componentInputs(sf: SourceFile): ComponentInput[] {
  const out: ComponentInput[] = []
  for (const cls of sf.getClasses()) {
    for (const prop of cls.getProperties()) {
      const decName = decoratorInputName(prop)
      if (decName !== null) {
        const lc = sf.getLineAndColumnAtPos(prop.getStart())
        out.push({ name: decName, loc: { line: lc.line, col: lc.column }, kind: 'decorator' })
        continue
      }
      const sigName = signalInputName(prop)
      if (sigName !== null) {
        const lc = sf.getLineAndColumnAtPos(prop.getStart())
        out.push({ name: sigName, loc: { line: lc.line, col: lc.column }, kind: 'signal' })
      }
    }
  }
  return out
}

/** The `:param` segment names declared in a route path (e.g. `/items/:id` → ['id']). */
function pathParamNames(fullPath: string): string[] {
  return fullPath
    .split('/')
    .filter((s) => s.startsWith(':') && s.length > 1)
    .map((s) => s.slice(1))
}

/**
 * One binding source on a route: a `:param` segment or a static `data: { key }`
 * entry. Both bind to a same-named component input; `kind` distinguishes them in
 * the emitted note so the data-flow origin is clear.
 */
interface BindingSource {
  name: string
  kind: 'param' | 'data'
}

/** The static `data: { key: ... }` keys declared on a route object, as data binding sources. */
function dataKeys(routeObj: Node | undefined): string[] {
  if (!routeObj || !Node.isObjectLiteralExpression(routeObj)) return []
  const dataProp = routeObj.getProperty('data')
  if (!dataProp || !Node.isPropertyAssignment(dataProp)) return []
  const init = dataProp.getInitializer()
  if (!init || !Node.isObjectLiteralExpression(init)) return []
  const out: string[] = []
  for (const p of init.getProperties()) {
    if (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)) out.push(p.getName())
  }
  return out
}

/**
 * Analyze witnessed route-input bindings across a project. Returns one
 * `route-input-binding` soundiness note per (route source → component input) pair
 * that name-matches, but ONLY when `withComponentInputBinding()` is enabled. Pure
 * static + deterministic: routes are processed in declaration order and each
 * route's sources in path-then-data order, so the same input yields identical
 * notes across runs. The optional `routeObjects` map supplies each route's object
 * literal so static `data` keys can be read as binding sources.
 */
export function analyzeInputBindings(
  project: Project,
  projectDir: string,
  routes: InputBindingRoute[],
  routeObjects: Map<string, Node>,
): SoundinessNote[] {
  if (!hasComponentInputBinding(project)) return []
  const out: SoundinessNote[] = []
  for (const route of routes) {
    if (!route.componentFile) continue
    const inputs = componentInputs(route.componentFile)
    if (inputs.length === 0) continue
    const inputByName = new Map(inputs.map((i) => [i.name, i]))
    const file = relative(projectDir, route.componentFile.getFilePath())
    const sources: BindingSource[] = [
      ...pathParamNames(route.fullPath).map((name): BindingSource => ({ name, kind: 'param' })),
      ...dataKeys(routeObjects.get(route.fullPath)).map((name): BindingSource => ({ name, kind: 'data' })),
    ]
    for (const src of sources) {
      const input = inputByName.get(src.name)
      if (!input) continue
      const inputDesc = input.kind === 'signal' ? 'signal input' : '@Input()'
      const origin = src.kind === 'param' ? `param ":${src.name}"` : `data key "${src.name}"`
      out.push({
        kind: 'route-input-binding',
        file,
        loc: input.loc,
        detail: `route ${route.fullPath} ${origin} binds to ${inputDesc} "${src.name}" via withComponentInputBinding()`,
      })
    }
  }
  return out
}
