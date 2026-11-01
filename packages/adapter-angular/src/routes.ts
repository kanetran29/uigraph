// Angular `Routes` config extraction: find top-level Routes-shaped array literals,
// recursively walk them (nested `children`, lazy `loadChildren`/`loadComponent`)
// into RouteInfo records — full path, node id, backing component file, and
// `canActivate` guard descriptors. Files reached via `loadChildren` are scanned
// only under their parent prefix.

import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, CallExpression, ExportDeclaration, ImportDeclaration, ObjectLiteralExpression, ParameterDeclaration, SourceFile, SpreadElement } from 'ts-morph'
import { routeToNodeId } from './ids'

/** Specs, stories and test doubles: they declare routes that are not the application's. */
const SPEC_FILE = /\.(spec|test|stories|cy)\.[tj]s$/
// A lazy target names a barrel, the barrel a feature module and the feature module its routing
// module, so the table a `loadChildren` mounts can sit three files from the one it names.
const LAZY_OWNER_HOPS = 3
// The files some route loads directly through its own `loadChildren`, and the arrays a spread
// already carries under a prefix, for the length of one `collectRoutes` call. Both are read five
// frames below the only place that can compute them, and threading them through a walk that
// already takes eleven arguments would say less about the analysis than it costs to read.
let directLazyTargets: Map<string, string> | undefined
let spreadConsumedArrays: Set<ArrayLiteralExpression> | undefined
let rootTableArrays: Set<ArrayLiteralExpression> | undefined
// The arm of a conditional the build does not take. Mounted nowhere, so the root scan must not
// mint it --- and the check that reports a claimed file the walk never reached must not count it
// either, or an arm that is dead in this build declares the route set a lower bound.
let unselectedArms: Set<ArrayLiteralExpression> | undefined
// Registration calls whose argument chooses between tables by a condition this reader cannot
// read. Both arms are claimed, so neither is minted at the root, and the route set is then a
// lower bound: without the note the graph was empty and said nothing.
let unreadableRegistrations: Set<CallExpression> | undefined
// The levels whose guards the router can run off a target's own chain (see `levelOf`), for the
// length of one `collectRoutes` call that asks for them.
let guardedLevels: RouteLevel[] | undefined
import { analyzeCanActivate, type GuardInfo } from './guards'
import { resolveImportedFile, lazyImportSpecifier, lazyIdentifierTarget, lazyMemberName, resolveRelative, isInsideDir, componentClassName, stringProp, identifierProp, objectLiteralOf, arrayLiteralOf, builderReturn, conditionalArrayArms, propNamed, keyUnreadable } from './resolve'

export interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
  guards: GuardInfo[]
  routeObj: ObjectLiteralExpression
  /**
   * Node id of the nearest ANCESTOR THAT IS A SCREEN, or null at the root. A componentless
   * route is a prefix and mints no node, so it is skipped here and its children are attached
   * to the screen above it; otherwise the route tree scope attribution walks would break at
   * every prefix.
   */
  parentNodeId: string | null
  /**
   * The routes from the root to this screen, each with what the router may run on it during a
   * navigation, so the guards a particular navigation runs can be told from those it does not.
   * A child at the empty path that the screen's own address resolves to is the last level.
   */
  levels: RouteLevel[]
  /**
   * Where a navigation to this screen's own address actually lands, when a child at the empty
   * path redirects it (`{ path: '', redirectTo: 'vault', pathMatch: 'full' }` under a layout):
   * Angular matches that child whenever the address is the layout's, so the layout is never
   * the destination there. Null when the redirect's target is not a string the reader can fix
   * (a function, a computed value): the screen is still never shown there.
   */
  redirectsTo?: string | null
}

/**
 * A redirect route, by the full path it is declared at: where it sends an address (null when its
 * `redirectTo` is not a string the reader can fix), whether it also answers every longer
 * address, as `pathMatch: 'prefix'`, Angular's default, does, and the routes from the root to it,
 * which say where in the tables the router meets it.
 */
export interface Redirect {
  to: string | null
  prefix: boolean
  levels: RouteLevel[]
}

/**
 * The route objects a walk could not turn into addresses, kept apart because they are different
 * losses: `paths` are routes whose own address could not be read (an unresolvable `path`, or a
 * `matcher` function), `subtrees` are routes whose `loadChildren` was dropped whole (it resolves
 * to no file, to no route array, or to one that cannot be told from another's). Each is a Set
 * keyed by the route object, not a counter: the same object is walked once per parent when it
 * sits in an array spread under several, and counting walks reported one hole as many.
 * `unplaced` is a third loss, keyed by FILE because no route object stands for it: a file the root
 * scan skips because a lazy or spread site claims it, that no walk places under a prefix, and
 * that the root scan would have minted routes from -- one a lazy module imports beside the routing
 * module that was elected, or one whose claiming site sits where the walk never reaches -- so
 * whatever it mounts is not in the route set.
 * `spreads` is a fourth, keyed by the spread node: a `...` whose expression the reader cannot
 * bring back to an array literal, which is what a route source built by a call looks like
 * (bitwarden spreads a helper that picks between two components by feature flag, ghostfolio
 * spreads a `.map` over a product list). Such a spread carries routes the walk never sees, and
 * skipping it in silence let the extractor assert a complete route set over a table it had not
 * read -- the one claim this tool must never make on its own blind spot.
 */
export interface UnreadableRoutes {
  paths: Set<ObjectLiteralExpression>
  subtrees: Set<ObjectLiteralExpression>
  unplaced: Set<SourceFile>
  spreads: Set<SpreadElement>
  calls: Set<CallExpression>
  outlets: Set<ObjectLiteralExpression>
}

/**
 * One route on the way from the root to a screen. Two screens share a level when they share the
 * route object, and a navigation between them reuses it: Angular then runs its canActivate and
 * resolvers again only when its parameters change, or always where runGuardsAndResolvers asks.
 */
export interface RouteLevel {
  /**
   * What stands for the route object at run time, which is what the router compares: the route
   * literal, or the call that returns it from a wrapper, because each call builds a new object.
   */
  obj: Node
  /** The route's full path, the addresses the router tries it at. */
  path: string
  /** Where the outermost route on a named outlet at or above this one is mounted; unset on the primary outlet. */
  aux?: string
  /** Whether the route's own path has a parameter, so a navigation that keeps it may change it. */
  params: boolean
  /** Whether runGuardsAndResolvers asks for more than a parameter change before running again. */
  always: boolean
  /** How many URL segments the route's own path consumes. */
  consumes: number
  /**
   * Whether runGuardsAndResolvers is left at the default, which also runs the route again when a
   * matrix parameter of a segment it or a route above it consumes changes; 'pathParamsChange' does not.
   */
  matrix: boolean
  canActivate: GuardInfo[]
  canActivateChild: GuardInfo[]
  canMatch: GuardInfo[]
  canLoad: GuardInfo[]
  canDeactivate: GuardInfo[]
  /** Whether the route declares resolvers, a title resolver among them, which the router awaits before it activates it. */
  resolve: boolean
}

/**
 * The level a route object contributes at `path`, standing for `identity` at run time. A level
 * whose guards the router can run off a target's own chain is also recorded in `guardedLevels`:
 * a canMatch or canLoad, which run on every route the router tries, and any guard or resolver of
 * a route on a named outlet, which an outlet opened or closed beside the primary one runs.
 */
function levelOf(sf: SourceFile, obj: ObjectLiteralExpression, path: string, aux?: string, identity: Node = obj): RouteLevel {
  const run = propNamed(obj, 'runGuardsAndResolvers')
  const runMode = stringProp(obj, 'runGuardsAndResolvers')
  const own = stringProp(obj, 'path') ?? ''
  const level: RouteLevel = {
    obj: identity,
    path,
    aux,
    params: own.split('/').some((seg) => seg.startsWith(':')),
    always: run !== undefined && runMode !== 'paramsChange' && runMode !== 'pathParamsChange',
    consumes: segments(own).length,
    matrix: runMode !== 'pathParamsChange',
    canActivate: canActivateGuards(sf, obj),
    canActivateChild: canActivateGuards(sf, obj, 'canActivateChild'),
    canMatch: canActivateGuards(sf, obj, 'canMatch'),
    canLoad: canActivateGuards(sf, obj, 'canLoad'),
    canDeactivate: canActivateGuards(sf, obj, 'canDeactivate'),
    resolve: propNamed(obj, 'resolve') !== undefined || titleResolves(obj),
  }
  const offChain = aux === undefined ? level.canMatch.length + level.canLoad.length > 0 : entryGuards([level]).length + level.canDeactivate.length > 0 || level.resolve
  if (offChain) guardedLevels?.push(level)
  return level
}

/**
 * Whether a route's `title` is a resolver. Angular awaits every title that is not a string (or
 * null) the way it awaits a resolver, so only a title the reader can bring back to a string is
 * static; a function, a class, or anything it cannot read is taken for a resolver, the safe side.
 */
function titleResolves(obj: ObjectLiteralExpression): boolean {
  const prop = propNamed(obj, 'title')
  if (!prop || stringProp(obj, 'title') !== null) return false
  return !stringValued(Node.isPropertyAssignment(prop) ? prop.getInitializer() : Node.isShorthandPropertyAssignment(prop) ? prop.getNameNode() : undefined)
}

/**
 * Whether an expression evaluates to a string or null: a string or template literal (a
 * `$localize` template included), a name or property followed to its initializer, or else what
 * the type checker says, where call or construct signatures make it a resolver.
 */
