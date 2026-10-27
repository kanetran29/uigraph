#!/usr/bin/env node
// Independent Angular route-configuration oracle.
//
// PURPOSE: measure whether every route an Angular app DECLARES appears as a node in
// an extracted uigraph. This is Test C of the thesis evaluation plan.
//
// INDEPENDENCE IS THE POINT: this parser deliberately shares no code with
// @ui-graph/adapter-angular. It re-reads the router configuration with ts-morph
// using its own, deliberately simple rules, so that agreement between the two is
// evidence rather than tautology. It is meant to be auditable, not clever.
//
// It classifies every declared route, because "declared route" and "graph node" are
// NOT the same set and comparing raw counts is meaningless:
//   SCREEN      has component/loadComponent  -> MUST appear as a node
//   PREFIX      no component, only children  -> must NOT appear (it is a path prefix)
//   REDIRECT    has redirectTo               -> must NOT appear (it is not a screen)
//   WILDCARD    path '**'                    -> policy: not counted as a screen
//   MATCHER     custom UrlMatcher            -> path is not statically knowable; a blind spot
//   LAZY_UNRESOLVED  loadChildren we could not follow -> counted as a known blind spot
//   SCREEN_UNRESOLVED  would be a SCREEN, but its own path or a parent's is an expression
//               we could not follow to a literal -> a blind spot, NOT scored: it has no
//               address to look up, and its recorded path is the expression, not an address
//
// Coverage is reported over SCREEN routes only. Everything unresolvable is reported
// explicitly rather than dropped, in the soundiness tradition: a number you cannot
// account for is worse than a number you admit you do not have.
//
// Usage: node index.mjs <appDir> [pathToUigraphDb] [--json out.json]

import { Project, SyntaxKind } from 'ts-morph'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

const appDir = path.resolve(process.argv[2] || '.')
const dbArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(appDir, 'uigraph.db')
const jsonIdx = process.argv.indexOf('--json')
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null

// ---------------------------------------------------------------- load sources

/**
 * JSON text with its `//` and block comments removed, for a tsconfig, which TypeScript reads
 * as JSON-with-comments. It scans rather than pattern-matches because a comment opener can sit
 * inside a string: the key "@alfresco/aca-playwright-shared/*" holds `/*`, and a regex took
 * it for a block comment, ate the rest of the file and left alfresco with no `paths` at all.
 */
function stripJsonComments(txt) {
  let out = ''
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (c === '"') {
      let j = i + 1
      while (j < txt.length && txt[j] !== '"') j += txt[j] === '\\' ? 2 : 1
      out += txt.slice(i, j + 1)
      i = j
    } else if (c === '/' && txt[i + 1] === '/') {
      while (i + 1 < txt.length && txt[i + 1] !== '\n') i++
    } else if (c === '/' && txt[i + 1] === '*') {
      const end = txt.indexOf('*/', i + 2)
      i = end === -1 ? txt.length : end + 1
    } else {
      out += c
    }
  }
  return out
}

/**
 * The workspace tsconfig's `paths` aliases and the directories they point at. A monorepo app
 * can declare its route paths in a shared table it imports through an alias, and without the
 * alias the checker cannot follow that import, so every such path stays an unresolved
 * expression. Harness 1.4.0; before it this oracle recorded `internalRoutes.account.path` as
 * the route's path, which matched no graph node and scored those apps at zero.
 *
 * An alias may name a file (`.../src/public-api.ts`) as often as a directory. The sources to
 * load are then the file's directory: a glob beneath a file matches nothing, so those
 * sources were never added and the alias could not be followed into them.
 */
