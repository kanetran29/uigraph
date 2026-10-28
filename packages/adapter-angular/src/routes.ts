// Angular `Routes` config extraction: find top-level Routes-shaped array literals,
// recursively walk them (nested `children`, lazy `loadChildren`/`loadComponent`)
// into RouteInfo records — full path, node id, backing component file, and
// `canActivate` guard descriptors. Files reached via `loadChildren` are scanned
// only under their parent prefix.

import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, ExportDeclaration, ImportDeclaration, ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { routeToNodeId } from './ids'

/** Specs, stories and test doubles: they declare routes that are not the application's. */
const SPEC_FILE = /\.(spec|test|stories|cy)\.[tj]s$/
import { analyzeCanActivate, type GuardInfo } from './guards'
import { resolveImportedFile, lazyImportSpecifier, lazyIdentifierTarget, resolveRelative, isInsideDir, componentClassName, stringProp, identifierProp, objectLiteralOf, arrayLiteralOf } from './resolve'

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
 */
export interface UnreadableRoutes {
  paths: Set<ObjectLiteralExpression>
  subtrees: Set<ObjectLiteralExpression>
  unplaced: Set<SourceFile>
}

/**
 * Analyze a `canActivate: [A, B]` array into structured guard descriptors.
 * Covers class-reference guards, named functional guards (`[requireAuth]`), and
 * inline arrow guards (`[() => inject(X)...]`); the route's source file is needed
 * to resolve named functional-guard consts.
 */
function canActivateGuards(sf: SourceFile, obj: ObjectLiteralExpression): GuardInfo[] {
  const prop = obj.getProperty('canActivate')
  if (!prop || !Node.isPropertyAssignment(prop)) return []
  const init = prop.getInitializer()
  if (!init || !Node.isArrayLiteralExpression(init)) return []
  return analyzeCanActivate(sf, init.getElements())
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
  return isRoutesTyped || (!declaredOnly && arr.getElements().some((e) => Node.isObjectLiteralExpression(e) && e.getProperty('path') !== undefined))
}

/**
 * Whether a spread of this array puts routes under the spreading route's prefix. `isRouteArray`
 * asks whether the array itself is a table; the walk's spread branch recurses into whatever array
 * it resolves, so an array that carries its routes only through a further spread or a call still
 * mints them. The claim has to answer the walk's question and not the narrower one: an array
 * whose routes are one spread deeper was dropped from the claim while the walk minted it under
 * the prefix anyway, and the root scan, no longer suppressed, minted it a second time unprefixed
 * -- a node, and a must edge into it, at an address the application does not mount. `seen` stops
 * an array that spreads itself.
 */