function stringValued(expr: Node | undefined, depth = 0): boolean {
  if (!expr || depth > 8) return false
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr) || Node.isTemplateExpression(expr) || Node.isTaggedTemplateExpression(expr) || Node.isNullLiteral(expr)) return true
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    const sym = expr.getSymbol()
    const decl = (sym?.getAliasedSymbol() ?? sym)?.getValueDeclaration()
    if (decl && (Node.isVariableDeclaration(decl) || Node.isPropertyAssignment(decl))) return stringValued(decl.getInitializer(), depth + 1)
  }
  const type = expr.getType()
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false
  return (type.isUnion() ? type.getUnionTypes() : [type]).every((m) => m.isString() || m.isStringLiteral() || m.isTemplateLiteral() || m.isNull() || m.isUndefined())
}

/** Every guard a chain of levels declares that can refuse entering it, as the screen's guard list has always held them. */
function entryGuards(levels: RouteLevel[]): GuardInfo[] {
  return levels.flatMap((l) => [...l.canActivate, ...l.canMatch, ...l.canActivateChild, ...l.canLoad])
}

/** The screens whose own address a child at the empty path already answers, in declaration order. */
const emptyPathAnswered = new WeakSet<RouteInfo>()

/**
 * Analyze a `canActivate: [A, B]` array, or the array of another guard property such as
 * `canMatch` or `canActivateChild`, into structured guard descriptors.
 * Covers class-reference guards, named functional guards (`[requireAuth]`), and
 * inline arrow guards (`[() => inject(X)...]`); the route's source file is needed
 * to resolve named functional-guard consts.
 */
function canActivateGuards(sf: SourceFile, obj: ObjectLiteralExpression, name = 'canActivate'): GuardInfo[] {
  const prop = propNamed(obj, name)
  if (!prop) return []
  const init = Node.isPropertyAssignment(prop) ? prop.getInitializer() : Node.isShorthandPropertyAssignment(prop) ? prop.getNameNode() : undefined
  const arr = arrayLiteralOf(init)
  if (arr && Node.isArrayLiteralExpression(arr)) return analyzeCanActivate(sf, arr.getElements())
  // A guard list the reader cannot bring back to an array still gates the route: refusing to
  // read a guard must never be the reason an edge is called deterministic.
  return [{ text: init?.getText() ?? name, kind: 'unreadable', async: false }]
}

/**
 * Join a parent route path with an own segment, normalizing to a leading-slash route.
 * A catch-all folds to the path `*`, but only at the root: a `**` inside a feature module
 * catches only that module's unmatched URLs, and folding it to `*` too made it
 * indistinguishable from the application's own catch-all, which then answered links from
 * anywhere and shadowed the real one.
 */
function joinRoutePath(parent: string, own: string): string {
  if (own === '**' || own === '*' || own === '/*') return parent === '/' ? '*' : `${parent}/*`
  const parentSegs = parent === '/' ? [] : segments(parent)
  const ownSegs = own.split('/').filter(Boolean)
  const all = [...parentSegs, ...ownSegs]
  return all.length === 0 ? '/' : '/' + all.join('/')
}

/** Split a route path into non-empty segments. */
function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/**
 * Whether an array literal is a route table: the initializer of a variable typed `Routes`, or,
 * unless `declaredOnly`, any array with an element object that carries a `path`. The shape test
 * is what lets a root scan find an application's routes however they are declared, and it is not
 * evidence of a route table (a menu, breadcrumb or form config has it too), so `declaredOnly`
 * drops it and accepts only what the author declared to the router. This is the one place that
 * says what a route array is: `findRouteArrays` recognises tables in a file by it and
 * `collectLoadChildrenTargets` decides by it whether a spread-resolved array is one, so the root
 * scan and the claim cannot disagree.
 */
function isRouteArray(arr: ArrayLiteralExpression, declaredOnly = false): boolean {
  const isRoutesTyped = arr.getParentIfKind(SyntaxKind.VariableDeclaration)?.getTypeNode()?.getText() === 'Routes'
  return isRoutesTyped || (!declaredOnly && arr.getElements().some((e) => Node.isObjectLiteralExpression(e) && propNamed(e, 'path') !== undefined))
}

/**
 * Whether a spread of this array puts routes under the spreading route's prefix: the question the
 * pre-pass claim has to answer, because the walk's spread branch recurses into whatever array it
 * resolves and mints whatever mounts something. Both of the narrower readings were tried and both
 * are wrong in a different direction. Claiming on the file of EVERY cross-file spread, as the
 * parent revision did, takes a component decorator's `imports: [...SHARED]` to be a route table.
 * Claiming on `isRouteArray` instead drops an array whose routes are one spread or one call
 * deeper, which the walk still mints under the prefix, so the root scan mints them a second time
 * unprefixed -- a node, and a must edge into it, at an address the application does not mount.
 * So: a `Routes`-typed array is accepted because its author declared it to the router, and
 * anything else only when some element actually mounts something, directly or through a nested
 * spread or call. A menu one spread deep, carrying `path` and no component, therefore claims
 * nothing, where the shape test claimed its whole FILE and took a real table in the same file out
 * of the root scan with it. `seen` stops an array that spreads itself.
 */
function spreadMintsRoutes(arr: ArrayLiteralExpression, seen = new Set<ArrayLiteralExpression>()): boolean {
  if (seen.has(arr)) return false
  seen.add(arr)
  if (isRouteArray(arr, true)) return true
  return arr.getElements().some((el) => {
    if (Node.isSpreadElement(el)) {
      const inner = arrayLiteralOf(el.getExpression())
      return inner !== undefined && Node.isArrayLiteralExpression(inner) && spreadMintsRoutes(inner, seen)
    }
    if (Node.isCallExpression(el)) return el.getArguments().some((a) => Node.isArrayLiteralExpression(a) && spreadMintsRoutes(a, seen))
    const obj = Node.isObjectLiteralExpression(el) ? el : objectLiteralOf(el)
    return obj !== undefined && propNamed(obj, 'path') !== undefined && MOUNTS.some((k) => propNamed(obj, k) !== undefined)
  })
}

/**
 * The properties that make a route object PLACE something under its prefix. `redirectTo` mints
 * no node and belongs here all the same: a redirect-only route registers a redirect, so refusing
 * to claim the array that carries it hands the file back to the root scan, which registers the
 * same redirect at the ROOT -- and a stale link to that root address then resolves through it
 * into a must edge, at a destination the source does not have.
 */
const MOUNTS = ['component', 'loadComponent', 'children', 'loadChildren', 'redirectTo']

/**
 * Find every top-level `Routes`-shaped array literal in a source file
 * (`const routes: Routes = [...]`, including a `default routes` export). Returns
 * the array literals so the caller can recurse into their route objects.
 *
 * A variable's array is kept when `isRouteArray` accepts it, and `declaredOnly` is handed to it
 * for a caller that must be sure the array is mounted because it is about to choose the owner of
 * a lazy prefix. The arguments of `RouterModule.forRoot` / `forChild` / `provideRouter` are found
 * as well, in either mode: the author declared them to the router.
 */
function findRouteArrays(sf: SourceFile, declaredOnly = false): ArrayLiteralExpression[] {
  const out: ArrayLiteralExpression[] = []
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (init && Node.isArrayLiteralExpression(init) && isRouteArray(init, declaredOnly)) out.push(init)
  }
  // `RouterModule.forChild([...])` / `forRoot([...])` / `provideRouter([...])` take the array
  // inline, with no variable to find it by. A module that registers its routes that way is
  // otherwise invisible, and with it every route the array declares.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!/(RouterModule\.(forRoot|forChild)|provideRouter)$/.test(call.getExpression().getText())) continue
    for (const arg of call.getArguments()) {
      if (Node.isArrayLiteralExpression(arg) && !out.includes(arg)) out.push(arg)
    }
  }
  return out
}

/**
 * The first-party file an import or re-export names. A relative specifier is read off the
 * declaration, as TypeScript resolves it; any other is looked up through `resolveRelative` ONLY,
 * which answers with a file already in the project. The declaration's own resolution is not used
 * for a non-relative specifier because it can land in `node_modules`, and a route array found
 * there is a package's, not the application's.
 */
function dependencyFile(decl: ImportDeclaration | ExportDeclaration, from: SourceFile, spec: string): SourceFile | undefined {
  const own = spec.startsWith('.') ? decl.getModuleSpecifierSourceFile() : undefined
  return own ?? resolveRelative(from, spec)
}

