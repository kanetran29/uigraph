import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression, ClassDeclaration, SourceFile } from 'ts-morph'
import { declarationsOf } from './resolve'
import { inlineTemplate } from './templates'

/** A member of a class: `<file>#<Class>.<member>`, with `constructor` for the constructor. */
export type MemberKey = string

export interface MemberScopes {
  /** Screens each member runs on, for every member the graph reaches from a component. */
  screens: Map<MemberKey, Set<string>>
  /** Members reached from the shell, which run on every screen. */
  top: Set<MemberKey>
  /**
   * Members a caller the graph cannot see may also reach: whatever runs from a member that
   * nothing seeded, nothing in the graph and no template calls (a constructor the injector runs,
   * a guard or interceptor the router runs, a function that injects a service by itself), and
   * whatever those call in turn. Their scope is at least what the graph gives and may be wider.
   */
  unseen: Set<MemberKey>
  /**
   * How the calls on an application-declared type were resolved, for the measurement of
   * Section 5: to the class itself, through a provider binding, or to the subclasses of an
   * abstract class; and, apart, those on a type nothing implements. A call is counted only where
   * it lands on a member some application class declares: a method a framework class supplies
   * (an `HttpClient` bound to a subclass that adds none) is no call the graph followed.
   */
  resolved: { direct: number; bound: number; subclass: number; unresolved: number }
}

/** A call on a field written in a template: `field.method(`, not `a.field.method(`. */
const TEMPLATE_CALL = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/g

/** The members of a class a call can land on, by name. */
function memberNames(cls: ClassDeclaration): string[] {
  const out: string[] = cls.getConstructors().length > 0 ? ['constructor'] : []
  for (const m of cls.getMembers()) {
    if (Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m) || Node.isGetAccessorDeclaration(m) || Node.isSetAccessorDeclaration(m)) out.push(m.getName())
  }
  return out
}

/** The name a type annotation writes, `Foo` for `Foo<Bar>` and for `Foo | null`; an array or any other shape names no class. */
function typeRefName(t: Node | undefined): Node | undefined {
  if (!t) return undefined
  if (Node.isTypeReference(t)) return t.getTypeName()
  if (Node.isParenthesizedTypeNode(t)) return typeRefName(t.getTypeNode())
  if (Node.isUnionTypeNode(t)) return t.getTypeNodes().map(typeRefName).find((n) => n !== undefined)
  return undefined
}

/** Whether `n` is a call of `inject`. */
function isInjectCall(n: Node | undefined): n is CallExpression {
  return n !== undefined && Node.isCallExpression(n) && n.getExpression().getText() === 'inject'
}

/**
 * Member scopes for every class in `files`. `seeds` gives each component's screens, null for a
 * component the shell renders; every member of a component runs on its screens. The result is
 * the least fixpoint of the join along the call edges.
 *
 * Every name is resolved to the declaration it denotes, through imports and re-exports, never by
 * its text: two classes of one name in different files are two classes, a call in one never lands
 * on the other, and a type is never taken for a sibling application's namesake. `loaded`, when
 * given, is the set of files the application loads; a provider binding or an implementation of an
 * abstract class written in any other file is not read, since nothing there runs.
 */