function workspaceTsPaths(dir0) {
  let dir = dir0
  for (let up = 0; up < 5; up++) {
    for (const name of ['tsconfig.base.json', 'tsconfig.json']) {
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) continue
      let opts
      try {
        const txt = stripJsonComments(fs.readFileSync(file, 'utf8')).replace(/,(\s*[}\]])/g, '$1')
        opts = JSON.parse(txt).compilerOptions
      } catch { continue }
      const paths = opts?.paths
      if (!opts?.baseUrl && (!paths || Object.keys(paths).length === 0)) continue
      // TypeScript resolves `paths` targets against baseUrl, and baseUrl against the config's
      // own directory; a non-relative first-party import is resolved against baseUrl alone.
      const baseUrl = path.join(dir, opts?.baseUrl ?? '.')
      const dirs = new Set()
      for (const targets of Object.values(paths ?? {})) {
        for (const t of targets) {
          const target = path.join(baseUrl, String(t).split('*')[0] || '')
          if (target.includes('node_modules') || !fs.existsSync(target)) continue
          const root = fs.statSync(target).isFile() ? path.dirname(target) : target
          if (!dir0.startsWith(root)) dirs.add(root)
        }
      }
      return { baseUrl, paths: paths ?? {}, dirs: [...dirs] }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const ws = workspaceTsPaths(appDir)
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: false, ...(ws ? { baseUrl: ws.baseUrl, paths: ws.paths } : {}) },
})
// A Storybook story builds a throwaway route table (`/foo`, `/bar`, `/active`) to render one
// component in isolation. Those paths are fixtures that exist only inside the story, so a
// *.stories.ts file declares no screen of the application; read, they put fixture paths into
// the denominator coverage is scored against (31 of bitwarden's 225 screen routes).
project.addSourceFilesAtPaths([
  `${appDir}/**/*.ts`,
  `!${appDir}/**/node_modules/**`,
  `!${appDir}/**/*.spec.ts`,
  `!${appDir}/**/*.test.ts`,
  `!${appDir}/**/*.stories.ts`,
  `!${appDir}/**/dist/**`,
])
for (const d of ws?.dirs ?? []) {
  project.addSourceFilesAtPaths([`${d}/**/*.ts`, `!${d}/**/node_modules/**`, `!${d}/**/*.spec.ts`, `!${d}/**/*.stories.ts`, `!${d}/**/dist/**`])
}
const files = project.getSourceFiles()
// The glob above drops Storybook files before parsing, so they leave no trace in `routes`.
// This script's own rule is that a number it cannot account for is worse than one it admits
// it does not have, and a denominator that shrinks silently is the one way it could flatter
// the extractor it exists to check. Count them back, separately, and report it.
function countStoryFiles(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) n += countStoryFiles(full)
    else if (/\.stories\.ts$/.test(e.name)) n++
  }
  return n
}
const storyFiles = countStoryFiles(appDir)

// ---------------------------------------------------------------- helpers