/**
 * Resolve a `loadChildren` target to the file that actually declares its routes.
 * An NgModule loaded lazily normally keeps its route array in a separate
 * `*-routing.module` that it imports rather than in the module file named by the
 * loader, so when the target declares none, its imports and re-exports (a barrel writes
 * `export * from './x.routes'`) are searched and the file that holds a route array is the owner.
 * Without this the route array is never reached under its parent prefix and is instead picked up
 * at the project root, which mints every one of its screens at its own relative path. The imports
 * followed include those written through a tsconfig `baseUrl` or `paths` alias
 * (`import { R } from 'app/reports/reports-routing.module'`): skipping every specifier without a
 * leading dot left mifos's reports routes unowned, so they were walked at the root and
 * `/reports/:filter` was minted as `/:filter`, a node that no application route has.
 *
 * The owner is taken only when EXACTLY ONE distinct file DECLARES a route array to the router
 * (see `findRouteArrays`' `declaredOnly`). A dependency's array counts as route-shaped when any
 * element has a `path`, which a breadcrumb or menu config also satisfies, so shape alone is no
 * evidence that the router reads it: a module that imports a shared module before its routing
 * module has two holders and picking the first minted the shared module's entries under the lazy
 * prefix (an address the application does not mount) while the real routes were lost, and a
 * module whose ONLY holder is a menu config had that menu elected owner outright. With two or
 * more declared holders there is no way to tell which one the router reads, and with none there
 * is nothing the router is known to read; either way nothing is walked and `arrays` is empty,
 * which the caller tallies as a blind spot. `claimed` is every file this target accounts for, a
 * shape-only holder and an ambiguous one included, so none of them is then also scanned from the
 * project root, where its entries would be minted at an address the application does not mount.
 * Claiming a shape-only holder beside an elected owner also takes it out of the only scan that
 * could have found it, and shape alone cannot say whether the router mounts it elsewhere. Whether
 * that cost anything is NOT decided here: `collectRoutes` compares every claim with what the walk
 * followed once the walk is over, which is the only point at which the answer is known, and one
 * place deciding it is why a holder carrying no mountable route can no longer be reported as a
 * loss from here while the comparison there says otherwise.
 *
 * A `Routes`-typed array is stronger evidence than shape, because its author declared it to the
 * router, but it is not evidence that THIS application mounts it, and the elected owner is not
 * required to lie inside the application. A lazy module whose only declared array is a sibling
 * application's `Routes` table, pulled in through a `baseUrl` specifier and used as data
 * (`POPUP_ROUTES.map((r) => r.path)`), is elected, and its entries are minted under the lazy
 * prefix with a must edge. The boundary is not applied because a lazy route reached legitimately
 * through a workspace alias lives outside `projectDir` (`@scope/feature` naming
 * `libs/feature/src/feature.routes.ts`), and a boundary would drop those routes with the phantom;
 * no application in the corpus elects an owner outside its own directory. The gap is known and
 * left open: the election proves the array is declared to a router, not that this one reads it.
 */
function lazyRouteOwner(target: SourceFile, routeFile?: SourceFile, lazyTargets?: Map<string, string>, member?: string | null): { owner: SourceFile; arrays: ArrayLiteralExpression[]; claimed: SourceFile[] } {
  // Where the route spells the member out AND that member is a route table, the table it takes is
  // not in doubt, so the search asks the name first. A file may export a table and also declare a
  // module that registers a different one, and the route named the table. Where the member is an
  // NgModule class --- the form five of the six corpus applications use --- the name resolves to
  // no array and the rules below decide, so this branch is what alfresco's folder-rules case
  // turns on and nothing else in the corpus. A table a feature library also hands to
  // `provideRouter` is mounted at the root AND under this prefix, and only the name tells the
  // two apart from a chain that merely reached the application's own root table.
  if (member) {
    const named = namedRouteArray(target, member, new Set())
    if (named) return { owner: named.getSourceFile(), arrays: [named], claimed: [named.getSourceFile()] }
  }
  const own = mountedArrays(target)
  // The table a `forChild` names is as often as not in another file, and that file is where the
  // root scan would find it, so it is claimed with the one the route names.
  if (own.length) return { owner: target, arrays: own, claimed: filesOf([target, ...own.map((a) => a.getSourceFile())]) }
  // A file holding more than one table, with nothing in it saying which this prefix gets, is
  // read no further: `mountedArrays` answers with none, and the hop search below then finds no
  // holder either, so the caller declares the subtree unread. Mounting every table the file
  // holds, which is what a bare shape scan did, gives each prefix every table and so mints the
  // cross product -- half of those addresses the application mounts nowhere.
  if (findRouteArrays(target).length > 1) return { owner: target, arrays: [], claimed: [] }
  const seen = new Set<string>([target.getFilePath()])
  let frontier = [target]
  for (let hop = 0; hop < LAZY_OWNER_HOPS && frontier.length > 0; hop += 1) {
    const holders = new Map<string, { file: SourceFile; declared: ArrayLiteralExpression[] }>()
    const next: SourceFile[] = []
    for (const sf of frontier) {
      for (const dep of moduleDependencies(sf)) {
        if (seen.has(dep.getFilePath())) continue
        seen.add(dep.getFilePath())
        if (routeFile && dep.getFilePath() === routeFile.getFilePath()) continue
        // A module that holds no table of its own is a hop on the way to one, not a dead end, and
        // the ownership tests below are about adopting a table: refusing a tableless module as a
        // WAYPOINT would lose every subtree a second route reaches through it.
        const shape = findRouteArrays(dep)
        if (shape.length === 0) { next.push(dep); continue }
        if (!ownedByThisRoute(dep, target, shape, lazyTargets)) continue
        holders.set(dep.getFilePath(), { file: dep, declared: mountedArrays(dep) })
      }
    }
    const found = [...holders.values()]
    if (found.length > 0) {
      const claimed = found.map((h) => h.file)
      const declaring = found.filter((h) => h.declared.length > 0)
      const [only] = declaring
      // One declared holder is elected without testing that it belongs to this application; see the note above on what a `Routes` type does not establish.
      if (only && declaring.length === 1) return { owner: only.file, arrays: only.declared, claimed: filesOf([...claimed, ...only.declared.map((a) => a.getSourceFile())]) }
      return { owner: target, arrays: [], claimed }
    }
    frontier = next
  }
  return { owner: target, arrays: [], claimed: [] }
}

/** The distinct files in a list, so a claim is made once per file. */
function filesOf(files: SourceFile[]): SourceFile[] {
  const seen = new Map<string, SourceFile>()
  for (const f of files) seen.set(f.getFilePath(), f)
  return [...seen.values()]
}

/**
 * May this lazy route adopt `dep` as the table it mounts? Searching three modules out reaches
 * tables that belong to someone else, and adopting one mounts it at a second address, which is a
 * node the application does not have. Three refusals, asked of a file that HOLDS a table:
 * a file another lazy route already owns, whether it names that file itself or reaches it through
 * a barrel, because the table is that route's wherever it is reached from;
 * a file whose tables are all registered at the application root, by `RouterModule.forRoot` or by
 * `provideRouter`, which Angular mounts at the empty path and nowhere else;
 * a file whose tables are all already carried under some prefix by a spread or by a `children`
 * written as a name, for the same reason.
 * The last two are asked of the ARRAYS rather than of the file: a table is declared in one file
 * and registered in another often enough that a file-level test answered true nowhere in this
 * corpus, and a file may hold one table that is registered at the root and another that is not.
 * A file the route itself sits in is refused before this, by the caller, and for a different
 * reason: that one would elect the table the route is written in and, by claiming it out of the
 * root scan, take the only entry point into the walk with it.
 *
 * `mountable` is every array the walk could mount out of the file, found by shape, and not the
 * `Routes`-typed ones alone, so the question asked is about what would be mounted rather than
 * about what carries a type. It is never empty: the caller has already sent a file holding no
 * table on as a waypoint. The collapse a root table written without the type used to cause --- the
 * typed set was empty, the file was adopted, and claiming it took the root scan's only entry
 * point with it, leaving a graph with no nodes at all --- is held off in `collect`, which mints a
 * root-registered array whether or not a claim covers its file; this refusal keeps the file out
 * of the claim as well, and no corpus application tells the two apart.
 */
function ownedByThisRoute(dep: SourceFile, target: SourceFile, mountable: ArrayLiteralExpression[], lazyTargets?: Map<string, string>): boolean {
  const path = dep.getFilePath()
  const owner = lazyTargets?.get(path)
  if (owner !== undefined && owner !== target.getFilePath()) return false
  return !mountable.every((arr) => rootTableArrays?.has(arr) || spreadConsumedArrays?.has(arr))
}

/**
 * The arrays in a file a lazy prefix mounts, by the rule the framework itself applies, or none
 * when the file does not say. `RouterModule.forChild` is a module's own statement of which of its
 * tables the prefix that loads it gets, and the argument is resolved through a name, because that
 * is how it is nearly always written. Failing that, a file holding exactly one table holds the
 * one that is mounted. A file holding several and registering none answers with none: mounting
 * them all gave every prefix every table, so mifos's users module, which holds three and
 * registers one, had the two it does not mount walked under the one address it does.
 *
 * No array is accepted by SHAPE. The file a route NAMES was given that weaker test, on the
 * reading that a route-shaped array in the file a route points at is the table it means; the
 * reading elects a menu. A module holding `export const MENU = [{ path: 'tiles', label: 'Tiles' }]`
 * beside an imported routing module had the menu mounted under the prefix while the real table
 * was left to the root scan, with no note: a node at an address the application does not mount,
 * and a screen lost from the one it does.
 */
function mountedArrays(sf: SourceFile): ArrayLiteralExpression[] {
  const registered: ArrayLiteralExpression[] = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!/RouterModule\.forChild$/.test(call.getExpression().getText())) continue
    for (const arg of call.getArguments()) {
      const arr = arrayLiteralOf(arg)
      if (arr && Node.isArrayLiteralExpression(arr) && !registered.includes(arr)) registered.push(arr)
    }
  }
  if (registered.length > 0) return registered
  // What the author declared to the router comes before what merely looks like a table: a module
  // holding one `Routes` array and a menu config beside it mounts the first, and asking shape
  // first would make the pair ambiguous and lose the subtree.
  const declared = findRouteArrays(sf, true)
  return declared.length === 1 ? declared : []
}

