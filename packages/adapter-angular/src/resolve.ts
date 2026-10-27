// Import + property resolution helpers for the Angular adapter: resolve relative
// import specifiers and imported identifiers to in-project source files, read
// dynamic-import loaders, and read string/identifier properties off route object
// literals. Shared by routes/templates extraction.

import { Node, SyntaxKind } from 'ts-morph'
import type { EnumDeclaration, ObjectLiteralExpression, SourceFile } from 'ts-morph'
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
    if (prop && Node.isPropertyAssignment(prop)) return constantString(prop.getInitializer())
    // A route table is as often an enum as an object: `path: AuthRoute.Login`.
    const member = enumDeclarationOf(expr.getExpression())?.getMember(expr.getName())
    const value = member?.getValue()
    return typeof value === 'string' ? value : constantString(member?.getInitializer())
  }
  return null
}

/** The enum an identifier names, following imports within the project, or undefined. */
function enumDeclarationOf(expr: Node): EnumDeclaration | undefined {
  if (!Node.isIdentifier(expr)) return undefined
  const sym = expr.getSymbol()
  for (const decl of sym?.getAliasedSymbol()?.getDeclarations() ?? sym?.getDeclarations() ?? []) {
    if (Node.isEnumDeclaration(decl)) return decl
  }
  return undefined
}

/**
 * The string array an identifier or property-access chain ultimately names, or null. A route
 * table commonly ships the link beside the path (`routerLink: ['/blog']`), and a component
 * binds its template to that field, so the link is only readable through the chain.
 */
export function constantStringArray(expr: Node | undefined): string[] | null {
  if (!expr) return null
  if (Node.isAsExpression(expr) || Node.isParenthesizedExpression(expr) || Node.isSatisfiesExpression(expr)) return constantStringArray(expr.getExpression())
  if (Node.isIdentifier(expr)) return constantStringArray(declaredInitializer(expr))
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = objectLiteralOf(expr.getExpression())
    const prop = obj?.getProperty(expr.getName())
    return prop && Node.isPropertyAssignment(prop) ? constantStringArray(prop.getInitializer()) : null
  }
  if (!Node.isArrayLiteralExpression(expr)) return null
  const out: string[] = []
  for (const el of expr.getElements()) {
    const v = constantString(el)
    if (v === null) return null
    out.push(v)
  }
  return out
}

/**
 * Resolve a dotted name as a template or a call writes it — `cancelRoute`,
 * `publicRoutes.blog.routerLink`, `AuthRoute.Login`, `this.previewLocation` — to the constant
 * it names, as a string or an array of segments. The head is looked for among the component's
 * own fields, the file's module constants and its imports; each further segment is read off an
 * object literal or an enum. Returns null for a name whose value is only known at run time.
 */
export function constantForName(sf: SourceFile, text: string): string[] | string | null {
  const parts = text.replace(/^this\./, '').split('.')
  const head = parts.shift()
  if (!head || !/^[A-Za-z_$][\w$]*$/.test(head)) return null
  let node = headInitializer(sf, head)
  for (const seg of parts) {
    if (!node) return null
    const obj = objectLiteralOf(node)
    const prop = obj?.getProperty(seg)
    if (prop && Node.isPropertyAssignment(prop)) {
      node = prop.getInitializer()
      continue
    }
    const member = Node.isEnumDeclaration(node) ? node.getMember(seg) : undefined
    if (!member) return null
    const v = member.getValue()
    if (typeof v === 'string') return v
    node = member.getInitializer()
  }
  return constantStringArray(node) ?? constantString(node)
}

/**
 * The expression a route-table builder returns. A table that ships the link beside the path
 * commonly ships it as a function of the parameter —
 * `routerLink: (id) => ['/account', 'access', id, 'update']` — so the destination is written
 * out in full and only the parameter is unknown. Resolves `X.y.routerLink` through the
 * constant chain to that arrow and hands back what it returns.
 */
export function builderReturn(expr: Node | undefined): Node | undefined {
  if (!expr) return undefined
  let fn: Node | undefined
  if (Node.isIdentifier(expr)) fn = declaredInitializer(expr)
  else if (Node.isPropertyAccessExpression(expr)) {
    const obj = objectLiteralOf(expr.getExpression())
    const prop = obj?.getProperty(expr.getName())
    fn = prop && Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
  }
  if (!fn || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined
  const body = fn.getBody()
  if (!Node.isBlock(body)) return body
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement)
  return returns.length === 1 ? returns[0]?.getExpression() : undefined
}

/** Where a bare name can come from: a field of the component, a module constant, or an import. */
function headInitializer(sf: SourceFile, name: string): Node | undefined {
  const own = classPropertyInitializer(sf, name) ?? sf.getVariableDeclaration(name)?.getInitializer()
  if (own) return own
  const localEnum = sf.getEnum(name)
  if (localEnum) return localEnum
  for (const imp of sf.getImportDeclarations()) {
    const named = imp.getNamedImports().find((nn) => (nn.getAliasNode()?.getText() ?? nn.getName()) === name)
    if (!named) continue
    const dep = imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
    if (!dep) continue
    const real = named.getName()
    const init = dep.getVariableDeclaration(real)?.getInitializer() ?? dep.getEnum(real)
    if (init) return init
  }
  return undefined
}

/**
 * The initializer of a property on the component class in `sf`, by name — but only when the
 * property is one a navigation target can be read off. A field seeded with a literal
 * (`tag = 'x'`) is mutable state, and resolving it would turn a run-time value into a
 * must-edge. A field declared readonly or static, or one that merely points at a named
 * constant (`routerLinkBlog = publicRoutes.blog.routerLink`), is stable enough to follow.
 */
export function classPropertyInitializer(sf: SourceFile, name: string): Node | undefined {
  for (const cls of sf.getClasses()) {
    const prop = cls.getProperty(name)
    if (!prop || !Node.isPropertyDeclaration(prop)) continue
    const init = prop.getInitializer()
    if (!init) continue
    const stable = prop.isReadonly() || prop.isStatic() || Node.isIdentifier(init) || Node.isPropertyAccessExpression(init)
    if (stable) return init
  }
  return undefined
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
    // `const { update } = internalRoutes.account.subRoutes` names a property of the object it
    // destructures, so the value is that property, not the declaration's own initializer.
    if (Node.isBindingElement(decl)) {
      const pattern = decl.getParent()
      const vd = pattern?.getParent()
      const init = vd && Node.isVariableDeclaration(vd) ? vd.getInitializer() : undefined
      const prop = init ? objectLiteralOf(init)?.getProperty(decl.getName()) : undefined
      if (prop && Node.isPropertyAssignment(prop)) return prop.getInitializer()
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