function spreadMintsRoutes(arr: ArrayLiteralExpression, seen = new Set<ArrayLiteralExpression>()): boolean {
  if (seen.has(arr)) return false
  seen.add(arr)
  if (isRouteArray(arr)) return true
  return arr.getElements().some((el) => {
    if (Node.isSpreadElement(el)) {
      const inner = arrayLiteralOf(el.getExpression())
      return inner !== undefined && Node.isArrayLiteralExpression(inner) && spreadMintsRoutes(inner, seen)
    }
    if (Node.isCallExpression(el)) return el.getArguments().some((a) => Node.isArrayLiteralExpression(a) && spreadMintsRoutes(a, seen))
    return objectLiteralOf(el)?.getProperty('path') !== undefined
  })
}

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
 * could have found it, and shape alone cannot say whether the router mounts it elsewhere, so
 * `unplaced` lists those holders for the caller to record as a loss. It is empty when no owner is
 * elected, because the caller then records the whole subtree as unreadable.
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
function lazyRouteOwner(target: SourceFile): { owner: SourceFile; arrays: ArrayLiteralExpression[]; claimed: SourceFile[]; unplaced: SourceFile[] } {
  const own = findRouteArrays(target)
  if (own.length) return { owner: target, arrays: own, claimed: [target], unplaced: [] }
  const holders = new Map<string, { file: SourceFile; declared: ArrayLiteralExpression[] }>()
  /** Record `dep` as a holder when it has a route-shaped array, keeping the arrays it DECLARES to the router; a file named by both an import and a re-export counts once. */
  const consider = (dep: SourceFile | undefined): void => {
    if (!dep || holders.has(dep.getFilePath()) || findRouteArrays(dep).length === 0) return
    holders.set(dep.getFilePath(), { file: dep, declared: findRouteArrays(dep, true) })
  }
  for (const imp of target.getImportDeclarations()) consider(dependencyFile(imp, target, imp.getModuleSpecifierValue()))
  for (const exp of target.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue()
    if (spec) consider(dependencyFile(exp, target, spec))
  }
  const found = [...holders.values()]
  const claimed = found.map((h) => h.file)
  const declaring = found.filter((h) => h.declared.length > 0)
  const [only] = declaring
  // One declared holder is elected without testing that it belongs to this application; see the note above on what a `Routes` type does not establish.
  if (only && declaring.length === 1) return { owner: only.file, arrays: only.declared, claimed, unplaced: found.filter((h) => h.declared.length === 0).map((h) => h.file) }
  return { owner: target, arrays: [], claimed, unplaced: [] }
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
 * `consumedFiles`, when given, collects the file of every lazy target, claimed file and spread
 * array this walk follows, which is how the caller tells a claim the walk reached from one it
 * never did.
 */
function walkRouteArray(arr: ArrayLiteralExpression, sf: SourceFile, parentPath: string, out: Map<string, RouteInfo>, loadedChildFiles: Set<string>, inheritedGuards: GuardInfo[] = [], parentNodeId: string | null = null, redirects?: Map<string, string>, unreadable?: UnreadableRoutes, consumedFiles?: Set<string>): void {
  for (const el of arr.getElements()) {
    if (Node.isCallExpression(el)) {
      for (const arg of el.getArguments()) {
        if (Node.isArrayLiteralExpression(arg)) walkRouteArray(arg, sf, parentPath, out, loadedChildFiles, inheritedGuards, parentNodeId, redirects, unreadable, consumedFiles)
      }
      continue
    }
    // `children: [...adminRoutes]` builds the array by spreading another one; without this the
    // spread is skipped and every route it carries is minted at the project root instead,
    // which reads from the outside exactly like a link to a route nobody declares.
    if (Node.isSpreadElement(el)) {
      const arr = arrayLiteralOf(el.getExpression())
      if (arr && Node.isArrayLiteralExpression(arr)) {
        consumedFiles?.add(arr.getSourceFile().getFilePath())
        walkRouteArray(arr, arr.getSourceFile(), parentPath, out, loadedChildFiles, inheritedGuards, parentNodeId, redirects, unreadable, consumedFiles)
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
      const declaresAddress = obj.getProperty('path') !== undefined || obj.getProperty('matcher') !== undefined
      if (declaresAddress && unreadable) unreadable.paths.add(obj)
      continue
    }
    const fullPath = joinRoutePath(parentPath, ownPath)
    const guards = [...inheritedGuards, ...canActivateGuards(sf, obj)]
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
    // A redirect renders nothing, so it is no screen — but a link that points AT it does
    // reach the screen it forwards to, and dropping it loses that transition entirely.
    const redirectTo = stringProp(obj, 'redirectTo')
    if (redirectTo !== null && redirects) redirects.set(fullPath, redirectTo.startsWith('/') ? redirectTo : joinRoutePath(parentPath, redirectTo))
    const isScreen = obj.getProperty('component') !== undefined || obj.getProperty('loadComponent') !== undefined
    const nodeId = routeToNodeId(fullPath)
    if (isScreen && !out.has(nodeId)) {
      out.set(nodeId, { fullPath, nodeId, componentName: resolvedName, componentFile, guards, routeObj: obj, parentNodeId: parentNodeId === nodeId ? null : parentNodeId })
    }
    const childParent = isScreen ? nodeId : parentNodeId
    const childrenProp = obj.getProperty('children')
    if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
      const childInit = childrenProp.getInitializer()
      if (childInit && Node.isArrayLiteralExpression(childInit)) walkRouteArray(childInit, sf, fullPath, out, loadedChildFiles, guards, childParent, redirects, unreadable, consumedFiles)
    }
    const childSpec = lazyImportSpecifier(obj, 'loadChildren')
    if (childSpec || lazyIdentifierTarget(sf, obj, 'loadChildren')) {
      const childModule = childSpec ? resolveRelative(sf, childSpec) : lazyIdentifierTarget(sf, obj, 'loadChildren')
      if (childModule) {
        const { owner, arrays, claimed, unplaced } = lazyRouteOwner(childModule)
        if (arrays.length === 0 && unreadable) unreadable.subtrees.add(obj)
        if (unreadable) for (const f of unplaced) unreadable.unplaced.add(f)
        loadedChildFiles.add(childModule.getFilePath())
        consumedFiles?.add(childModule.getFilePath())
        for (const f of claimed) {
          loadedChildFiles.add(f.getFilePath())
          consumedFiles?.add(f.getFilePath())
        }
        for (const childArr of arrays) walkRouteArray(childArr, owner, fullPath, out, loadedChildFiles, guards, childParent, redirects, unreadable, consumedFiles)
      } else if (unreadable) {
        unreadable.subtrees.add(obj)
      }
    }
  }
}

/**
 * Collect declared routes (including nested + lazy) into route nodes. Files
 * reached via `loadChildren` are scanned only under their parent prefix, never
 * again at the root, so a child route array contributes a single correct path. A file outside
 * `projectDir` is never scanned from the root, tested on a path boundary so a sibling
 * application whose directory name extends this one's is outside too. When `unreadable` is given,
 * the routes the walk could not read are recorded into it (see `UnreadableRoutes`).
 *
 * A claimed file is skipped by the root scan on the strength of a site that may sit where the
 * walk cannot see it (see `collectLoadChildrenTargets`), so once the walk is done each claim is
 * compared with what the walk followed: a claimed file the walk never reached, and from which the
 * root scan would have minted something (`mintsFromRoot`), is recorded as `unplaced`. A claim the
 * walk did follow, a spec, and a file the root scan would have minted nothing from are not,
 * because no route was lost there. The comparison is per FILE, so a file holding two route
 * arrays of which the walk reached one is counted as placed and the other array stays silent.
 */
export function collectRoutes(project: Project, redirects?: Map<string, string>, unreadable?: UnreadableRoutes, projectDir?: string): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  const claimedFiles = collectLoadChildrenTargets(project, projectDir)
  const loadedChildFiles = new Set(claimedFiles)
  const consumedFiles = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    const f = sf.getFilePath()
    // A spec declares routes of its own to drive the router under test; they are not the
    // application's screens, and minting them puts fictional addresses in the graph.
    if (loadedChildFiles.has(f) || SPEC_FILE.test(f)) continue
    // A tsconfig `paths` alias brings a whole library directory into the project so that
    // imports through it resolve. A route array in that library is the LIBRARY's, and
    // walking it from the root minted its routes as this application's screens -- at
    // confidence 1, which is a must edge to an address the application does not have.
    // Such a file is reachable only through a `loadChildren` that names it.
    if (projectDir && !isInsideDir(f, projectDir)) continue
    for (const arr of findRouteArrays(sf)) walkRouteArray(arr, sf, '/', byNodeId, loadedChildFiles, [], null, redirects, unreadable, consumedFiles)
  }
  if (unreadable) {
    for (const f of claimedFiles) {
      const file = project.getSourceFile(f)
      if (file && !SPEC_FILE.test(f) && !consumedFiles.has(f) && mintsFromRoot(file, loadedChildFiles)) unreadable.unplaced.add(file)
    }
  }
  return [...byNodeId.values()]
}