/**
 * Is this registration the providers of a module a `loadChildren` loads? Such a module's
 * providers are its own injector's, so a `provideRouter` among them adds routes under the prefix
 * that loaded it and not at the application root --- the `forChild` case written the standalone
 * way. Taking it for a root registration minted the table at the root beside its real prefixed
 * address. A registration in an exported FACTORY in such a file is a different thing and is not
 * refused here: alfresco's folder-rules library is a lazy target and its factory, which the shell
 * calls, really does register its table at the root. `lazyTargets` holds the files a lazy target
 * re-exports as well as the target itself (see `lazyProvidedFiles`), because a `loadChildren`
 * naming a directory resolves to the barrel and the module whose providers hold the registration
 * is the file behind it.
 */
function providedByLazyModule(call: CallExpression, lazyTargets: Set<string>): boolean {
  if (!lazyTargets.has(call.getSourceFile().getFilePath())) return false
  const prop = call.getFirstAncestor((a) => Node.isPropertyAssignment(a) && a.getName() === 'providers')
  return prop !== undefined && prop.getFirstAncestor((a) => Node.isDecorator(a)) !== undefined
}

/**
 * Is this function called at the point it is written --- an IIFE? Such a call is found by no
 * name, and the body runs wherever the function expression sits.
 */
function invokedWhereWritten(fn: Node): boolean {
  const outer = fn.getParentIfKind(SyntaxKind.ParenthesizedExpression) ?? fn
  const parent = outer.getParent()
  return parent !== undefined && Node.isCallExpression(parent) && parent.getExpression() === outer
}

/**
 * Does this registration run? One at module scope, or in a provider array of a decorator, runs
 * when the module is loaded. One inside a function body runs only if something calls that
 * function, and the difference decides whether a table is mounted at the application root:
 * alfresco's folder-rules library registers its table inside `provideFolderRulesExtension()`,
 * which `aca-content.module.ts` calls one file over, and the table really is mounted at /rules.
 * A factory nothing calls is not evidence of anything, and taking it for one minted a table a
 * spread already carries under a prefix at the root as well --- an address the application mounts
 * nothing at. An anonymous function is refused, because no call to it can be found by name.
 */
function registrationRuns(call: CallExpression, files: SourceFile[]): boolean {
  const isFn = (a: Node) => Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a)
  let fn = call.getFirstAncestor(isFn)
  // A function invoked where it is written runs there, so the question moves out to whatever
  // encloses it: ghostfolio bootstraps inside `(async () => { ... })()`, and asking for a name
  // refused the only registration the application has.
  while (fn && invokedWhereWritten(fn)) fn = fn.getFirstAncestor(isFn)
  if (!fn) return true
  const named = Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) ? fn.getName() : fn.getParentIfKind(SyntaxKind.VariableDeclaration)?.getName()
  if (!named) return false
  for (const sf of files) {
    for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (c === call) continue
      const text = c.getExpression().getText()
      if (text === named || text.endsWith(`.${named}`)) return true
    }
  }
  return false
}

/**
 * The arrays an application registers at its root, by either router API. Collected once per
 * `collectRoutes` call, because the registration is as often as not in a different file from the
 * table and a per-file test therefore sees nothing. A file that both hands a table to
 * `provideRouter` and is loaded lazily -- alfresco's folder-rules library, whose table Angular
 * mounts at the root AND under the prefix that loads it -- is not exempted here: the member the
 * `loadChildren` names is what gives that table its second mount, and exempting the file as well
 * cut the only hole in this rule while buying nothing the name does not already buy.
 */
function collectRootTableArrays(files: SourceFile[], lazyTargets: Set<string>): Set<ArrayLiteralExpression> {
  const out = new Set<ArrayLiteralExpression>()
  for (const sf of files) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = call.getExpression().getText()
      if (!/(RouterModule\.forRoot|provideRouter)$/.test(name)) continue
      if (!registrationRuns(call, files)) continue
      if (providedByLazyModule(call, lazyTargets)) continue
      for (const arg of call.getArguments()) {
        const arr = arrayLiteralOf(arg)
        if (arr && Node.isArrayLiteralExpression(arr)) out.add(arr)
      }
    }
  }
  return out
}

/**
 * The lazy targets, plus the files each of them re-exports. A `loadChildren` naming a directory
 * resolves to the barrel, so the module whose decorator providers hold a `provideRouter` is a
 * file the barrel stands in front of and not the target itself. Testing the target's own path
 * answered false for it, and the table was minted at the empty path as well as under the prefix
 * that loads it --- an address the application mounts nothing at --- while the prefixed subtree
 * was declared unread. One hop, and re-exports only: following a lazy module's IMPORTS would
 * reach the shared modules it pulls in, and a root registration in one of those is the
 * application's own. Membership refuses nothing by itself: a registration in an exported factory
 * in such a file is still a root registration, which is what the decorator test in
 * `providedByLazyModule` decides, and alfresco's folder-rules library turns on exactly that.
 */
function lazyProvidedFiles(files: SourceFile[], direct: Map<string, string>): Set<string> {
  const out = new Set(direct.keys())
  for (const sf of files) {
    if (!direct.has(sf.getFilePath())) continue
    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue()
      const dep = spec ? dependencyFile(exp, sf, spec) : undefined
      if (dep && !dep.getFilePath().includes('/node_modules/')) out.add(dep.getFilePath())
    }
  }
  return out
}

/**
 * The route array a module exports under `name`, following the re-exports a barrel stands behind.
 * Only a `Routes`-typed array counts, for the reason the owner search gives: a shape test alone
 * does not establish that an array is declared to a router.
 */
function namedRouteArray(sf: SourceFile, name: string, seen: Set<string>): ArrayLiteralExpression | null {
  if (seen.has(sf.getFilePath()) || seen.size > LAZY_OWNER_HOPS) return null
  seen.add(sf.getFilePath())
  for (const vd of sf.getVariableDeclarations()) {
    if (vd.getName() !== name || !vd.isExported()) continue
    const init = vd.getInitializer()
    if (init && Node.isArrayLiteralExpression(init) && isRouteArray(init, true)) return init
  }
  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue()
    if (!spec) continue
    const dep = dependencyFile(exp, sf, spec)
    if (!dep || dep.getFilePath().includes('/node_modules/')) continue
    const named = exp.getNamedExports()
    if (named.length > 0 && !named.some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === name)) continue
    const found = namedRouteArray(dep, name, seen)
    if (found) return found
  }
  return null
}

/**
 * The files a module could be hiding its route table behind: what it imports and what it
 * re-exports. A package directory is skipped, because a third-party module declares no screen of
 * the application under measurement and following one would walk the whole framework.
 */
function moduleDependencies(sf: SourceFile): SourceFile[] {
  const out: SourceFile[] = []
  /** Keep a resolved dependency unless it comes from an installed package. */
  const add = (dep: SourceFile | undefined): void => {
    if (dep && !dep.getFilePath().includes('/node_modules/')) out.push(dep)
  }
  for (const imp of sf.getImportDeclarations()) {
    // A type-only import brings no value into the module, so nothing it names can register a
    // route here. Following one let a module reach a table it has no relation to and adopt it.
    const named = imp.getNamedImports()
    if (imp.isTypeOnly() || (named.length > 0 && named.every((n) => n.isTypeOnly()))) continue
    add(dependencyFile(imp, sf, imp.getModuleSpecifierValue()))
  }
  for (const exp of sf.getExportDeclarations()) {
    if (exp.isTypeOnly()) continue
    const spec = exp.getModuleSpecifierValue()
    if (spec) add(dependencyFile(exp, sf, spec))
  }
  return out
}

/**
 * Recursively walk a route array literal, emitting one RouteInfo per route
 * object that declares a `path` AND a component (`component` / `loadComponent`).
 * A componentless route (`{ path: 'x', children }`, `{ path: 'x', loadChildren }`,
 * a redirect) renders nothing itself — it only prefixes its children's paths and
 * applies its `canActivate` to their activation — so it is not a screen; minting
 * it would fabricate a state no user can land on and, worse, shadow a `path: ''`
 * child that shares its full path (first declaration wins). An element that is a
 * call rather than an object literal is a route factory such as mifos's
 * `Route.withShell([...])`, which wraps the array it is given in a `path: ''`
 * shell route; its array arguments are walked at the same prefix, so the routes
 * inside are reached, while whatever the factory itself adds is not seen. Inline `children`
 * are visited with the parent path prefixed and the parent's guards inherited;
 * `loadChildren: () => import('./x.routes')` is followed into the imported
 * module's route array. Deduplicates by node id (first declaration wins). A route whose
 * address cannot be read as a string — an unresolvable `path`, or a `matcher` function — mints
 * nothing and is added to `unreadable.paths`, so the caller knows the route set is a lower
 * bound. A `loadChildren` that resolves to no file at all, to a module in which no route
 * array can be found, or to one whose route array cannot be told from another's is added to
 * `unreadable.subtrees`: the routes it mounts are a boundary the tool cannot read, and saying
 * nothing would let every link into that subtree read as a link to a route the application does
 * not declare. A route file a lazy module imports beside the routing module that was
 * elected is claimed (so the root scan skips it) but not walked, and is added to
 * `unreadable.unplaced` for the same reason. `paths` and `subtrees` are keyed by the route
 * object and `unplaced` by file, so a route walked under several parents is one entry.
 * `consumedFiles`, when given, collects the file of every table this walk actually PLACES under a
 * prefix -- a lazy target, the owner elected for it, and the source of every spread array it
 * enters -- which is how the caller tells a claim that cost nothing from one that lost a table.
 * A file claimed beside an elected owner and never opened is deliberately not in it, because the
 * question the caller asks of it is whether the root scan would have minted anything there. `chain` is the arrays on the current descent: a route table that reaches itself
 * through a `loadChildren` or a spread would otherwise be walked under an ever longer prefix
 * until the stack ran out, which is a crash and not a reading. Reaching one again ends that
 * branch, and where a route object stands for the hop the lost subtree is declared. `auxAt` is set
 * below a route on a named outlet, to the address that route is mounted at.
 */