export function memberScopes(files: SourceFile[], seeds: Map<string, Set<string> | null>, loaded?: ReadonlySet<string>): MemberScopes {
  const inApp = new Set(files.map((sf) => sf.getFilePath()))
  /** Whether the application loads the file `cls` is declared in. */
  const isLoaded = (cls: ClassDeclaration) => !loaded || loaded.has(cls.getSourceFile().getFilePath())
  /** Whether `d` is a class some file of the application declares, not a framework's. */
  const appClass = (d: Node): d is ClassDeclaration => Node.isClassDeclaration(d) && inApp.has(d.getSourceFile().getFilePath())
  /** The application classes `n` denotes. */
  const classesNamed = (n: Node | undefined): ClassDeclaration[] => declarationsOf(n).filter(appClass)
  /** What `n` stands for as an injection token: its class when it is one, else its declaration (an `InjectionToken` constant). */
  const tokenOf = (n: Node | undefined): Node | undefined => {
    const d = declarationsOf(n)
    return d.find((x) => Node.isClassDeclaration(x)) ?? d[0]
  }
  /** The key of the member `member` of `cls`. */
  const keyOf = (cls: ClassDeclaration, member: string): MemberKey => `${cls.getSourceFile().getFilePath()}#${cls.getName()}.${member}`

  const classes = files.flatMap((sf) => sf.getClasses().filter((c) => c.getName()))
  const bases = new Map<ClassDeclaration, ClassDeclaration | undefined>()
  /** The application class `cls` extends. */
  const baseOf = (cls: ClassDeclaration): ClassDeclaration | undefined => {
    if (!bases.has(cls)) bases.set(cls, classesNamed(cls.getExtends()?.getExpression())[0])
    return bases.get(cls)
  }

  // A binding whose value is no application class (`forwardRef(...)`, a conditional, a framework
  // class) is not read, so the token falls back to its own class and its subclasses.
  const bindings = new Map<Node, Set<ClassDeclaration>>()
  for (const sf of files) {
    if (loaded && !loaded.has(sf.getFilePath())) continue
    for (const el of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const value = (key: string) => { const x = el.getProperty(key); return x && Node.isPropertyAssignment(x) ? x.getInitializer() : undefined }
      const token = tokenOf(value('provide'))
      if (!token) continue
      for (const key of ['useClass', 'useExisting']) {
        const impl = classesNamed(value(key))[0]
        if (impl) bindings.set(token, new Set([...(bindings.get(token) ?? []), impl]))
      }
    }
  }
  const subclasses = new Map<Node, Set<ClassDeclaration>>()
  for (const cls of classes) {
    const base = isLoaded(cls) ? baseOf(cls) : undefined
    if (base) subclasses.set(base, new Set([...(subclasses.get(base) ?? []), cls]))
  }

  /** The classes a value whose declared token is `t` can be, and how that was decided. */
  const candidates = (t: Node): { classes: ClassDeclaration[]; how: 'direct' | 'bound' | 'subclass' } | null => {
    const own = appClass(t) && !t.isAbstract() ? [t] : []
    const bound = [...(bindings.get(t) ?? [])]
    // A binding can be overridden below the place it is written, so the token's own class stays a candidate.
    if (bound.length > 0) return { classes: [...new Set([...bound, ...own])], how: 'bound' }
    if (own.length > 0) return { classes: own, how: 'direct' }
    const subs = new Set<ClassDeclaration>()
    const stack = [...(subclasses.get(t) ?? [])]
    while (stack.length) { const s = stack.pop()!; if (!subs.has(s)) { subs.add(s); stack.push(...(subclasses.get(s) ?? [])) } }
    return subs.size > 0 ? { classes: [...subs], how: 'subclass' } : null
  }

  /** The member a call to `name` on `cls` lands on, walking up `extends`. */
  const lookup = (cls: ClassDeclaration, name: string, seen = new Set<ClassDeclaration>()): MemberKey[] => {
    if (seen.has(cls)) return []
    seen.add(cls)
    if (memberNames(cls).includes(name)) return [keyOf(cls, name)]
    const base = baseOf(cls)
    return base ? lookup(base, name, seen) : []
  }

  /** Declared tokens of a class's fields: constructor parameters, typed fields, `inject(T)` fields. */
  const fieldTypes = (cls: ClassDeclaration): Map<string, Node> => {
    const out = new Map<string, Node>()
    for (const ctor of cls.getConstructors()) for (const p of ctor.getParameters()) {
      const t = tokenOf(p.getDecorator('Inject')?.getArguments()[0]) ?? tokenOf(typeRefName(p.getTypeNode()))
      if (t) out.set(p.getName(), t)
    }
    for (const prop of cls.getProperties()) {
      const init = prop.getInitializer()
      const t = (isInjectCall(init) ? tokenOf(init.getArguments()[0]) : undefined) ?? tokenOf(typeRefName(prop.getTypeNode()))
      if (t) out.set(prop.getName(), t)
    }
    return out
  }

  /** The token a call's receiver is typed by: a field of the class, `inject(T)`, or a local or parameter initialised with it or declared of that type. */
  const receiverToken = (recv: Node, types: Map<string, Node>): Node | undefined => {
    if (Node.isPropertyAccessExpression(recv) && recv.getExpression().getKind() === SyntaxKind.ThisKeyword) return types.get(recv.getName())
    if (isInjectCall(recv)) return tokenOf(recv.getArguments()[0])
    if (!Node.isIdentifier(recv)) return undefined
    const decl = recv.getSymbol()?.getValueDeclaration()
    if (!decl || !(Node.isVariableDeclaration(decl) || Node.isParameterDeclaration(decl))) return undefined
    const init = Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined
    return (isInjectCall(init) ? tokenOf(init.getArguments()[0]) : undefined) ?? tokenOf(typeRefName(decl.getTypeNode()))
  }

  const edges = new Map<MemberKey, Set<MemberKey>>()
  const resolved = { direct: 0, bound: 0, subclass: 0, unresolved: 0 }
  /** Add a call edge from `from` to each of `targets`. */
  const link = (from: MemberKey, targets: MemberKey[]): void => {
    if (targets.length === 0) return
    const set = edges.get(from) ?? new Set<MemberKey>()
    for (const t of targets) set.add(t)
    edges.set(from, set)
  }
  /** Record a call to `callee` on a value of token `t`, made from `from`. */
  const callOn = (from: MemberKey, t: Node, callee: string): void => {
    const c = candidates(t)
    if (!c) { if (appClass(t) || bindings.has(t)) resolved.unresolved += 1; return }
    const targets = c.classes.flatMap((k) => lookup(k, callee))
    if (targets.length === 0) return
    resolved[c.how] += 1
    link(from, targets)
  }
  /** Record the calls of `calls` made from `from`, on `this` when `owner` is the class and on the receivers `types` names. */
  const follow = (from: MemberKey, calls: CallExpression[], owner: ClassDeclaration | undefined, types: Map<string, Node>): void => {
    for (const call of calls) {
      const e = call.getExpression()
      if (!Node.isPropertyAccessExpression(e)) continue
      const recv = e.getExpression()
      if (recv.getKind() === SyntaxKind.ThisKeyword) { if (owner) link(from, lookup(owner, e.getName())); continue }
      const t = receiverToken(recv, types)
      if (t) callOn(from, t, e.getName())
    }
  }

  for (const cls of classes) {
    const types = fieldTypes(cls)
    for (const member of cls.getMembers().filter((m) => Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m) || Node.isGetAccessorDeclaration(m) || Node.isSetAccessorDeclaration(m) || Node.isConstructorDeclaration(m))) {
      const from = keyOf(cls, Node.isConstructorDeclaration(member) ? 'constructor' : (member as { getName(): string }).getName())
      follow(from, member.getDescendantsOfKind(SyntaxKind.CallExpression), cls, types)
    }
    // A template calls a service by its field name; every member of a component runs on the
    // component's screens, so one member stands for the template.
    const entry = memberNames(cls)[0]
    if (entry === undefined || !cls.getDecorator('Component')) continue
    for (const m of inlineTemplate(cls.getSourceFile())?.text.matchAll(TEMPLATE_CALL) ?? []) {
      const t = types.get(m[1] ?? '')
      if (t) callOn(keyOf(cls, entry), t, m[2] ?? '')
    }
  }
  // Code outside any class (a functional guard, an interceptor, a helper) calls a service it injects or is handed.
  for (const sf of files) {
    follow(`${sf.getFilePath()}#<module>`, sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => !c.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)), undefined, new Map())
  }

  const screens = new Map<MemberKey, Set<string>>()
  const top = new Set<MemberKey>()
  const seeded = new Set<MemberKey>()
  const work: MemberKey[] = []
  const byFile = new Map<string, SourceFile>(files.map((sf) => [sf.getFilePath(), sf]))
  for (const [file, s] of seeds) for (const cls of byFile.get(file)?.getClasses() ?? []) for (const m of memberNames(cls)) {
    const key = `${file}#${cls.getName()}.${m}`
    if (s === null) top.add(key)
    else screens.set(key, new Set([...(screens.get(key) ?? []), ...s]))
    seeded.add(key)
    work.push(key)
  }
  while (work.length) {
    const from = work.pop()!
    for (const to of edges.get(from) ?? []) {
      if (top.has(to)) continue
      if (top.has(from)) { top.add(to); screens.delete(to); work.push(to); continue }
      const have = screens.get(to) ?? new Set<string>()
      const before = have.size
      for (const s of screens.get(from) ?? []) have.add(s)
      if (have.size !== before || !screens.has(to)) { screens.set(to, have); work.push(to) }
    }
  }

  // A member nothing calls and nothing seeds runs by a path the graph does not follow, and so
  // does everything it calls: its callees are reached from a scope that is not in `screens`.
  const called = new Set<MemberKey>([...edges.values()].flatMap((tos) => [...tos]))
  const unseen = new Set<MemberKey>()
  const roots = [...edges.keys()].filter((k) => !seeded.has(k) && !called.has(k))
  while (roots.length) for (const to of edges.get(roots.pop()!) ?? []) if (!unseen.has(to)) { unseen.add(to); roots.push(to) }
  return { screens, top, unseen, resolved }
}