/**
 * Would the root scan have minted anything from this file, had no claim removed it? Asked by
 * running the same walk into a throwaway map, which is the only test that answers it: a shape
 * test counts a file whose only route-shaped array is a menu or a form config, and a note that
 * declares a loss where nothing was lost voids every dead-link finding the application carries.
 * The claims are passed with this file removed, because that is the counterfactual, and as a copy
 * because the walk adds to them.
 */
function mintsFromRoot(sf: SourceFile, claims: Set<string>): boolean {
  const probeClaims = new Set(claims)
  probeClaims.delete(sf.getFilePath())
  const probe = new Map<string, RouteInfo>()
  for (const arr of findRouteArrays(sf)) walkRouteArray(arr, sf, '/', probe, probeClaims)
  return probe.size > 0
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
function collectLoadChildrenTargets(project: Project, projectDir?: string): Set<string> {
  const targets = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    if (SPEC_FILE.test(sf.getFilePath()) || (projectDir && !isInsideDir(sf.getFilePath(), projectDir))) continue
    for (const obj of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const spec = lazyImportSpecifier(obj, 'loadChildren')
      const mod = spec ? resolveRelative(sf, spec) : lazyIdentifierTarget(sf, obj, 'loadChildren')
      if (!mod) continue
      targets.add(mod.getFilePath())
      for (const f of lazyRouteOwner(mod).claimed) targets.add(f.getFilePath())
    }
    // A route-shaped spread array is reached under the spreading route's prefix, so the root must not mint it again unprefixed.
    for (const sp of sf.getDescendantsOfKind(SyntaxKind.SpreadElement)) {
      const arr = arrayLiteralOf(sp.getExpression())
      if (arr && Node.isArrayLiteralExpression(arr) && arr.getSourceFile() !== sf && spreadMintsRoutes(arr)) targets.add(arr.getSourceFile().getFilePath())
    }
  }
  return targets
}