function walkRouteArray(arr: ArrayLiteralExpression, sf: SourceFile, parentPath: string, out: Map<string, RouteInfo>, loadedChildFiles: Set<string>, inheritedLevels: RouteLevel[] = [], parentNodeId: string | null = null, redirects?: Map<string, Redirect>, unreadable?: UnreadableRoutes, consumedFiles?: Set<string>, chain: Set<ArrayLiteralExpression> = new Set(), auxAt?: string): number {
  if (chain.has(arr)) return 0
  chain.add(arr)
  const placed = walkElements(arr, sf, parentPath, out, loadedChildFiles, inheritedLevels, parentNodeId, redirects, unreadable, consumedFiles, chain, auxAt)
  chain.delete(arr)
  return placed
}


/**
 * What a call contributes to a route table: the arrays to walk and the path segment they go
 * under, or null when this reader cannot say and the caller must declare the subtree unread.
 *
 * Three shapes, and which array is the table differs between them. A builder that RETURNS an
 * array returns the table itself --- `section(V2)` giving `[{ path: 'v2', children }]` mounts its
 * argument under `v2`, so walking the argument instead put that table's addresses at the call's
 * own prefix. A builder that hands its argument back unchanged contributes that argument at no
 * segment. A builder that returns an object places its argument in that object's `children`,
 * under that object's `path`, which is mifos's `Route.withShell` and why its empty path made the
 * call's own prefix the right answer there and the wrong one in general. Anything else --- a
 * callee this reader cannot follow, a returned object that files its argument somewhere other
 * than `children`, a `path` that is not a literal --- answers null.
 */
function callMount(node: Node | undefined): { arrays: ArrayLiteralExpression[]; segment: string; route?: ObjectLiteralExpression } | null {
  if (!node || !Node.isCallExpression(node)) return null
  const returned = builderReturn(node.getExpression())
  if (!returned) return null
  if (Node.isArrayLiteralExpression(returned)) return { arrays: [returned], segment: '' }
  if (Node.isIdentifier(returned)) {
    const named = arrayLiteralOf(returned)
    if (named && Node.isArrayLiteralExpression(named)) return { arrays: [named], segment: '' }
    return { arrays: callArrayArgs(node), segment: '' }
  }
  const obj = Node.isObjectLiteralExpression(returned) ? returned : objectLiteralOf(returned)
  if (!obj) return null
  const children = propNamed(obj, 'children')
  if (!children) return null
  // The table under the wrapper's path is the one `children` NAMES, and the call's argument is
  // that table only where `children` is a parameter of the wrapper --- a parameter being the one
  // value that binds at the call site. `children: SOME_CONST`, or a literal array that files the
  // argument one level deeper, is a DIFFERENT table, and mounting the argument there published a
  // whole subtree at an address the application does not mount with nothing said; a wrapper given
  // two tables mounted the one `children` leaves out beside the one it names.
  const arg = childrenArgument(node, children)
  if (!arg) return null
  const segment = propNamed(obj, 'path') === undefined ? '' : stringProp(obj, 'path')
  if (segment === null) return null
  // The route the wrapper returns is handed back with the arrays, because it declares more than
  // a path: a `canActivate` on it gates everything the wrapper mounts, and dropping it published
  // 978 of mifos's 981 must edges at confidence 1 for transitions the application refuses
  // whenever its AuthenticationGuard denies, with no note saying so.
  return { arrays: [arg], segment, route: obj }
}

/**
 * The argument a wrapper files in the `children` of the route it returns: the one passed for the
 * parameter that property names, or null where the property names anything else.
 */
function childrenArgument(call: CallExpression, children: Node): ArrayLiteralExpression | null {
  const param = childrenParameter(children)
  const fn = param?.getParent()
  if (!param || !Node.isParametered(fn)) return null
  // A `this` parameter is a type annotation, not an argument: no call site passes one, so
  // counting it shifts every index by one and files the wrong table under the wrapper's path.
  const params = fn.getParameters().filter((pa) => pa.getName() !== 'this')
  const at = params.indexOf(param)
  if (at < 0) return null
  const arr = arrayLiteralOf(call.getArguments()[at])
  return arr && Node.isArrayLiteralExpression(arr) ? arr : null
}

/** The parameter the `children` of a returned route names, shorthand or written out. */
function childrenParameter(children: Node): ParameterDeclaration | undefined {
  const named = Node.isShorthandPropertyAssignment(children)
    ? children.getValueSymbol()?.getValueDeclaration()
    : declaredBy(Node.isPropertyAssignment(children) ? children.getInitializer() : undefined)
  return Node.isParameterDeclaration(named) ? named : undefined
}

/** The declaration a name refers to, through an import. */
function declaredBy(expr: Node | undefined): Node | undefined {
  if (!expr || !Node.isIdentifier(expr)) return undefined
  const sym = expr.getSymbol()
  return (sym?.getAliasedSymbol() ?? sym)?.getValueDeclaration()
}

/**
 * The level the route a wrapper returns contributes at `path`, resolved in the wrapper's own file.
 * Every call builds a new route object, so the call stands for it: two calls of one wrapper never
 * share a level, and the router runs the second one's guards when a navigation crosses between them.
 */
function wrapperLevels(mount: { route?: ObjectLiteralExpression }, call: Node, path: string, auxAt: string | undefined): RouteLevel[] {
  return mount.route ? [levelOf(mount.route.getSourceFile(), mount.route, path, auxAt, call)] : []
}

/**
 * The array arguments a call is given, resolved through a name. Used for the shapes where the
 * argument IS the table the call mounts; `callMount` decides which shape that is.
 */
function callArrayArgs(node: Node | undefined): ArrayLiteralExpression[] {
  if (!node || !Node.isCallExpression(node)) return []
  const out: ArrayLiteralExpression[] = []
  for (const arg of node.getArguments()) {
    const arr = arrayLiteralOf(arg)
    if (arr && Node.isArrayLiteralExpression(arr) && !out.includes(arr)) out.push(arr)
  }
  return out
}

/**
 * The distinct arrays a call could put under a prefix, for the pre-pass claim. Both the table the
 * callee returns and the arguments it is given: an argument ends up INSIDE the returned table, so
 * claiming only one of the two left the other to the root scan, which minted it unprefixed.
 */
function callClaimedArrays(node: Node | undefined): ArrayLiteralExpression[] {
  const mount = callMount(node)
  const out = [...(mount ? mount.arrays : []), ...callArrayArgs(node)]
  return [...new Set(out)]
}

/**
 * The expression a `children` property names, written out or in ES2015 shorthand
 * (`{ path: 'x', children }`), where the key IS the binding. Reading only the long form left the
 * subtree unwalked AND unclaimed, so the array the name resolves to stayed in the root scan,
 * which minted its routes unprefixed -- a node at an address the application does not mount,
 * with nothing said about the address it does.
 */
function childrenExpression(obj: ObjectLiteralExpression): Node | undefined {
  const prop = propNamed(obj, 'children')
  if (!prop) return undefined
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode()
  return Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
}

/**
 * The body of `walkRouteArray`, split out so its one caller can add this array to the ancestor
 * set before the walk and take it out after. The set has to hold the arrays on the CURRENT
 * descent and nothing else: one kept across siblings is a visited set, which refuses the same
 * table under a second parent and cost one corpus application a third of its routes.
 */
