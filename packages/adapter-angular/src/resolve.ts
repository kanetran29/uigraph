// Import + property resolution helpers for the Angular adapter: resolve relative
// import specifiers and imported identifiers to in-project source files, read
// dynamic-import loaders, and read string/identifier properties off route object
// literals. Shared by routes/templates extraction.

import { Node, SyntaxKind } from 'ts-morph'
import type { ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { dirname, join } from 'node:path'

const RESOLVE_EXTS = ['.ts', '.js', '/index.ts', '/index.js']

/** Resolve a relative import specifier to an in-project source file by trying extensions. */
export function resolveRelative(sf: SourceFile, specifier: string): SourceFile | undefined {
  const project = sf.getProject()
  // A workspace that sets tsconfig `baseUrl` imports its own modules without a leading dot
  // (`resource/cluster/module`). Those are first-party files, not packages, so resolve them
  // against baseUrl before giving up — otherwise every lazy route behind one is unreachable.
  const baseUrl = project.getCompilerOptions().baseUrl
  const bases = specifier.startsWith('.')
    ? [join(dirname(sf.getFilePath()), specifier)]
    : baseUrl
      ? [join(baseUrl, specifier)]
      : []
  for (const base of bases) {
    for (const ext of RESOLVE_EXTS) {
      const found = project.getSourceFile(base + ext)
      if (found) return found
    }
  }
  return undefined
}

/** Resolve a component/guard identifier to its backing source file via imports. */
export function resolveImportedFile(sf: SourceFile, name: string): SourceFile | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const matches =
      imp.getDefaultImport()?.getText() === name ||
      imp.getNamedImports().some((n) => n.getName() === name || n.getAliasNode()?.getText() === name)
    if (!matches) continue
    return imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
  }
  return undefined
}

/**
 * Extract the import specifier string from a lazy loader arrow function such as
 * `() => import('./x.component')`, returning `'./x.component'`, or null when the
 * initializer is not a recognizable dynamic-import loader.
 */
export function lazyImportSpecifier(prop: ObjectLiteralExpression, name: string): string | null {
  const p = prop.getProperty(name)
  if (!p || !Node.isPropertyAssignment(p)) return null
  const init = p.getInitializer()
  if (!init || !Node.isArrowFunction(init)) return null
  for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const arg = call.getArguments()[0]
    if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue()
  }
  return null
}

/** Pick the @Component-decorated class name of a source file (default export or first), or null. */
export function componentClassName(sf: SourceFile): string | null {
  for (const cls of sf.getClasses()) {
    if (cls.getDecorators().some((d) => d.getName() === 'Component')) return cls.getName() ?? null
  }
  return null
}

/** Read a string-literal property value from a route object literal, or null. */
export function stringProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue()
  return constantString(init)
}

/**
 * Follow an identifier or property-access chain to the string constant it names, so a route
 * declared as `path: internalRoutes.account.path` reads the same as `path: 'account'`. A
 * workspace that keeps its route paths in one table is otherwise invisible: the route object
 * has no literal path, so no screen is minted for it at all. Returns null for anything that
 * is not a compile-time string reachable from the files in the project.
 */
export function constantString(expr: Node | undefined): string | null {
  if (!expr) return null
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue()
  if (Node.isAsExpression(expr) || Node.isParenthesizedExpression(expr) || Node.isSatisfiesExpression(expr)) return constantString(expr.getExpression())
  if (Node.isIdentifier(expr)) return constantString(declaredInitializer(expr))
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = objectLiteralOf(expr.getExpression())
    const prop = obj?.getProperty(expr.getName())
    return prop && Node.isPropertyAssignment(prop) ? constantString(prop.getInitializer()) : null
  }
  return null
}

/** The object literal an identifier or property-access chain ultimately names, or undefined. */
export function objectLiteralOf(expr: Node): ObjectLiteralExpression | undefined {
  if (Node.isAsExpression(expr) || Node.isParenthesizedExpression(expr) || Node.isSatisfiesExpression(expr)) return objectLiteralOf(expr.getExpression())
  if (Node.isObjectLiteralExpression(expr)) return expr
  if (Node.isIdentifier(expr)) {
    const init = declaredInitializer(expr)
    return init ? objectLiteralOf(init) : undefined
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = objectLiteralOf(expr.getExpression())
    const prop = obj?.getProperty(expr.getName())
    const init = prop && Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
    return init ? objectLiteralOf(init) : undefined
  }
  return undefined
}

/** The initializer of the variable an identifier resolves to, following imports within the project. */
function declaredInitializer(id: Node): Node | undefined {
  const sym = id.getSymbol()
  for (const decl of sym?.getAliasedSymbol()?.getDeclarations() ?? sym?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(decl)) return decl.getInitializer()
    if (Node.isExportSpecifier(decl) || Node.isImportSpecifier(decl)) {
      const nameNode = decl.getNameNode()
      if (nameNode !== id) return declaredInitializer(nameNode)
    }
  }
  return undefined
}

/** Read an identifier property value (e.g. `component: HomeComponent`), or null. */
export function identifierProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (init && Node.isIdentifier(init)) return init.getText()
  return null
}