const text = (n) => (n ? constText(n) ?? n.getText().replace(/^['"`]|['"`]$/g, '') : null)

/** Follow an identifier or property-access chain to the string constant it names, else null. */
function constText(n) {
  if (!n) return null
  const k = n.getKind()
  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) return n.getLiteralValue()
  if (k === SyntaxKind.AsExpression || k === SyntaxKind.ParenthesizedExpression || k === SyntaxKind.SatisfiesExpression) return constText(n.getExpression())
  // `$localize`:kebab-case@@routes.about:about`` — a constant with an i18n metadata block in
  // front of it; the path is the message after it.
  if (k === SyntaxKind.TaggedTemplateExpression && /(^|\.)\$localize$/.test(n.getTag().getText())) {
    const tpl = n.getTemplate()
    if (tpl.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) return tpl.getLiteralValue().replace(/^:.*?:/s, '')
  }
  if (k === SyntaxKind.Identifier) return constText(declInit(n))
  if (k === SyntaxKind.PropertyAccessExpression) {
    const obj = objLit(n.getExpression())
    const p = obj?.getProperty(n.getName())
    if (p && p.getKind() === SyntaxKind.PropertyAssignment) return constText(p.getInitializer())
    // A route table is as often an enum as an object: `path: AuthRoute.Login`.
    const m = enumDecl(n.getExpression())?.getMember(n.getName())
    const v = m?.getValue()
    return typeof v === 'string' ? v : constText(m?.getInitializer())
  }
  return null
}

/** The enum an identifier names, following imports, or undefined. */
function enumDecl(n) {
  if (n.getKind() !== SyntaxKind.Identifier) return undefined
  const sym = n.getSymbol()
  const decls = sym?.getAliasedSymbol()?.getDeclarations() ?? sym?.getDeclarations() ?? []
  for (const d of decls) if (d.getKind() === SyntaxKind.EnumDeclaration) return d
  return undefined
}

/** The object literal an identifier or property-access chain names, or undefined. */
function objLit(n) {
  const k = n.getKind()
  // A shared route table is often wrapped in a one-argument call that returns it:
  // `Object.freeze({...})`, `deepFreeze({...})`, a small clone helper. The wrapper is
  // transparent for reading a path out of the table, and not following it was why 27 of
  // bitwarden's declared paths read as unresolvable expressions (`AuthRoute.Login`) when the
  // literal was one call away -- in BOTH tools, so they agreed about screens neither could see.
  // Only a single-argument call is followed: a factory taking more than one argument is not an
  // identity over its first, and reading it as one would invent an address.
  if (k === SyntaxKind.CallExpression) {
    const args = n.getArguments()
    return args.length === 1 ? objLit(args[0]) : undefined
  }
  if (k === SyntaxKind.AsExpression || k === SyntaxKind.ParenthesizedExpression || k === SyntaxKind.SatisfiesExpression) return objLit(n.getExpression())
  if (k === SyntaxKind.ObjectLiteralExpression) return n
  if (k === SyntaxKind.Identifier) { const i = declInit(n); return i ? objLit(i) : undefined }
  if (k === SyntaxKind.PropertyAccessExpression) {
    const obj = objLit(n.getExpression())
    const p = obj?.getProperty(n.getName())
    const i = p && p.getKind() === SyntaxKind.PropertyAssignment ? p.getInitializer() : undefined
    return i ? objLit(i) : undefined
  }
  return undefined
}

/** The initializer of the variable an identifier resolves to, following imports. */
function declInit(id) {
  const sym = id.getSymbol()
  const decls = sym?.getAliasedSymbol()?.getDeclarations() ?? sym?.getDeclarations() ?? []
  for (const d of decls) {
    if (d.getKind() === SyntaxKind.VariableDeclaration) return d.getInitializer()
    // `const { create, update } = internalRoutes.accounts.subRoutes` names a property of the
    // object it destructures, which is how a route file reaches a shared table.
    if (d.getKind() === SyntaxKind.BindingElement) {
      const vd = d.getParent()?.getParent()
      const init = vd && vd.getKind() === SyntaxKind.VariableDeclaration ? vd.getInitializer() : undefined
      const prop = init ? objLit(init)?.getProperty(d.getName()) : undefined
      if (prop && prop.getKind() === SyntaxKind.PropertyAssignment) return prop.getInitializer()
    }
  }
  return undefined
}

/** Join a parent route prefix with a child path segment, Angular-style. */
function joinPath(prefix, seg) {
  if (seg === null || seg === undefined) return prefix
  if (seg === '') return prefix
  const a = prefix.replace(/\/+$/, '')
  const b = String(seg).replace(/^\/+/, '')
  return `${a}/${b}`
}

/** Is this array literal plausibly a route table? Every element looks like a Route. */
function looksLikeRouteArray(arr) {
  const objs = arr.getElements().filter((e) => e.getKind() === SyntaxKind.ObjectLiteralExpression)
  if (objs.length === 0) return false
  return objs.some((o) =>
    o.getProperties().some((p) => {
      const nm = p.getSymbol()?.getName() || p.getFirstChild()?.getText()
      return ['path', 'redirectTo', 'loadChildren', 'component', 'matcher'].includes(nm)
    })
  )
}

/** Collect route-table array literals in a file: typed `Routes`, or passed to the router APIs. */
function routeArraysIn(sf) {
  const found = []
  // const routes: Routes = [...]
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const t = vd.getTypeNode()?.getText() || ''
    const init = vd.getInitializer()
    if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) continue
    if (/\bRoutes\b|\bRoute\[\]/.test(t) || (/routes?$/i.test(vd.getName()) && looksLikeRouteArray(init))) {
      found.push(init)
    }
  }
  // RouterModule.forRoot([...]) / forChild([...]) / provideRouter([...])
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText()
    if (!/(RouterModule\.(forRoot|forChild)|provideRouter)$/.test(callee)) continue
    const arg = call.getArguments()[0]
    if (!arg) continue
    if (arg.getKind() === SyntaxKind.ArrayLiteralExpression) {
      found.push(arg)
    } else if (arg.getKind() === SyntaxKind.Identifier) {
      const decl = sf.getVariableDeclaration(arg.getText())
      const init = decl?.getInitializer()
      if (init && init.getKind() === SyntaxKind.ArrayLiteralExpression) found.push(init)
    }
  }
  return [...new Set(found)]
}