function walkElements(arr: ArrayLiteralExpression, sf: SourceFile, parentPath: string, out: Map<string, RouteInfo>, loadedChildFiles: Set<string>, inheritedLevels: RouteLevel[], parentNodeId: string | null, redirects: Map<string, Redirect> | undefined, unreadable: UnreadableRoutes | undefined, consumedFiles: Set<string> | undefined, chain: Set<ArrayLiteralExpression>, auxAt: string | undefined): number {
  let placed = 0
  for (const el of arr.getElements()) {
    if (Node.isCallExpression(el)) {
      const mount = callMount(el)
      // A wrapper whose callee, or whose own path, this reader cannot follow mounts its table
      // somewhere it cannot name. Mounting the argument at the CALL's prefix moved a whole
      // subtree to an address the application does not mount, and said nothing.
      if (!mount) {
        unreadable?.calls.add(el)
        continue
      }
      const prefix = joinRoutePath(parentPath, mount.segment)
      const wrapped = [...inheritedLevels, ...wrapperLevels(mount, el, prefix, auxAt)]
      for (const arg of mount.arrays) {
        // A table already on this descent is cut rather than mounted again, as in the spread
        // branch, and the cut is declared for the same reason: the wrapper's table is not read.
        if (chain.has(arg)) {
          unreadable?.calls.add(el)
          continue
        }
        placed += walkRouteArray(arg, arg.getSourceFile(), prefix, out, loadedChildFiles, wrapped, parentNodeId, redirects, unreadable, consumedFiles, chain, auxAt)
        if (arg.getSourceFile() !== sf) consumedFiles?.add(arg.getSourceFile().getFilePath())
      }
      continue
    }
    // `children: [...adminRoutes]` builds the array by spreading another one; without this the
    // spread is skipped and every route it carries is minted at the project root instead,
    // which reads from the outside exactly like a link to a route nobody declares.
    if (Node.isSpreadElement(el)) {
      const arr = arrayLiteralOf(el.getExpression())
      // A table already on this descent is refused rather than followed, which keeps a table that
      // spreads itself from mounting for ever --- but an application that embeds its own shell
      // table under a prefix reaches the same table twice legitimately, and the refusal then
      // costs that subtree. The walk says so now; before, it was lost in silence.
      if (arr && Node.isArrayLiteralExpression(arr) && chain.has(arr)) {
        unreadable?.spreads.add(el)
        continue
      }
      const spreadExpr = el.getExpression()
      const spreadCall = !arr && Node.isCallExpression(spreadExpr) ? spreadExpr : undefined
      // `[...section(V2)]` is the same construct as `section(V2)` written as an element, and
      // taking only the resolvable array left the named table to the root scan, which minted it
      // unprefixed.
      if (spreadCall) {
        const mount = callMount(spreadCall)
        if (!mount) unreadable?.calls.add(spreadCall)
        else {
          const wrappedSpread = [...inheritedLevels, ...wrapperLevels(mount, spreadCall, joinRoutePath(parentPath, mount.segment), auxAt)]
          for (const a of mount.arrays) {
            if (chain.has(a)) {
              unreadable?.calls.add(spreadCall)
              continue
            }
            const n = walkRouteArray(a, a.getSourceFile(), joinRoutePath(parentPath, mount.segment), out, loadedChildFiles, wrappedSpread, parentNodeId, redirects, unreadable, consumedFiles, chain, auxAt)
            placed += n
            if (n > 0 && a.getSourceFile() !== sf) consumedFiles?.add(a.getSourceFile().getFilePath())
          }
        }
        continue
      }
      if (arr && Node.isArrayLiteralExpression(arr)) {
        // Marked placed on the number of placements this descent MADE, not on the array's shape
        // and not on the growth of the maps: shape marks a file placed that places nothing, and a
        // placement that re-sets an address a sibling already holds grows no map, so measuring
        // growth declared a loss where the walk had read the file through.
        const n = walkRouteArray(arr, arr.getSourceFile(), parentPath, out, loadedChildFiles, inheritedLevels, parentNodeId, redirects, unreadable, consumedFiles, chain, auxAt)
        placed += n
        if (n > 0) consumedFiles?.add(arr.getSourceFile().getFilePath())
      } else if (unreadable) {
        unreadable.spreads.add(el)
      }
      continue
    }
    // An array may name its routes instead of spelling them out (`[ERROR_ROUTE]`).
    const obj = Node.isObjectLiteralExpression(el) ? el : objectLiteralOf(el)
    if (!obj) continue
    const ownPath = stringProp(obj, 'path')
    if (ownPath === null) {
      // A `path` the resolver could not read leaves a hole in the route set. Counting those
      // holes is what lets a caller tell "this application declares no such route" from
      // "this extractor could not read the route that declares it" — the two look identical
      // from a navigation site, and treating the second as the first credits the extractor
      // for its own blind spot. A `matcher` route is the same hole by construction: it
      // declares an address through a `UrlMatcher` function instead of a `path` (ghostfolio
      // mounts /admin/users that way), so no string exists to read. It is counted, never
      // evaluated and never minted into a screen — running the matcher is out of reach and
      // guessing its address would claim a destination nothing proves. Angular rejects a route
      // that carries both, so one test counts each hole exactly once.
      // A record whose key or member the reader could not resolve may declare an address it
      // cannot see, so it counts as a path it could not read rather than as no route at all.
      const declaresAddress = propNamed(obj, 'path') !== undefined || propNamed(obj, 'matcher') !== undefined || keyUnreadable(obj)
      if (declaresAddress && unreadable) unreadable.paths.add(obj)
      continue
    }
    const fullPath = joinRoutePath(parentPath, ownPath)
    const componentName = identifierProp(obj, 'component')
    let componentFile = componentName ? resolveImportedFile(sf, componentName) : undefined
    let resolvedName = componentName
    if (!componentFile) {
      const spec = lazyImportSpecifier(obj, 'loadComponent')
      if (spec) {
        componentFile = resolveRelative(sf, spec)
        if (componentFile) resolvedName = componentClassName(componentFile)
      }
    }
    // A route on a named outlet is reached as `(name:path)`, and so is everything BELOW it: the
    // outlet is inherited, so a child of such a route has no primary address either. Testing only
    // the route's own `outlet` minted alfresco's viewer subtree at /view/:nodeId, and a
    // navigation to that address in the built application is answered by the catch-all --- two
    // nodes at addresses the application mounts nothing at.
    // An outlet this reader cannot fix to a string is not one it may take for the primary outlet.
    // A route whose object spreads another in (`{ ...common, path: 'view/:nodeId' }`) carries
    // whatever that one declares, and reading the absent literal as primary minted a whole
    // subtree at an address the framework answers with its catch-all.
    const outletProp = propNamed(obj, 'outlet')
    const ownOutlet = stringProp(obj, 'outlet')
    const outletUnknown = (outletProp !== undefined && ownOutlet === null) || obj.getProperties().some((pr) => Node.isSpreadAssignment(pr))
    if (outletUnknown && unreadable) unreadable.outlets.add(obj)
    const auxOwn = auxAt ?? (outletUnknown || (ownOutlet !== null && ownOutlet !== 'primary') ? parentPath : undefined)
    const auxHere = auxOwn !== undefined
    // Which of a level's guards run is decided per navigation, against the screen it leaves.
    const levels = [...inheritedLevels, levelOf(sf, obj, fullPath, auxOwn)]
    const guards = entryGuards(levels)
    // A redirect renders nothing, so it is no screen — but a link that points AT it does
    // reach the screen it forwards to, and dropping it loses that transition entirely. A
    // redirect on a named outlet is reached as `(name:path)` like any other route there, so
    // registering it at the primary address drew a must edge to its destination from every link
    // to that address --- which Angular answers with the catch-all --- and swallowed the
    // dead-link note the site deserves. It is read after the outlet for that reason.
    const redirectTo = stringProp(obj, 'redirectTo')
    // Angular takes the first route that matches an address, so the first redirect declared at
    // it is the one that applies.
    const redirectTarget = redirectTo === null ? null : redirectTo.startsWith('/') ? redirectTo : joinRoutePath(parentPath, redirectTo)
    const redirectDeclared = propNamed(obj, 'redirectTo') !== undefined
    if (redirectDeclared && redirects && !auxHere) {
      if (redirectTarget !== null) placed++
      // `pathMatch` defaults to 'prefix', which answers every longer address as well.
      const prefix = stringProp(obj, 'pathMatch') !== 'full'
      const first = redirects.get(fullPath)
      if (!first) redirects.set(fullPath, { to: redirectTarget, prefix, levels })
      // A later prefix redirect answers the longer addresses the first leaves, from a place in the tables the first does not say.
      else if (prefix && !first.prefix) Object.assign(first, { prefix, levels: [] })
    }
    const isScreen = !auxHere && (propNamed(obj, 'component') !== undefined || propNamed(obj, 'loadComponent') !== undefined)
    const nodeId = routeToNodeId(fullPath)
    // A child at the empty path with no component of its own is matched whenever the screen
    // above it is navigated to at that screen's own address, so what it declares applies to
    // every navigation into that screen: a guard it carries runs (bitwarden's root sends every
    // visitor on with a redirectGuard() on such a child), and a redirect it declares replaces the
    // screen as the destination. Taking a guard a branch Angular may not match is the safe side.
    // Angular takes the first child that matches, so a redirect after a child that already
    // answers the empty path is never reached; a guard on a later child is kept anyway, which is
    // the safe side. A child with a component of its own at that address loses the address to the
    // screen above it, first declared wins, but its guards still run there.
    const host = !auxHere && ownPath === '' && parentNodeId === nodeId ? out.get(nodeId) : undefined
    if (host) {
      if (!redirectDeclared) {
        const level = levels[levels.length - 1]!
        host.levels = [...host.levels, level]
        host.guards = [...host.guards, ...entryGuards([level])]
        emptyPathAnswered.add(host)
      } else if (host.redirectsTo === undefined && !emptyPathAnswered.has(host)) host.redirectsTo = redirectTarget
    }
    // Counted whether or not the address is free: the walk read a route and reached an address,
    // and first-declared-wins is a choice between two routes, not a route the walk failed to
    // place. Counting only the winner told the caller this file had been read through only when
    // its routes happened to be new.
    if (isScreen) placed++
    if (isScreen && !out.has(nodeId)) {
      out.set(nodeId, { fullPath, nodeId, componentName: resolvedName, componentFile, guards, levels, routeObj: obj, parentNodeId: parentNodeId === nodeId ? null : parentNodeId })
    }
    const childParent = isScreen ? nodeId : parentNodeId
    const childrenProp = propNamed(obj, 'children')
    if (childrenProp) {
      const childExpr = childrenExpression(obj)
      // `children: ADMIN` and `children: [...ADMIN]` are the same construct to Angular, so the
      // initializer is resolved the way a spread's expression is rather than required to be
      // written out. One the resolver cannot bring back to an array is a subtree the walk never
      // enters, and saying nothing about it let the named array be minted at the root instead.
      const childInit = arrayLiteralOf(childExpr)
      // A subtree handed to a helper (`children: withShell(ADMIN)`) is reached through the
      // helper's arguments, the way an element written as a call is. Taking only the literal
      // left the named table to the root scan, which minted it unprefixed.
      const childCall = childInit && Node.isArrayLiteralExpression(childInit) ? undefined : childExpr
      // A `children` handed to a helper is mounted under the segment that helper declares, not
      // under this route's own prefix. Reading it the way the element branch had been read put a
      // whole subtree at /admin/dash for an application that serves /admin/v2/dash.
      const childMount = childCall && Node.isCallExpression(childCall) ? callMount(childCall) : { arrays: [], segment: '' }
      if (!childMount && childCall && Node.isCallExpression(childCall)) unreadable?.calls.add(childCall)
      const childArrays = !childMount ? [] : childInit && Node.isArrayLiteralExpression(childInit) ? [childInit] : childMount.arrays
      const childPrefix = joinRoutePath(fullPath, childMount ? childMount.segment : '')
      const childLevels = childMount ? [...levels, ...wrapperLevels(childMount, childCall!, childPrefix, auxOwn)] : levels
      if (childArrays.length > 0) {
        for (const child of childArrays) {
          if (chain.has(child)) {
            unreadable?.subtrees.add(obj)
            continue
          }
          const n = walkRouteArray(child, child.getSourceFile(), childPrefix, out, loadedChildFiles, childLevels, childParent, redirects, unreadable, consumedFiles, chain, auxOwn)
          placed += n
          if (n > 0 && child.getSourceFile() !== sf) consumedFiles?.add(child.getSourceFile().getFilePath())
        }
      } else if (unreadable) {
        unreadable.subtrees.add(obj)
      }
    }
    const childSpec = lazyImportSpecifier(obj, 'loadChildren')
    // A `loadChildren` whose specifier is not a literal (a template over a variable, say) yields
    // no specifier and no identifier target, so the branch below is skipped: without this the
    // whole subtree it mounts leaves the route set with nothing said about it.
    if (!childSpec && !lazyIdentifierTarget(sf, obj, 'loadChildren') && propNamed(obj, 'loadChildren') !== undefined && unreadable) unreadable.subtrees.add(obj)
    if (childSpec || lazyIdentifierTarget(sf, obj, 'loadChildren')) {
      const childModule = childSpec ? resolveRelative(sf, childSpec) : lazyIdentifierTarget(sf, obj, 'loadChildren')
      if (childModule) {
            const { owner, arrays, claimed } = lazyRouteOwner(childModule, sf, directLazyTargets, lazyMemberName(obj, 'loadChildren'))
        if (arrays.length === 0 && unreadable) unreadable.subtrees.add(obj)
        loadedChildFiles.add(childModule.getFilePath())
        consumedFiles?.add(childModule.getFilePath())
        // Every claimed file leaves the root scan, but only the elected owner is walked: marking
        // the other holders consumed would say the walk placed a table it never opened.
        for (const f of claimed) loadedChildFiles.add(f.getFilePath())
        if (arrays.length > 0) consumedFiles?.add(owner.getFilePath())
        // The table a `forChild` registers is as often as not declared in another file, which is
        // the shape Angular's own documentation uses. Marking only the owner left that file
        // counted as never reached, and the per-file comparison then declared a route set a
        // lower bound although the walk had read it through --- a loss that is not a loss, which
        // suppresses every dead-link finding the application carries.
        for (const childArr of arrays) consumedFiles?.add(childArr.getSourceFile().getFilePath())
        for (const childArr of arrays) {
          // A lazy hop back onto a table already on this descent would mount it under its own
          // prefix for ever; the subtree is declared unread rather than followed or dropped.
          if (chain.has(childArr)) unreadable?.subtrees.add(obj)
          else placed += walkRouteArray(childArr, owner, fullPath, out, loadedChildFiles, levels, childParent, redirects, unreadable, consumedFiles, chain, auxOwn)
        }
      } else if (unreadable) {
        unreadable.subtrees.add(obj)
      }
    }
  }
  return placed
}

