// Import + property resolution helpers for the Angular adapter: resolve relative
// import specifiers and imported identifiers to in-project source files, read
// dynamic-import loaders, and read string/identifier properties off route object
// literals. Shared by routes/templates extraction.

import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph'
import type { EnumDeclaration, ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { dirname, join, resolve } from 'node:path'

// The empty candidate comes last: a `paths` target names its file with the extension
// (`src/public-api.ts`), and trying it earlier could change what a specifier already resolves to.
const RESOLVE_EXTS = ['.ts', '.js', '/index.ts', '/index.js', '']

/**
 * Resolve an import specifier to an in-project source file by trying extensions. A relative
 * specifier is joined to the importing file; any other is a first-party alias or a path under
 * `baseUrl`, so it is looked up in the tsconfig `paths` map first, as TypeScript does, and then
 * against `baseUrl` itself. Without the `paths` step a scoped import of the workspace's own
 * code (`@scope/app/feature`) names no file, and every route behind it is unreachable.
 */
export function resolveRelative(sf: SourceFile, specifier: string): SourceFile | undefined {
  const project = sf.getProject()
  // A workspace that sets tsconfig `baseUrl` imports its own modules without a leading dot
  // (`resource/cluster/module`). Those are first-party files, not packages, so resolve them
  // against baseUrl before giving up — otherwise every lazy route behind one is unreachable.
  // `paths` targets are resolved against `baseUrl` too, which is where TypeScript puts them.
  const { baseUrl, paths } = project.getCompilerOptions()
  const bases = specifier.startsWith('.')
    ? [join(dirname(sf.getFilePath()), specifier)]
    : baseUrl
      ? [...pathsTargets(paths, specifier).map((t) => join(baseUrl, t)), join(baseUrl, specifier)]
      : []
  for (const base of bases) {
    for (const ext of RESOLVE_EXTS) {
      const found = project.getSourceFile(base + ext)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Whether `file` lies inside directory `dir`, tested on a path boundary. Both project-boundary
 * guards used to be a bare `file.startsWith(dir)`, which also accepts a SIBLING whose name merely
 * extends the directory's (`apps/web-extension` against `apps/web`), so the guard that exists to
 * keep another application's files out let that application's files through. `dir` is resolved
 * first so a relative or trailing-slash directory compares the way the absolute file paths do.
 */
export function isInsideDir(file: string, dir: string): boolean {
  const root = resolve(dir)
  return file.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/**
 * The targets a tsconfig `paths` alias sends `specifier` to, with whatever a `*` captured
 * substituted into each. An exact key wins; otherwise the `*` key with the longest literal
 * prefix does, which is TypeScript's own rule, so `@scope/lib/sub` reaches its own entry rather
 * than the `@scope/lib/*` one beside it. Returns no targets when no key matches.
 */
function pathsTargets(paths: Record<string, string[]> | undefined, specifier: string): string[] {
  let best: string[] = []
  let bestPrefix = -1
  for (const [key, targets] of Object.entries(paths ?? {})) {
    const star = key.indexOf('*')
    if (star < 0) {
      if (key === specifier) return targets
      continue
    }
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (prefix.length <= bestPrefix) continue
    if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
    const captured = specifier.slice(prefix.length, specifier.length - suffix.length)
    best = targets.map((t) => t.replace('*', () => captured))
    bestPrefix = prefix.length
  }
  return best
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

/**
 * The file a `loadChildren` arrow names WITHOUT a dynamic import — `() => VaultModule`, which
 * Angular also accepts. Returning only `import()` specifiers left every route behind such a
 * loader unreachable, and with it the whole subtree.
 */
export function lazyIdentifierTarget(sf: SourceFile, prop: ObjectLiteralExpression, name: string): SourceFile | undefined {
  const p = prop.getProperty(name)
  if (!p || !Node.isPropertyAssignment(p)) return undefined
  const init = p.getInitializer()
  if (!init || !Node.isArrowFunction(init)) return undefined
  const body = init.getBody()
  const id = Node.isIdentifier(body) ? body.getText() : null
  return id ? resolveImportedFile(sf, id) : undefined
}

/** Pick the @Component-decorated class name of a source file (default export or first), or null. */
export function componentClassName(sf: SourceFile): string | null {
  for (const cls of sf.getClasses()) {
    if (cls.getDecorators().some((d) => d.getName() === 'Component')) return cls.getName() ?? null
  }
  return null
}

/**
 * The property of `obj` called `name`, whether the key is written bare, quoted or as a constant
 * computed key. `getProperty(name)` compares against `getName()`, which keeps a quoted key's
 * quotes and a computed key's brackets, so it answers undefined for `{ "path": 'quoted' }`: that
 * route was neither minted nor counted as unreadable, so the route set claimed a completeness it
 * did not have and a live link into the address was published as a dead one. Every read that
 * decides what a route object IS goes through this, so one spelling of a key cannot make a route
 * invisible to the walk while another makes it visible.
 */
export function propNamed(obj: ObjectLiteralExpression, name: string) {
  return obj.getProperty((p) => {
    if (!Node.isPropertyAssignment(p) && !Node.isShorthandPropertyAssignment(p)) return false
    const key = p.getNameNode()
    return Node.isStringLiteral(key) ? key.getLiteralValue() === name : key.getText().replace(/^\[|\]$/g, '').replace(/^['"`]|['"`]$/g, '') === name
  })
}

/** Read a string-literal property value from a route object literal, or null. */
export function stringProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = propNamed(obj, name)
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
 * has no literal path, so no screen is minted for it at all. A template literal reads as the
 * concatenation of its parts when each substitution is itself such a string: bitwarden declares
 * `path: `:vaultId/${MY_ITEMS_ROUTE}``, and without that branch the three routes written that
 * way are unreadable, which is what made its node coverage read as 100%. One span that is not a
 * constant string makes the whole template unreadable, never a guess. Returns null for anything
 * that is not a compile-time string reachable from the files in the project.
 */
export function constantString(expr: Node | undefined): string | null {
  if (!expr) return null
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue()
  if (Node.isAsExpression(expr) || Node.isParenthesizedExpression(expr) || Node.isSatisfiesExpression(expr)) return constantString(expr.getExpression())
  // `$localize`:kebab-case@@routes.about:about`` is a constant with a metadata block in front
  // of it; the path is the message that follows. Angular writes route segments this way when
  // they are translated, and reading only plain literals loses the whole route.
  if (Node.isTaggedTemplateExpression(expr) && /(^|\.)\$localize$/.test(expr.getTag().getText())) {
    const tpl = expr.getTemplate()
    // Both forms are needed: the RAW source says where the metadata block ends, because
    // getLiteralValue() has already turned `\\:` into `:` and the block can no longer be told
    // from the message; the COOKED value is what the message actually is, because that is
    // what Angular hands the translator.
    if (Node.isNoSubstitutionTemplateLiteral(tpl)) {
      const msg = stripI18nMeta(tpl.getText().replace(/^`|`$/g, ''), tpl.getLiteralValue())
      // A segment holding a space, a colon or an `@@` is not a path; reading it as one would
      // mint a screen at an address the application cannot have.
      return /[\s:]|@@/.test(msg) ? null : msg
    }
  }
  if (Node.isTemplateExpression(expr)) {
    let text = expr.getHead().getLiteralText()
    for (const span of expr.getTemplateSpans()) {
      const value = constantString(span.getExpression())
      if (value === null) return null
      text += value + span.getLiteral().getLiteralText()
    }
    return text
  }
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

/**
 * Drop Angular's i18n metadata block from a `$localize` message, given the raw source text. The
 * block opens with a leading colon and closes at the first colon that is not escaped
 * (`:kebab-case@@routes.about:about` leaves `about`); an escaped colon (`\:`) stays inside it.
 * The scan is Angular's own `findEndOfBlock`: walk forward and, on a backslash, skip the
 * character it escapes. Testing the previous character instead misreads the closing colon of
 * `:meta\\:text` as escaped, because there the backslash escapes another backslash, so the scan
 * ran past it and returned a shorter, wrong message. A block that never closes is returned
 * whole; it holds a colon, and the caller refuses a segment that does.
 */
function stripI18nMeta(raw: string, cooked: string): string {
  if (!cooked.startsWith(':')) return cooked
  // Angular's findEndOfBlock walks the cooked and raw strings in step: a backslash in RAW
  // skips the next raw character, and the block marker is tested on COOKED. Both halves
  // matter. Testing the raw string instead closed the block in the wrong place when an
  // escaped backslash preceded the real closing colon; returning the raw remainder instead
  // of the cooked one minted `/ab\\ncd` for a message that is really two lines, which the
  // caller would have refused as a path had it been given what Angular produces.
  for (let c = 1, r = 1; c < cooked.length; c++, r++) {
    if (raw[r] === '\\') r++
    else if (cooked[c] === ':') return cooked.slice(c + 1)
  }
  // No closing colon at all: the whole literal is a malformed block, not a path.
  return cooked
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
    // A field written again anywhere in the class is state, whatever its initializer looks
    // like, and it can be written in more ways than an assignment to `this.x`: through object
    // or array destructuring, or by `Object.assign(this, …)`. Enumerating the spellings is how
    // the first version of this guard was got wrong, so the set of written names is collected
    // from the whole class instead and the test is a membership check.
    const written = writtenNames(cls)
    if (written === 'all' || written.has(name)) continue
    const stable = prop.isReadonly() || prop.isStatic() || Node.isIdentifier(init) || Node.isPropertyAccessExpression(init)
    if (stable) return init
  }
  return undefined
}

/** The array literal an identifier or property-access chain ultimately names, or undefined. */
export function arrayLiteralOf(expr: Node | undefined): Node | undefined {
  if (!expr) return undefined
  if (Node.isAsExpression(expr) || Node.isParenthesizedExpression(expr) || Node.isSatisfiesExpression(expr)) return arrayLiteralOf(expr.getExpression())
  if (Node.isArrayLiteralExpression(expr)) return expr
  if (Node.isIdentifier(expr)) return arrayLiteralOf(declaredInitializer(expr))
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = objectLiteralOf(expr.getExpression())
    const prop = obj?.getProperty(expr.getName())
    return prop && Node.isPropertyAssignment(prop) ? arrayLiteralOf(prop.getInitializer()) : undefined
  }
  return undefined
}

/**
 * The object literal an identifier or property-access chain ultimately names, or undefined. A
 * call is followed only when its callee is a freeze: the one wrapper known to hand its argument
 * back unchanged, which is what lets a route table written `Object.freeze({...})` be read at all.
 * A shared route table is often wrapped that way (bitwarden writes
 * `export const AuthRoute = Object.freeze({...})`), the wrapper is transparent for reading a path
 * out of the table, and not following it left 27 of bitwarden's declared paths as unresolvable
 * expressions (`AuthRoute.Login`) when the literal was one call away, in both tools, so they
 * agreed about screens neither could see. Following any one-argument call instead is wrong,
 * because `f(x)` returns whatever f builds from x and not x itself: `writtenNames` reads the
 * argument of `Object.assign(this, f(x))` through this function, so following `f` would read x's
 * keys as the fields written and leave the field `f` actually writes untrusted-as-state, which
 * draws a must edge to a stale initializer. The callee's name therefore decides, and nothing but
 * a freeze is followed.
 */
export function objectLiteralOf(expr: Node): ObjectLiteralExpression | undefined {
  if (Node.isCallExpression(expr)) {
    const args = expr.getArguments()
    const only = args[0]
    return args.length === 1 && only && FREEZE_CALLEE.test(expr.getExpression().getText()) ? objectLiteralOf(only) : undefined
  }
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
  const prop = propNamed(obj, name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (init && Node.isIdentifier(init)) return init.getText()
  return null
}

/**
 * Every property name a class assigns to, by any spelling: `this.x = …` and each compound form
 * of it (`+=`, `??=`, `||=`, `&&=`), the same through a local that holds `this`
 * (`const self = this`), a destructuring target that contains `this.x`, and
 * `Object.assign(this, { x })` with the key written bare, quoted or as a constant computed
 * name. A name in this set is state and its initializer says nothing about what the field holds
 * when a template reads it. A write whose target cannot be named, such as a computed key known
 * only at run time, taints the whole class ('all'): it writes some field and which one is
 * unknown, so a lost edge is the price and a wrong must edge is not.
 */
function writtenNames(cls: Node): Set<string> | 'all' {
  const out = new Set<string>()
  const aliases = new Set<string>()
  const aliasFields = new Set<string>()
  /**
   * Whether `e` is the instance itself: `this`, a parenthesised or cast `this`, a local
   * declared as one, or a field the class assigned `this` to (`this.me = this`).
   */
  const isThis = (e: Node | undefined): boolean => {
    if (!e) return false
    if (e.getKind() === SyntaxKind.ThisKeyword) return true
    if (Node.isParenthesizedExpression(e) || Node.isAsExpression(e) || Node.isSatisfiesExpression(e)) return isThis(e.getExpression())
    if (Node.isPropertyAccessExpression(e)) return aliasFields.has(e.getName()) && isThis(e.getExpression())
    return Node.isIdentifier(e) && aliases.has(e.getText())
  }
  /** The string a computed key or element index names, or the UNREADABLE sentinel when only run time knows it. */
  const keyOf = (e: Node | undefined): string => {
    // A `let` or `var` can hold a different string by the time the write runs, so only a
    // binding that cannot be reassigned may be read as the one field this writes.
    if (e && Node.isIdentifier(e)) {
      const decl = e.getSymbol()?.getDeclarations()?.find((d) => Node.isVariableDeclaration(d))
      if (decl && Node.isVariableDeclaration(decl) && decl.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return UNREADABLE
    }
    return constantString(e) ?? UNREADABLE
  }
  /** Record every name that an assignment or destructuring target writes on the instance. */
  const fromTarget = (node: Node): void => {
    if (Node.isPropertyAccessExpression(node)) {
      if (isThis(node.getExpression())) out.add(node.getName())
      return
    }
    // `this['dest'] = …` writes the field as surely as `this.dest = …` does.
    if (Node.isElementAccessExpression(node)) {
      if (isThis(node.getExpression())) out.add(keyOf(node.getArgumentExpression()))
      return
    }
    if (Node.isObjectLiteralExpression(node)) {
      for (const p of node.getProperties()) {
        if (Node.isPropertyAssignment(p)) {
          const init = p.getInitializer()
          if (init) fromTarget(init)
        } else if (Node.isShorthandPropertyAssignment(p)) out.add(p.getName())
        // `({ ...this.dest } = cfg)` writes the field with whatever is left over.
        else if (Node.isSpreadAssignment(p)) fromTarget(p.getExpression())
      }
      return
    }
    if (Node.isArrayLiteralExpression(node)) {
      for (const el of node.getElements()) fromTarget(Node.isSpreadElement(el) ? el.getExpression() : el)
    }
  }
  // Matched by name and not by scope: a shadowing local of the same name only taints more, never less.
  for (const d of cls.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (isThis(d.getInitializer())) aliases.add(d.getName())
  }
  // A field can hold the instance too (`this.me = this`), and a write through it is a write.
  // Collected before the assignment walk below so that `this.me.dest = …` is seen as a write
  // of `dest` rather than of nothing.
  for (const b of cls.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const left = b.getLeft()
    if (b.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue
    if (Node.isPropertyAccessExpression(left) && isThis(left.getExpression()) && isThis(b.getRight())) aliasFields.add(left.getName())
  }
  // `for (this.dest of xs)` and `for (this.dest in o)` assign the field on every iteration
  // without ever being an assignment expression.
  for (const kind of [SyntaxKind.ForOfStatement, SyntaxKind.ForInStatement] as const) {
    for (const loop of cls.getDescendantsOfKind(kind)) {
      const init = loop.getInitializer()
      if (!Node.isVariableDeclarationList(init)) fromTarget(init)
    }
  }
  for (const b of cls.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    // Every assignment operator writes: `=`, the arithmetic forms, and the logical `??=`, `||=` and `&&=`.
    const op = b.getOperatorToken().getKind()
    if (op < SyntaxKind.FirstAssignment || op > SyntaxKind.LastAssignment) continue
    fromTarget(b.getLeft())
  }
  for (const call of cls.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    // Any call that takes `this` as its first argument can write any field of it. Matching
    // the literal text `Object.assign` missed an alias, and giving up quietly when the source
    // object could not be read let the initializer be trusted again -- both of which the
    // guard exists to prevent. An unreadable write of this shape means no field of the class
    // can be trusted, which is the safe answer rather than the convenient one.
    const [first, ...rest] = call.getArguments()
    if (!isThis(first)) continue
    if (rest.length === 0) continue
    for (const arg of rest) {
      const obj = Node.isObjectLiteralExpression(arg) ? arg : objectLiteralOf(arg)
      if (!obj || !Node.isObjectLiteralExpression(obj)) return 'all'
      for (const p of obj.getProperties()) {
        if (Node.isShorthandPropertyAssignment(p)) out.add(p.getName())
        else if (Node.isPropertyAssignment(p)) {
          // `getName()` keeps a quoted key's quotes and a computed key's brackets, so read the key off its name node.
          const key = p.getNameNode()
          if (Node.isComputedPropertyName(key)) out.add(keyOf(key.getExpression()))
          else out.add(Node.isStringLiteral(key) ? key.getLiteralValue() : key.getText())
        } else return 'all'
      }
    }
  }
  if (out.has(UNREADABLE)) return 'all'
  return out
}

/** The callee names `objectLiteralOf` follows: a freeze returns the object it was given. */
const FREEZE_CALLEE = /^(Object\.freeze|freeze|deepFreeze)$/

/** Stands for a write whose target name could not be read; it taints the whole class. */
const UNREADABLE = '\u0000unreadable'