/** The in-project file an imported identifier resolves to. */
function importedFile(sf, name) {
  for (const imp of sf.getImportDeclarations()) {
    const hit = imp.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === name) || imp.getDefaultImport()?.getText() === name
    if (!hit) continue
    const dep = imp.getModuleSpecifierSourceFile()
    if (dep) return dep
    const spec = imp.getModuleSpecifierValue()
    const r = resolveModule(sf.getFilePath(), spec)
    if (r) return r
  }
  return null
}

/**
 * The path a non-relative specifier maps to through the tsconfig `paths` table, or null. As
 * TypeScript does, the key with the longest matching prefix wins (an exact key is the longest
 * of all) and what its `*` matched replaces the `*` in the target; only the first target is tried.
 * Refusing every scoped specifier, as this oracle did, made a first-party alias import
 * (`@alfresco/aca-content/folder-rules`) read as an npm package, so its lazy table went unread
 * and the module's routes were mounted at the project root instead of under their real prefix.
 */
function aliasBase(spec) {
  let best = null
  for (const [key, targets] of Object.entries(ws?.paths ?? {})) {
    const star = key.endsWith('*')
    const stem = star ? key.slice(0, -1) : key
    if (!targets?.length || !(star ? spec.startsWith(stem) : spec === key)) continue
    if (!best || stem.length > best.stem.length) best = { stem, target: String(targets[0]) }
  }
  return best ? path.join(ws.baseUrl, best.target.replace('*', spec.slice(best.stem.length))) : null
}

/**
 * Resolve a loadChildren module specifier to a source file we already loaded: through the
 * tsconfig `paths` map first, then relative to the importer, then against `baseUrl`. A scoped
 * specifier the map does not name is an npm package and resolves to nothing.
 */
function resolveModule(fromFile, spec) {
  if (!spec) return null
  const aliased = spec.startsWith('.') ? null : aliasBase(spec)
  if (!aliased && spec.startsWith('@')) return null
  // A workspace that sets tsconfig `baseUrl` imports its own modules without a leading dot
  // (`resource/cluster/module`); resolve those against baseUrl rather than discarding them.
  const base = aliased ?? (spec.startsWith('.')
    ? path.resolve(path.dirname(fromFile), spec)
    : ws?.baseUrl
      ? path.resolve(ws.baseUrl, spec)
      : null)
  if (!base) return null
  // `base` itself first: an alias target is often the file, `.../src/public-api.ts`.
  for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts'), `${base}.routes.ts`]) {
    const sf = project.getSourceFile(cand)
    if (sf) return sf
  }
  // An alias names its target exactly, so a miss there is a miss, not a reason to guess by name.
  if (aliased) return null
  // fall back to a basename match, which real monorepos often need
  const want = path.basename(base)
  return files.find((f) => f.getBaseNameWithoutExtension() === want) || null
}

