// The call graph of Section 3's model, at the granularity of class members.
//
// A navigation in a service runs on behalf of whatever calls the member that holds it, so its
// scope is the join of the screens of those callers, transitively, rather than of every
// component that injects the class. A call `this.f.g()` is resolved through the declared type of
// `f`: a constructor parameter, a typed field, or a field initialised with `inject(T)`. The type
// names a class, or a token that provider declarations bind to classes with `useClass` or
// `useExisting`; an abstract class no provider binds stands for its subclasses in the
// application. Bindings are read across the whole application, not per injector, so where two
// injectors bind a token differently the join covers both, which can only widen a scope.
import { Node, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration, SourceFile } from 'ts-morph'

/** A member of a class: `<file>#<Class>.<member>`, with `constructor` for the constructor. */
export type MemberKey = string

export interface MemberScopes {
  /** Screens each member runs on, for every member the graph reaches from a component. */
  screens: Map<MemberKey, Set<string>>
  /** Members reached from the shell, which run on every screen. */
  top: Set<MemberKey>
  /**
   * How the calls on an application-declared type were resolved, for the measurement of
   * Section 5: to the class itself, through a provider binding, to the subclasses of an abstract
   * class, or not at all (an abstract class with neither).
   */
  resolved: { direct: number; bound: number; subclass: number; unresolved: number }
}

/** The simple name a type annotation or `inject(...)` argument writes, `Foo` for `Foo<Bar>`. */
function typeName(text: string | undefined): string | undefined {
  return text ? /^([A-Za-z_$][\w$]*)/.exec(text.trim())?.[1] : undefined
}

/** The members of a class a call can land on, by name. */
function memberNames(cls: ClassDeclaration): string[] {
  const out: string[] = cls.getConstructors().length > 0 ? ['constructor'] : []
  for (const m of cls.getMembers()) {
    if (Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m) || Node.isGetAccessorDeclaration(m) || Node.isSetAccessorDeclaration(m)) out.push(m.getName())
  }
  return out
}

/**
 * Member scopes for every class in `files`. `seeds` gives each component's screens, null for a
 * component the shell renders; every member of a component runs on its screens. The result is
 * the least fixpoint of the join along the call edges.
 */