/**
 * Collect declared routes (including nested + lazy) into route nodes. Files
 * reached via `loadChildren` are scanned only under their parent prefix, never
 * again at the root, so a child route array contributes a single correct path. A file outside
 * `projectDir` is never scanned from the root, tested on a path boundary so a sibling
 * application whose directory name extends this one's is outside too. When `unreadable` is given,
 * the routes the walk could not read are recorded into it (see `UnreadableRoutes`). When `guarded`
 * is given, the levels whose guards the router can run off a target's own chain are recorded into
 * it (see `levelOf`).
 *
 * A claimed file is skipped by the root scan on the strength of a site that may sit where the
 * walk cannot see it (see `collectLoadChildrenTargets`), so once the walk is done each claim is
 * compared with what the walk followed: a claimed file the walk never reached, and from which the
 * root scan would have minted something (`mintsFromRoot`), is recorded as `unplaced`. A claim the
 * walk did follow, a spec, and a file the root scan would have minted nothing from are not,
 * because no route was lost there. The comparison is per FILE, so a file holding two route
 * arrays of which the walk reached one is counted as placed and the other array stays silent.
 */
export function collectRoutes(project: Project, redirects?: Map<string, Redirect>, unreadable?: UnreadableRoutes, projectDir?: string, guarded?: RouteLevel[]): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  try {
    const { targets: claimedFiles, direct, spreadArrays } = collectLoadChildrenTargets(project, projectDir)
    directLazyTargets = direct
    spreadConsumedArrays = spreadArrays
    guardedLevels = guarded
    return collect(project, byNodeId, claimedFiles, redirects, unreadable, projectDir)
  } finally {
    directLazyTargets = undefined
    spreadConsumedArrays = undefined
    rootTableArrays = undefined
    unselectedArms = undefined
    unreadableRegistrations = undefined
    guardedLevels = undefined
  }
}

/** The body of `collectRoutes`, split out so the per-run sets above are always cleared. */
function collect(project: Project, byNodeId: Map<string, RouteInfo>, claimedFiles: Set<string>, redirects?: Map<string, Redirect>, unreadable?: UnreadableRoutes, projectDir?: string): RouteInfo[] {
  const loadedChildFiles = new Set(claimedFiles)
  const consumedFiles = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    const f = sf.getFilePath()
    // A spec declares routes of its own to drive the router under test; they are not the
    // application's screens, and minting them puts fictional addresses in the graph.
    if (SPEC_FILE.test(f)) continue
    // A claim says a walk reaches this file's tables under a prefix. It does not say the root
    // mounts none of them: a feature library that hands its table to `provideRouter` and is also
    // loaded lazily has that table mounted at BOTH addresses, and one claim covering both lost
    // the root one in silence, because the loss is invisible to a test asked per file.
    const claimed = loadedChildFiles.has(f)
    // A tsconfig `paths` alias brings a whole library directory into the project so that
    // imports through it resolve. A route array in that library is the LIBRARY's, and
    // walking it from the root minted its routes as this application's screens -- at
    // confidence 1, which is a must edge to an address the application does not have.
    // Such a file is reachable only through a `loadChildren` that names it.
    if (projectDir && !isInsideDir(f, projectDir)) continue
    for (const arr of findRouteArrays(sf)) {
      // An array handed to a registration call is mounted at the empty path, and nothing else
      // that carries it takes that mount away: an application that embeds its own shell table
      // under a prefix lost both of its real root addresses when the spread test was asked
      // first, because the spread claim answered before the root rescue could.
      const atRoot = rootTableArrays?.has(arr)
      // An array a spread already carries is mounted under that spread's prefix. Minting it again
      // here would put its routes at the root as well, at addresses the application never mounts.
      if (!atRoot && spreadConsumedArrays?.has(arr)) continue
      if (!atRoot && claimed) continue
      walkRouteArray(arr, sf, '/', byNodeId, loadedChildFiles, [], null, redirects, unreadable, consumedFiles)
    }
  }
  // The probes below walk tables the application may not mount, so their levels are not recorded.
  guardedLevels = undefined
  if (unreadable) {
    for (const call of unreadableRegistrations ?? []) unreadable.calls.add(call)
    for (const f of claimedFiles) {
      const file = project.getSourceFile(f)
      if (!file || SPEC_FILE.test(f) || consumedFiles.has(f)) continue
      if (projectDir && !isInsideDir(f, projectDir)) continue
      if (mintsFromRoot(file, loadedChildFiles, byNodeId, redirects)) unreadable.unplaced.add(file)
    }
  }
  return [...byNodeId.values()]
}

/**
 * Would the root scan have minted anything NEW from this file, had no claim removed it? Asked by
 * running the same walk into a throwaway map, which is the only test that answers it: a shape
 * test counts a file whose only route-shaped array is a menu or a form config, and a note that
 * declares a loss where nothing was lost voids every dead-link finding the application carries.
 * `already` is the graph built so far, and the comparison is against its node ids rather than
 * against the probe's size, because a claimed file that re-declares addresses the graph already
 * holds cost the route set nothing either. The claims go in as a copy because the walk adds to
 * them; this file is not removed from that copy, because the probe starts from the file's own
 * arrays and never consults the set for them, so removing it would change no answer. A redirect
 * the root scan would have registered counts as well, because a redirect is placed under a
 * prefix like a route and a claimed file holding only redirects would otherwise be lost here in
 * silence -- held against `alreadyRedirects` for the same reason the nodes are held against
 * `already`, since a file that re-declares a redirect the graph has cost the route set nothing.
 */