// ---------------------------------------------------------------- walk

const routes = []
const blindSpots = []
const visitedArrays = new Set()
const lazyTargets = new Set() // files whose route arrays are reached through loadChildren

/**
 * Walk one route-table array: record every route it declares, then follow each `children` and
 * `loadChildren` into the table beneath it under that route's full path. `unresolved` is the
 * first path expression above this array that could not be followed to a literal; everything
 * beneath it inherits it, because a child of an unreadable path has no readable address
 * either, so a screen there is admitted as a blind spot and not scored as an address.
 * `lazy` marks tables reached through loadChildren.
 */
function walkArray(arr, prefix, sf, depth, unresolved = null, lazy = false) {
  if (depth > 12) return
  const key = `${sf.getFilePath()}:${arr.getStart()}:${prefix}`
  if (visitedArrays.has(key)) return
  visitedArrays.add(key)

  for (const el of arr.getElements()) {
    // Wrapper helpers such as Route.withShell([...]) return routes built from an array
    // argument. Treat the call as transparent and walk the array with the same prefix.
    if (el.getKind() === SyntaxKind.CallExpression) {
      for (const a of el.getArguments()) if (a.getKind() === SyntaxKind.ArrayLiteralExpression) walkArray(a, prefix, sf, depth + 1, unresolved, lazy)
      continue
    }
    // An array may name its routes instead of spelling them out (`[ERROR_ROUTE]`).
    const obj = el.getKind() === SyntaxKind.ObjectLiteralExpression ? el : objLit(el)
    if (!obj) continue
    const prop = (n) => obj.getProperty(n)
    const pathProp = prop('path')
    const seg = pathProp ? text(pathProp.getInitializer()) : null
    const full = joinPath(prefix, seg) || '/'
    // A path that is not a string literal (e.g. internalRoutes.about.path) makes this route
    // and every route below it depend on constant resolution.
    const pathInit = pathProp?.getInitializer?.()
    // Unreadable only when NOT followed to a literal (a resolved `internalRoutes.account.path` is a good address); the outermost expression's text is kept to name the blind spot.
    const unreadable = unresolved || (pathInit && constText(pathInit) === null ? pathInit.getText() : null)
    const compProp = prop('component') || prop('loadComponent')
    const compText = compProp?.getInitializer?.()?.getText() || null
    // loadComponent: keep the import specifier (a file); component: keep the class name.
    const component = compText ? (compText.match(/import\(\s*['"`]([^'"`]+)/)?.[1] || compText) : null

    const hasComponent = !!(prop('component') || prop('loadComponent'))
    const redirect = prop('redirectTo') ? text(prop('redirectTo').getInitializer()) : null
    const childrenProp = prop('children')
    const loadChildren = prop('loadChildren')
    const matcher = prop('matcher')
    const guards = ['canActivate', 'canActivateChild', 'canMatch', 'canDeactivate']
      .filter((g) => prop(g))
      .map((g) => prop(g).getInitializer()?.getText().replace(/\s+/g, ' ').slice(0, 80))

    let kind
    if (matcher) kind = 'MATCHER'
    else if (redirect !== null) kind = 'REDIRECT'
    else if (seg === '**') kind = 'WILDCARD'
    else if (hasComponent) kind = 'SCREEN'
    else if (childrenProp || loadChildren) kind = 'PREFIX'
    else kind = 'SCREEN' // a bare path with neither component nor children: still a declared address

    const at = `${path.relative(appDir, sf.getFilePath())}:${obj.getStartLineNumber()}`
    // A screen whose path is an expression has no address to look up: admit it, do not score it.
    if (kind === 'SCREEN' && unreadable) {
      kind = 'SCREEN_UNRESOLVED'
      blindSpots.push({ reason: 'screen path not resolvable to a literal', spec: unreadable, at, prefix: full })
    }
    // A UrlMatcher is a function, so the route set under this prefix is a lower bound.
    if (kind === 'MATCHER') blindSpots.push({ reason: 'matcher route: path not statically knowable', spec: matcher.getText().slice(0, 60), at, prefix: full })

    routes.push({
      path: full === '' ? '/' : full.startsWith('/') ? full : `/${full}`,
      kind,
      guards,
      file: path.relative(appDir, sf.getFilePath()),
      line: obj.getStartLineNumber(),
      component,
      constantPath: !!unreadable,
      lazy,
    })

    if (childrenProp) {
      const init = childrenProp.getInitializer()
      if (init && init.getKind() === SyntaxKind.ArrayLiteralExpression) walkArray(init, full, sf, depth + 1, unreadable, lazy)
    }

    if (loadChildren) {
      const t = loadChildren.getText()
      const m = t.match(/import\(\s*['"`]([^'"`]+)['"`]\s*\)/)
      // Angular also accepts `loadChildren: () => VaultModule`, a direct reference with no
      // dynamic import; reading only `import()` left every route behind one unreachable.
      const direct = !m ? /^\(\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\s*$/.exec(t.replace(/^loadChildren\s*:\s*/, '').trim()) : null
      const target = m ? resolveModule(sf.getFilePath(), m[1]) : direct ? importedFile(sf, direct[1]) : null
      if (!target) {
        blindSpots.push({ reason: 'loadChildren target not resolvable', spec: m ? m[1] : t.slice(0, 60), at, prefix: full })
        routes[routes.length - 1].kind = 'LAZY_UNRESOLVED'
      } else {
        let arrays = routeArraysIn(target)
        // An NgModule loaded lazily often keeps its routes in a separate *-routing.module
        // that it imports. Follow the module's relative imports one level.
        let owner = target
        if (arrays.length === 0) {
          for (const imp of target.getImportDeclarations()) {
            const dep = imp.getModuleSpecifierSourceFile()
            if (!dep || !imp.getModuleSpecifierValue().startsWith('.')) continue
            const a = routeArraysIn(dep)
            if (a.length) { arrays = a; owner = dep; break }
          }
        }
        // A barrel re-exports the routes rather than importing them.
        if (arrays.length === 0) {
          for (const exp of target.getExportDeclarations()) {
            const spec = exp.getModuleSpecifierValue()
            if (!spec || !spec.startsWith('.')) continue
            const dep = exp.getModuleSpecifierSourceFile() ?? resolveModule(target.getFilePath(), spec)
            if (!dep) continue
            const a = routeArraysIn(dep)
            if (a.length) { arrays = a; owner = dep; break }
          }
        }
        if (arrays.length) lazyTargets.add(owner.getFilePath())
        if (arrays.length === 0) {
          blindSpots.push({ reason: 'lazy module has no discoverable route array', file: path.relative(appDir, target.getFilePath()), prefix: full })
          routes[routes.length - 1].kind = 'LAZY_UNRESOLVED'
        } else {
          for (const a of arrays) walkArray(a, full, owner, depth + 1, unreadable, true)
        }
      }
    }
  }
}

// Pass 1 discovers which files are lazy targets. Pass 2 starts walks only from files that
// are not, so a lazily loaded table is walked under its real prefix and not also from ''.
// (Harness 1.0.0 walked every table from '' as well, which double-counted lazy screens.)
for (const sf of files) for (const arr of routeArraysIn(sf)) walkArray(arr, '', sf, 0)
routes.length = 0; blindSpots.length = 0; visitedArrays.clear()
for (const sf of files) {
  if (lazyTargets.has(sf.getFilePath())) continue
  // A `paths` alias root can be a SIBLING application -- bitwarden's apps/web resolves its
  // imports through apps/browser -- and that application's route table is not this one's.
  // Walking it put 41 of bitwarden's 111 declared screen paths in another app's popup, and
  // the extractor read the same files, so the two tools agreeing about them was not
  // independent evidence of anything. Such a file is still loaded, so imports through the
  // alias resolve; it is only no longer read as a declaration of THIS application.
  if (!sf.getFilePath().startsWith(appDir)) continue
  for (const arr of routeArraysIn(sf)) walkArray(arr, '', sf, 0)
}

// ---------------------------------------------------------------- compare

const byKind = {}
for (const r of routes) byKind[r.kind] = (byKind[r.kind] || 0) + 1
const screens = routes.filter((r) => r.kind === 'SCREEN')
const uniqScreens = [...new Map(screens.map((r) => [r.path, r])).values()]

let graphNodes = null
let comparison = null
if (fs.existsSync(dbArg)) {
  const db = new DatabaseSync(dbArg)
  const row = db.prepare("select json from docs where key='graph'").get()
  const graph = JSON.parse(row?.json || '{}')
  graphNodes = (graph.nodes || []).filter((n) => ['screen', 'route', 'modal'].includes(n.kind))
  const norm = (p) => (p || '').replace(/\/+$/, '').replace(/^\/?/, '/') || '/'
  const nodeRoutes = new Set(graphNodes.map((n) => norm(n.route)))
  const missing = uniqScreens.filter((r) => !nodeRoutes.has(norm(r.path)))
  const declared = new Set(uniqScreens.map((r) => norm(r.path)))
  const extra = graphNodes.filter((n) => n.route && !declared.has(norm(n.route)))
  comparison = {
    declaredScreens: uniqScreens.length,
    graphNodes: graphNodes.length,
    matched: uniqScreens.length - missing.length,
    coverage: uniqScreens.length ? +((uniqScreens.length - missing.length) / uniqScreens.length).toFixed(4) : null,
    missing: missing.map((r) => ({ path: r.path, at: `${r.file}:${r.line}`, guards: r.guards })),
    extraNodes: extra.map((n) => ({ route: n.route, id: n.id, kind: n.kind })),
  }
}

const report = {
  appDir,
  db: fs.existsSync(dbArg) ? dbArg : null,
  filesParsed: files.length,
  declaredRoutesTotal: routes.length,
  byKind,
  uniqueScreenPaths: uniqScreens.length,
  guardedScreenPaths: uniqScreens.filter((r) => r.guards.length).length,
  blindSpots,
  excluded: { storybookFiles: storyFiles },
  comparison,
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...report, routes }, null, 2))

console.log(`app:            ${appDir}`)
console.log(`files parsed:   ${files.length}`)
console.log(`declared routes:${routes.length}   ${JSON.stringify(byKind)}`)
console.log(`screen paths:   ${uniqScreens.length} unique (${report.guardedScreenPaths} guarded)`)
console.log(`blind spots:    ${blindSpots.length}`)
console.log(`excluded:       ${storyFiles} Storybook file(s), not read as declared screens`)
for (const b of blindSpots.slice(0, 8)) console.log(`   ! ${b.reason}: ${b.spec || b.file} (under ${b.prefix || '/'})`)
if (comparison) {
  console.log(`graph nodes:    ${comparison.graphNodes}`)
  console.log(`COVERAGE:       ${comparison.matched}/${comparison.declaredScreens} = ${(comparison.coverage * 100).toFixed(1)}%`)
  if (comparison.missing.length) {
    console.log(`missing (${comparison.missing.length}):`)
    for (const m of comparison.missing.slice(0, 15)) console.log(`   - ${m.path}   [${m.at}]${m.guards.length ? ' guarded' : ''}`)
    if (comparison.missing.length > 15) console.log(`   ... ${comparison.missing.length - 15} more (see --json)`)
  }
  if (comparison.extraNodes.length) {
    console.log(`nodes with no declared route (${comparison.extraNodes.length}):`)
    for (const e of comparison.extraNodes.slice(0, 8)) console.log(`   + ${e.route}  (${e.kind})`)
  }
} else {
  console.log(`graph:          no db at ${dbArg} — declaration side only`)
}