export function memberScopes(files: SourceFile[], seeds: Map<string, Set<string> | null>): MemberScopes {
  const byName = new Map<string, { file: string; cls: ClassDeclaration }[]>()
  for (const sf of files) for (const cls of sf.getClasses()) {
    const name = cls.getName()
    if (name) byName.set(name, [...(byName.get(name) ?? []), { file: sf.getFilePath(), cls }])
  }

  // Provider bindings, application-wide: `{ provide: T, useClass: X }` and `useExisting`.
  const bindings = new Map<string, Set<string>>()
  for (const sf of files) for (const p of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (p.getName() !== 'providers') continue
    const arr = p.getInitializer()
    if (!arr || !Node.isArrayLiteralExpression(arr)) continue
    for (const el of arr.getElements()) {
      if (!Node.isObjectLiteralExpression(el)) continue
      const value = (key: string) => { const x = el.getProperty(key); return x && Node.isPropertyAssignment(x) ? typeName(x.getInitializer()?.getText()) : undefined }
      const token = value('provide')
      for (const key of ['useClass', 'useExisting']) {
        const impl = value(key)
        if (token && impl) bindings.set(token, new Set([...(bindings.get(token) ?? []), impl]))
      }
    }
  }
  // Subclasses by base name, for an abstract class no provider binds.
  const subclasses = new Map<string, Set<string>>()
  for (const [name, list] of byName) for (const { cls } of list) {
    const base = typeName(cls.getExtends()?.getText())
    if (base) subclasses.set(base, new Set([...(subclasses.get(base) ?? []), name]))
  }

  /** The classes a value of declared type `t` can be, and how that was decided. */
  const candidates = (t: string): { names: string[]; how: 'direct' | 'bound' | 'subclass' } | null => {
    const bound = bindings.get(t)
    if (bound && bound.size > 0) return { names: [...bound], how: 'bound' }
    const own = byName.get(t)
    if (own?.some(({ cls }) => !cls.isAbstract())) return { names: [t], how: 'direct' }
    const subs = new Set<string>()
    const stack = [...(subclasses.get(t) ?? [])]
    while (stack.length) { const s = stack.pop()!; if (!subs.has(s)) { subs.add(s); stack.push(...(subclasses.get(s) ?? [])) } }
    if (subs.size > 0) return { names: [...subs], how: 'subclass' }
    return null
  }

  /** The member a call to `name` on a class named `cls` lands on, walking up `extends`. */
  const lookup = (cls: string, name: string, seen = new Set<string>()): MemberKey[] => {
    if (seen.has(cls)) return []
    seen.add(cls)
    const out: MemberKey[] = []
    for (const { file, cls: decl } of byName.get(cls) ?? []) {
      if (memberNames(decl).includes(name)) out.push(`${file}#${cls}.${name}`)
      else { const base = typeName(decl.getExtends()?.getText()); if (base) out.push(...lookup(base, name, seen)) }
    }
    return out
  }

  /** Declared types of a class's fields: constructor parameters, typed fields, `inject(T)` fields. */
  const fieldTypes = (cls: ClassDeclaration): Map<string, string> => {
    const out = new Map<string, string>()
    for (const ctor of cls.getConstructors()) for (const p of ctor.getParameters()) {
      const token = typeName(p.getDecorator('Inject')?.getArguments()[0]?.getText())
      const t = token ?? typeName(p.getTypeNode()?.getText())
      if (t) out.set(p.getName(), t)
    }
    for (const prop of cls.getProperties()) {
      const init = prop.getInitializer()
      const injected = init && Node.isCallExpression(init) && init.getExpression().getText() === 'inject' ? typeName(init.getArguments()[0]?.getText()) : undefined
      const t = injected ?? typeName(prop.getTypeNode()?.getText())
      if (t) out.set(prop.getName(), t)
    }
    return out
  }

  // Call edges, caller member -> callee members.
  const edges = new Map<MemberKey, Set<MemberKey>>()
  const resolved = { direct: 0, bound: 0, subclass: 0, unresolved: 0 }
  for (const [name, list] of byName) for (const { file, cls } of list) {
    const types = fieldTypes(cls)
    for (const member of cls.getMembers().filter((m) => Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m) || Node.isGetAccessorDeclaration(m) || Node.isSetAccessorDeclaration(m) || Node.isConstructorDeclaration(m))) {
      const from: MemberKey = `${file}#${name}.${Node.isConstructorDeclaration(member) ? 'constructor' : (member as { getName(): string }).getName()}`
      for (const call of member.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const e = call.getExpression()
        if (!Node.isPropertyAccessExpression(e)) continue
        const callee = e.getName()
        const recv = e.getExpression()
        let targets: MemberKey[] = []
        if (recv.getKind() === SyntaxKind.ThisKeyword) targets = lookup(name, callee)
        else {
          const t = Node.isPropertyAccessExpression(recv) && recv.getExpression().getKind() === SyntaxKind.ThisKeyword ? types.get(recv.getName())
            : Node.isCallExpression(recv) && recv.getExpression().getText() === 'inject' ? typeName(recv.getArguments()[0]?.getText())
            : undefined
          if (t === undefined) continue
          const c = candidates(t)
          // A type the application does not declare is the framework's or a library's, not a gap.
          if (!c) { if (byName.has(t) || bindings.has(t)) resolved.unresolved += 1; continue }
          resolved[c.how] += 1
          targets = c.names.flatMap((n) => lookup(n, callee))
        }
        if (targets.length === 0) continue
        const set = edges.get(from) ?? new Set<MemberKey>()
        for (const t of targets) set.add(t)
        edges.set(from, set)
      }
    }
  }

  // Seeds: every member of a component runs on the component's screens.
  const screens = new Map<MemberKey, Set<string>>()
  const top = new Set<MemberKey>()
  const work: MemberKey[] = []
  const byFile = new Map<string, SourceFile>(files.map((sf) => [sf.getFilePath(), sf]))
  for (const [file, s] of seeds) for (const cls of byFile.get(file)?.getClasses() ?? []) for (const m of memberNames(cls)) {
    const key = `${file}#${cls.getName()}.${m}`
    if (s === null) top.add(key)
    else screens.set(key, new Set([...(screens.get(key) ?? []), ...s]))
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
  return { screens, top, resolved }
}