function mintsFromRoot(sf: SourceFile, claims: Set<string>, already: Map<string, RouteInfo>, alreadyRedirects?: Map<string, Redirect>): boolean {
  const probe = new Map<string, RouteInfo>()
  const probeRedirects = new Map<string, Redirect>()
  for (const arr of findRouteArrays(sf)) {
    if (unselectedArms?.has(arr)) continue
    walkRouteArray(arr, sf, '/', probe, new Set(claims), [], null, probeRedirects)
  }
  if ([...probeRedirects].some(([from, r]) => alreadyRedirects?.get(from)?.to !== r.to)) return true
  return [...probe.keys()].some((id) => !already.has(id))
}

/**
 * Pre-pass: the files the root scan must skip because a walk reaches their route arrays under a
 * prefix. Two kinds of site claim a file. A `loadChildren` object claims its lazy target and every
 * file that may hold the route array it delegates to (all candidates when the owner is ambiguous).
 * A spread claims the file of the array it resolves to in another file when `spreadMintsRoutes`
 * accepts that array, that is, when the walk's own spread branch would mint routes from it,
 * directly or through a further spread or call; a spread of anything else, such as
 * `imports: [...SHARED]` in a component decorator, claims nothing.
 *
 * A claim is tested on the FILE it is made from and never on the position inside it. A spec, or a
 * file outside `projectDir`, does not claim, because the root scan never visits it and nothing
 * would place what a claim from there removed. A site in a file the root scan does visit is
 * honoured wherever it sits, including in an array `findRouteArrays` cannot see (one returned from
 * a function or built by an arrow) that the walk never enters; `collectRoutes` compares the claims
 * with what the walk followed and records each claimed file the walk never reached, and from which
 * the root scan would have minted something, as unplaced. A table whose only claimants were skipped is root-scanned like any
 * unclaimed one, that is, taken to be mounted at the root.
 */
function collectLoadChildrenTargets(project: Project, projectDir?: string): { targets: Set<string>; direct: Map<string, string>; spreadArrays: Set<ArrayLiteralExpression> } {
  const targets = new Set<string>()
  const direct = new Map<string, string>()
  const spreadArrays = new Set<ArrayLiteralExpression>()
  const unselected = new Set<ArrayLiteralExpression>()
  const unreadableCalls = new Set<CallExpression>()
  const files = project.getSourceFiles().filter((sf) => !SPEC_FILE.test(sf.getFilePath()) && !(projectDir && !isInsideDir(sf.getFilePath(), projectDir)))
  /** Every `loadChildren` in a file, resolved to the module it names and the member it takes. */
  const lazySites = (sf: SourceFile): { mod: SourceFile; member: string | null }[] => {
    const out: { mod: SourceFile; member: string | null }[] = []
    for (const obj of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const spec = lazyImportSpecifier(obj, 'loadChildren')
      const mod = spec ? resolveRelative(sf, spec) : lazyIdentifierTarget(sf, obj, 'loadChildren')
      if (mod) out.push({ mod, member: lazyMemberName(obj, 'loadChildren') })
    }
    return out
  }
  for (const sf of files) {
    for (const { mod } of lazySites(sf)) {
      targets.add(mod.getFilePath())
      // A file a route names is owned by the route that names it, which is the route whose owner
      // search starts at that file; two routes naming the same module both own it, as Angular
      // mounts it under both.
      direct.set(mod.getFilePath(), mod.getFilePath())
    }
  }
  // The arrays a spread or a named `children` already carries are known before any owner search,
  // so that search can refuse a table already mounted under a prefix.
  for (const sf of files) {
    // A route-shaped spread array is reached under the spreading route's prefix, so the root must
    // not mint it again unprefixed. The array is recorded as well as its file, because a helper
    // array spread into a table in its OWN file cannot be removed by file: that would take the
    // table with it.
    for (const sp of sf.getDescendantsOfKind(SyntaxKind.SpreadElement)) {
      const arr = arrayLiteralOf(sp.getExpression())
      const expr = sp.getExpression()
      // A spread of a call carries the call's arguments under a prefix, so the root scan must not
      // mint them as well.
      if (!arr && Node.isCallExpression(expr)) {
        for (const a of callClaimedArrays(expr)) {
          if (!spreadMintsRoutes(a)) continue
          spreadArrays.add(a)
          if (a.getSourceFile() !== sf) targets.add(a.getSourceFile().getFilePath())
        }
      }
      const arms = conditionalArrayArms(sp.getExpression())
      for (const a of arms) if (a !== arr && Node.isArrayLiteralExpression(a)) unselected.add(a)
      for (const a of [arr, ...arms]) {
        if (!a || !Node.isArrayLiteralExpression(a) || !spreadMintsRoutes(a)) continue
        spreadArrays.add(a)
        if (a.getSourceFile() !== sf) targets.add(a.getSourceFile().getFilePath())
      }
    }
    // A `children` written as a name reaches its array the same way and is mounted under the same
    // prefix, so the root must not mint it either.
    for (const obj of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const init = childrenExpression(obj)
      if (!init) continue
      const arr = arrayLiteralOf(init)
      // An array written out in place is reached only here; one reached through a name is also a
      // declaration the root scan can see, and that is the one to remove from it. A table handed
      // to a helper is reached through the call's arguments, which the walk mounts under this
      // prefix, so they are removed from the root scan for the same reason.
      const named = arr && arr !== init && Node.isArrayLiteralExpression(arr) ? [arr] : callClaimedArrays(init)
      const arms = conditionalArrayArms(init).filter((a): a is ArrayLiteralExpression => Node.isArrayLiteralExpression(a))
      for (const a of arms) if (a !== arr) unselected.add(a)
      for (const a of [...named, ...arms]) {
        spreadArrays.add(a)
        if (a.getSourceFile() !== sf) targets.add(a.getSourceFile().getFilePath())
      }
    }
    // An arm of a conditional handed to a registration call is as claimed as one handed to a
    // spread: the arm the build takes is mounted where the call mounts it, and the arm it does
    // not take is mounted nowhere. Claiming only the selected one left the other to the root
    // scan, which minted it unprefixed --- the address the rule exists to prevent. A root
    // registration's own arm is rescued in `collect`, which mints a root-registered array
    // whatever claims its file.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!/(RouterModule\.(forRoot|forChild)|provideRouter)$/.test(call.getExpression().getText())) continue
      for (const arg of call.getArguments()) {
        const taken = arrayLiteralOf(arg)
        const arms = conditionalArrayArms(arg)
        // With no arm selected the registration mounts a table this reader cannot name. Both arms
        // are still claimed, because minting them both at the root would put the addresses of the
        // one the build does not take into the graph; the call is recorded so the route set says
        // it is a lower bound rather than reporting an empty graph as a complete one.
        if (arms.length > 0 && !taken) unreadableCalls.add(call)
        for (const a of arms) {
          if (!Node.isArrayLiteralExpression(a)) continue
          spreadArrays.add(a)
          if (a !== taken) unselected.add(a)
          if (a.getSourceFile() !== sf) targets.add(a.getSourceFile().getFilePath())
        }
      }
    }
    // An element written as a call carries its arguments under the same prefix, and the array it
    // is written in need not look like a table itself: `children: [Route.withShell(USERS)]` holds
    // one call and no route object. The argument is claimed on the same test as a spread's, so an
    // argument that mints nothing -- a class list, a menu -- claims nothing.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const parent = call.getParent()
      if (!parent || !Node.isArrayLiteralExpression(parent)) continue
      // `imports: [RouterModule.forRoot(routes)]` is a call inside an array too, and its argument
      // is the table the ROOT mounts: claiming it takes the root scan's entry point away.
      if (/(RouterModule\.(forRoot|forChild)|provideRouter)$/.test(call.getExpression().getText())) continue
      for (const a of callClaimedArrays(call)) {
        if (!spreadMintsRoutes(a)) continue
        spreadArrays.add(a)
        if (a.getSourceFile() !== sf) targets.add(a.getSourceFile().getFilePath())
      }
    }
  }
  spreadConsumedArrays = spreadArrays
  unselectedArms = unselected
  unreadableRegistrations = unreadableCalls
  rootTableArrays = collectRootTableArrays(files, lazyProvidedFiles(files, direct))
  // The owner search reads `direct`, so it is asked only once every directly named module is in
  // it. What it elects goes back into `direct` under the route that elected it, so a table a
  // route reaches through a barrel is that route's as surely as one it names, and a second route
  // reaching the same table from elsewhere is refused it.
  const elected = new Map<string, Set<string>>()
  for (const sf of files) {
    for (const { mod, member } of lazySites(sf)) {
      const { owner, arrays, claimed } = lazyRouteOwner(mod, sf, direct, member)
      for (const f of claimed) targets.add(f.getFilePath())
      if (arrays.length === 0 || direct.has(owner.getFilePath())) continue
      if (!elected.has(owner.getFilePath())) elected.set(owner.getFilePath(), new Set())
      elected.get(owner.getFilePath())!.add(mod.getFilePath())
    }
  }
  // Elections are resolved after every route has voted, not as the files happen to be visited:
  // deciding in file order let whichever route the walk reached first take a table that was not
  // its own, and left the route the table belongs to without one. A table two routes elect
  // belongs to neither by this reading, so it is refused to both and each declares the subtree
  // unread, which is the direction a wrong answer must fall in.
  const CONTESTED = '\u0000contested'
  for (const [owner, voters] of elected) {
    const [sole] = [...voters]
    direct.set(owner, voters.size === 1 && sole ? sole : CONTESTED)
  }
  return { targets, direct, spreadArrays }
}
