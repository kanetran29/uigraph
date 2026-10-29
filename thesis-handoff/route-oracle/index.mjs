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
//        node index.mjs --self-check     (asserts the path-boundary predicate and the lazy-module hop on built fixtures; no app needed)

import { Project, SyntaxKind } from 'ts-morph'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const appDir = path.resolve(process.argv[2] || '.')
const dbArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(appDir, 'uigraph.db')
const jsonIdx = process.argv.indexOf('--json')
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null
if (process.argv.includes('--self-check')) {
  selfCheck()
  lazyHopCheck()
  process.exit(0)
}

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
 * Is `root` the directory `dir` itself or one of its ancestors? A path-boundary test, not a
 * string prefix: a bare prefix passes a sibling (`projects/aca` against `projects/aca-content`),
 * and a root may carry a trailing separator (`apps/browser/src/`), so both sides are normalised
 * first. This line has been wrong twice, and no alias root in the corpus is a string prefix of
 * its application without also being an ancestor, so the six corpus runs cannot tell the right
 * predicate from the wrong one; `selfCheck` pins it.
 */
function isSelfOrAncestor(root, dir) {
  return path.join(dir, path.sep).startsWith(path.join(root, path.sep))
}

/**
 * Assert `isSelfOrAncestor` on the cases that matter, so a re-break fails loudly instead of
 * passing every corpus run: a sibling that shares a prefix, with and without a trailing
 * separator, another application's root, `<appDir>-extension` and a descendant must all be
 * added as roots (false); an ancestor and the directory itself, with and without a separator,
 * are already loaded and must be skipped (true). Run with `node index.mjs --self-check`.
 */
function selfCheck() {
  const app = '/w/projects/aca-content'
  const cases = [
    ['sibling sharing a prefix', '/w/projects/aca', app, false],
    ['sibling sharing a prefix, trailing separator', '/w/projects/aca/', app, false],
    ['ancestor', '/w/projects', app, true],
    ['ancestor, trailing separator', '/w/projects/', app, true],
    ['self', app, app, true],
    ['self, trailing separator', `${app}/`, app, true],
    ['another application root, trailing separator', '/w/apps/browser/src/', '/w/apps/web', false],
    ['appDir-extension', '/w/apps/web-extension', '/w/apps/web', false],
    ['descendant', '/w/apps/web/shared', '/w/apps/web', false],
  ]
  for (const [name, root, dir, want] of cases) assert.equal(isSelfOrAncestor(root, dir), want, name)
  console.log(`self-check ok: ${cases.length} path-boundary cases`)
}

/**
 * Assert that a lazily loaded module adopts a routing module only when the table is its own,
 * on applications built in a temp directory. A lazy module that adopts a table it does not own
 * changes no corpus number, so the six corpus runs cannot tell and the check has to build the
 * shape. It runs this script as a child on each application because the walk's state is
 * module-level and bound to one appDir at load. A lazy feature's table is registered with
 * forChild and the application's root table with forRoot, as in a real application.
 *
 * Two hops must still be followed: `feat` importing the `feat-routing` one directory over, and
 * `x` importing its feature table from its own directory by an absolute spelling, which is
 * mifos's shape. Every other case must end as a declared blind spot and never as a route: `a`
 * importing `b`'s routing module, whether `b` loads it directly or through a barrel and however
 * `a` spells the import (absolute from another directory, relative, absolute from the same
 * directory); `admin` importing the application's own root table; the same import two levels
 * below the root, spelled absolutely or relatively, and from the lazy module's own directory
 * while a second root table holds routes of its own; a barrel that re-exports the root table;
 * a table no route loads, imported by an absolute spelling from another directory; and a table
 * that every walk took for a lazy one and none reached, which must leave the application
 * declared as unreadable rather than as having no routes. Run with `node index.mjs --self-check`.
 */
function lazyHopCheck() {
  const head = "import { RouterModule, Routes } from '@angular/router';\n"
  // The source of a routing module that declares the given route literals as one table and registers it with `register`.
  const registered = (register, routes) => `${head}const routes: Routes = [\n${routes.map((r) => `  ${r},`).join('\n')}\n];\nexport const R = RouterModule.${register}(routes);\n`
  // A lazy feature's table, registered with forChild as a real lazy module's is.
  const table = (...routes) => registered('forChild', routes)
  // The application's root table, registered with forRoot.
  const rootTable = (...routes) => registered('forRoot', routes)
  // The source of a route at path `p` that lazy-loads class `c` from module specifier `f`.
  const lazy = (p, f, c) => `{ path: '${p}', loadChildren: () => import('${f}').then((m) => m.${c}) }`
  // Route `b` loads a barrel that re-exports its routing module, and `a`, in `aDir`, imports that routing module as `spec`.
  const behindBarrel = (aDir, spec) => ({
    'app/app-routing.module.ts': rootTable(lazy('a', `./${aDir}/a.module`, 'AModule'), lazy('b', './b/index', 'BRoutingModule')),
    [`app/${aDir}/a.module.ts`]: `import { BRoutingModule } from '${spec}';\nexport class AModule {}\n`,
    'app/b/index.ts': "export { BRoutingModule } from './b-routing.module';\n",
    'app/b/b-routing.module.ts': table("{ path: 'list', component: BList }"),
  })
  // The root table lazy-loads `y`, which has a table of its own and lazy-loads `z`, which has none and imports the root table as `spec`.
  const belowRoot = (spec) => ({
    'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", lazy('y', './y/y.module', 'YModule')),
    'app/y/y.module.ts': table("{ path: 'yy', component: YY }", lazy('z', '../z/z.module', 'ZModule')),
    'app/z/z.module.ts': `import { AppRoutingModule } from '${spec}';\nexport class ZModule {}\n`,
  })
  const cases = [
    {
      name: "a lazy module does not adopt another route's table",
      files: {
        'app/app-routing.module.ts': rootTable(lazy('a', './a/a.module', 'AModule'), lazy('b', './b/b-routing.module', 'BRoutingModule')),
        'app/a/a.module.ts': "import { BRoutingModule } from 'app/b/b-routing.module';\nexport class AModule {}\n",
        'app/b/b-routing.module.ts': table("{ path: 'list', component: BList }"),
      },
      want: '/a[LAZY_UNRESOLVED] /b[PREFIX] /b/list[SCREEN] | blind 1',
    },
    {
      name: "a lazy module does not adopt the application's own root table",
      files: {
        'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", lazy('admin', './admin/admin.module', 'AdminModule')),
        'app/admin/admin.module.ts': "import { AppRoutingModule } from 'app/app-routing.module';\nexport class AdminModule {}\n",
      },
      want: '/home[SCREEN] /admin[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: 'a lazy module still adopts its own routing module, one directory over',
      files: {
        'app/app.module.ts': rootTable(lazy('feat', './feat/feat.module', 'FeatModule')),
        'app/feat/feat.module.ts': "import { FeatRoutingModule } from '../feat-routing/feat-routing.module';\nexport class FeatModule {}\n",
        'app/feat-routing/feat-routing.module.ts': table("{ path: 'list', component: FeatList }"),
      },
      want: '/feat[PREFIX] /feat/list[SCREEN] | blind 0',
    },
    {
      name: "a lazy module does not adopt the table behind another route's barrel",
      files: behindBarrel('a', 'app/b/b-routing.module'),
      want: '/a[LAZY_UNRESOLVED] /b[PREFIX] /b/list[SCREEN] | blind 1',
    },
    {
      name: "a lazy module does not adopt the table behind another route's barrel by a relative import",
      files: behindBarrel('a', '../b/b-routing.module'),
      want: '/a[LAZY_UNRESOLVED] /b[PREFIX] /b/list[SCREEN] | blind 1',
    },
    {
      name: "a lazy module does not adopt the table behind another route's barrel from the same directory",
      files: behindBarrel('b', 'app/b/b-routing.module'),
      want: '/a[LAZY_UNRESOLVED] /b[PREFIX] /b/list[SCREEN] | blind 1',
    },
    {
      name: "a lazy module two levels down does not adopt the application's root table",
      files: belowRoot('app/app-routing.module'),
      want: '/home[SCREEN] /y[PREFIX] /y/yy[SCREEN] /y/z[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: "a lazy module two levels down does not adopt the application's root table by a relative import",
      files: belowRoot('../app-routing.module'),
      want: '/home[SCREEN] /y[PREFIX] /y/yy[SCREEN] /y/z[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: "a lazy module does not adopt a root table that sits in its own directory",
      files: {
        'app/main-routes.ts': rootTable(lazy('y', './y/y.module', 'YModule')),
        'app/y/y.module.ts': table(lazy('z', '../z.module', 'ZModule')),
        'app/z.module.ts': "import { AppRoutingModule } from 'app/app-routing.module';\nexport class ZModule {}\n",
        'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", "{ path: 'settings', component: Settings }"),
      },
      want: '/home[SCREEN] /settings[SCREEN] /y[PREFIX] /y/z[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: "a lazy module does not adopt the application's root table behind its barrel",
      files: {
        'app/main-routes.ts': rootTable(lazy('z', './z/index', 'AppRoutingModule')),
        'app/z/index.ts': "export { AppRoutingModule } from '../app-routing.module';\n",
        'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", "{ path: 'settings', component: Settings }"),
      },
      want: '/home[SCREEN] /settings[SCREEN] /z[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: 'a lazy module still adopts the feature table in its own directory, imported by an absolute spelling',
      files: {
        'app/app-routing.module.ts': rootTable(lazy('x', './x.module', 'XModule')),
        'app/x.module.ts': "import { SharedRoutingModule } from 'app/shared-routing.module';\nexport class XModule {}\n",
        'app/shared-routing.module.ts': table("{ path: 'list', component: SList }"),
      },
      want: '/x[PREFIX] /x/list[SCREEN] | blind 0',
    },
    {
      name: 'a lazy module does not adopt, by an absolute spelling from another directory, a table no route loads',
      files: {
        'app/shared-routing.module.ts': table("{ path: 'home', component: Home }", lazy('y', './y/y.module', 'YModule')),
        'app/y/y.module.ts': table(lazy('z', '../z/z.module', 'ZModule')),
        'app/z/z.module.ts': "import { SharedRoutingModule } from 'app/shared-routing.module';\nexport class ZModule {}\n",
      },
      want: '/home[SCREEN] /y[PREFIX] /y/z[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: 'a table taken for a lazy one that no walk reaches is declared, not dropped',
      files: {
        'app/shared-routing.module.ts': table("{ path: 'home', component: Home }", lazy('y', './y/y.module', 'YModule')),
        'app/y/y.module.ts': table(lazy('z', '../z/z.module', 'ZModule')),
        'app/z/z.module.ts': "import { SharedRoutingModule } from '../shared-routing.module';\nexport class ZModule {}\n",
      },
      want: ' | blind 2',
      reasons: ['route table taken as lazy but reached from no root', 'route table taken as lazy but reached from no root'],
    },
    // The three cases below reach guards that no corpus application reaches and that no earlier
    // fixture pinned: deleting any of them left `--self-check` at exit 0 and all six corpus
    // outputs unchanged, which is the situation the header says the fixtures exist to cover.
    {
      name: "a lazy module does not adopt a sibling project's table imported out of the application",
      tsconfig: '{ "compilerOptions": { "baseUrl": "apps/web/src", "paths": { "@ext/*": ["../../ext/src/*"] } } }\n',
      files: {
        'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", lazy('a', './a/a.module', 'AModule')),
        'app/a/a.module.ts': "import { ExtRoutingModule } from '../../../../../ext/src/app/ext-routing.module';\nexport class AModule {}\n",
      },
      workspaceFiles: { 'ext/src/app/ext-routing.module.ts': table("{ path: 'popup', component: Popup }") },
      want: '/home[SCREEN] /a[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: "a lazy module does not adopt a sibling project's table re-exported out of the application",
      tsconfig: '{ "compilerOptions": { "baseUrl": "apps/web/src", "paths": { "@ext/*": ["../../ext/src/*"] } } }\n',
      files: {
        'app/app-routing.module.ts': rootTable("{ path: 'home', component: Home }", lazy('a', './a/a.module', 'AModule')),
        'app/a/a.module.ts': "export { ExtRoutingModule } from '../../../../../ext/src/app/ext-routing.module';\n",
      },
      workspaceFiles: { 'ext/src/app/ext-routing.module.ts': table("{ path: 'popup', component: Popup }") },
      want: '/home[SCREEN] /a[LAZY_UNRESOLVED] | blind 1',
    },
    {
      name: 'two barrels over one table are refused to both',
      files: {
        'app/app-routing.module.ts': rootTable(lazy('a', './a/index', 'ARoutingModule'), lazy('b', './b/index', 'BRoutingModule')),
        'app/a/index.ts': "export { SharedRoutingModule } from '../shared/shared-routing.module';\n",
        'app/b/index.ts': "export { SharedRoutingModule } from '../shared/shared-routing.module';\n",
        'app/shared/shared-routing.module.ts': table("{ path: 'list', component: SList }"),
      },
      // The shared table itself is then reached from no root, which is the third blind spot.
      want: '/a[LAZY_UNRESOLVED] /b[LAZY_UNRESOLVED] | blind 3',
    },
    {
      name: 'a lazy module adopts the table two hops behind its barrel',
      // bitwarden mounts its reports at `reports`, names ReportsModule through a barrel, and keeps
      // the table in the routing module that feature module imports. One hop found nothing, so the
      // table was left to the root scan and its screens were declared at the application root.
      files: {
        'app/app-routing.module.ts': rootTable(lazy('reports', './reports/index', 'ReportsModule')),
        'app/reports/index.ts': "export { ReportsModule } from './reports.module';\n",
        'app/reports/reports.module.ts': "import { ReportsRoutingModule } from './reports-routing.module';\nexport class ReportsModule {}\n",
        'app/reports/reports-routing.module.ts': table("{ path: 'breach-report', component: Breach }"),
      },
      want: '/reports[PREFIX] /reports/breach-report[SCREEN] | blind 0',
    },
    {
      name: "a second hop does not reach another route's table",
      // The ownership test is asked of the route that named the chain, at every level, so a table
      // another route loads stays that route's however many modules stand in front of it.
      files: {
        'app/app-routing.module.ts': rootTable(lazy('a', './a/index', 'AModule'), lazy('b', './b/b-routing.module', 'BRoutingModule')),
        'app/a/index.ts': "export { AModule } from './a.module';\n",
        'app/a/a.module.ts': "import { BRoutingModule } from '../b/b-routing.module';\nexport class AModule {}\n",
        'app/b/b-routing.module.ts': table("{ path: 'list', component: BList }"),
      },
      want: '/a[LAZY_UNRESOLVED] /b[PREFIX] /b/list[SCREEN] | blind 1',
    },
  ]
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'route-oracle-')))
  try {
    for (const [i, c] of cases.entries()) {
      const root = path.join(tmp, String(i))
      const app = path.join(root, 'apps/web')
      const out = path.join(root, 'out.json')
      fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(path.join(root, 'tsconfig.base.json'), c.tsconfig ?? '{ "compilerOptions": { "baseUrl": "apps/web/src" } }\n')
      for (const [rel, body] of Object.entries(c.files)) {
        const file = path.join(app, 'src', rel)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, body)
      }
      // `workspaceFiles` are written relative to the WORKSPACE root rather than to the measured
      // application, which is the only way to build a sibling project: two of the lazy hop's
      // guards test leaving the project root, and a fixture confined to it cannot reach either.
      for (const [rel, body] of Object.entries(c.workspaceFiles ?? {})) {
        const file = path.join(root, rel)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, body)
      }
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), app, path.join(root, 'none.db'), '--json', out], { encoding: 'utf8' })
      assert.equal(run.status, 0, `${c.name}: ${run.stderr}`)
      const r = JSON.parse(fs.readFileSync(out, 'utf8'))
      assert.equal(`${r.routes.map((x) => `${x.path}[${x.kind}]`).join(' ')} | blind ${r.blindSpots.length}`, c.want, c.name)
      if (c.reasons) assert.deepEqual(r.blindSpots.map((b) => b.reason), c.reasons, c.name)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`self-check ok: ${cases.length} lazy-hop fixtures`)
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
 *
 * An alias root that is `dir0` or an ancestor of it is already loaded, so it is left out of
 * `dirs`. That is a path-boundary test, not a string prefix: `projects/aca` is not an ancestor
 * of `projects/aca-content`, and treating it as one dropped every `@alfresco/aca/*` import's
 * subtree. A root may carry a trailing separator (`apps/browser/src/`), so both sides are
 * normalised before comparing (`isSelfOrAncestor`).
 *
 * TypeScript resolves `paths` targets against baseUrl, and baseUrl against the config's own
 * directory; a non-relative first-party import is resolved against baseUrl alone.
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
      // `paths` targets resolve against baseUrl, itself relative to the config's own directory.
      const baseUrl = path.join(dir, opts?.baseUrl ?? '.')
      const dirs = new Set()
      for (const targets of Object.values(paths ?? {})) {
        for (const t of targets) {
          const target = path.join(baseUrl, String(t).split('*')[0] || '')
          if (target.includes('node_modules') || !fs.existsSync(target)) continue
          const root = fs.statSync(target).isFile() ? path.dirname(target) : target
          if (!isSelfOrAncestor(root, dir0)) dirs.add(root)
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

/**
 * Follow an identifier, property-access chain or template literal to the string constant it
 * names, else null. A template with substitutions is a constant when EVERY substitution is one
 * (`:vaultId/${MY_ITEMS_ROUTE}`, each name a plain exported string): the pieces are joined in
 * source order. Without this branch bitwarden's three routes declared that way read as
 * SCREEN_UNRESOLVED and left the coverage denominator, so the oracle admitted a blind spot it
 * could have read. One substitution that is not a string constant makes the whole template null,
 * never a half-read address: a route path with a hole in it would be an invented one.
 */
function constText(n) {
  if (!n) return null
  const k = n.getKind()
  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) return n.getLiteralValue()
  if (k === SyntaxKind.AsExpression || k === SyntaxKind.ParenthesizedExpression || k === SyntaxKind.SatisfiesExpression) return constText(n.getExpression())
  // A `$localize` tag puts an i18n metadata block (`:kebab-case@@routes.about:`) in front of the message, which is the path.
  if (k === SyntaxKind.TaggedTemplateExpression && /(^|\.)\$localize$/.test(n.getTag().getText())) {
    const tpl = n.getTemplate()
    if (tpl.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) return tpl.getLiteralValue().replace(/^:.*?:/s, '')
  }
  if (k === SyntaxKind.TemplateExpression) {
    let out = n.getHead().getLiteralText()
    for (const span of n.getTemplateSpans()) {
      const v = constText(span.getExpression())
      if (v === null) return null
      out += v + span.getLiteral().getLiteralText()
    }
    return out
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

/**
 * The object literal an identifier or property-access chain names, or undefined.
 *
 * A shared route table is often wrapped in a one-argument call that returns it:
 * `Object.freeze({...})`, `deepFreeze({...})`, a small clone helper. The wrapper is transparent
 * for reading a path out of the table, and not following it was why 27 of bitwarden's declared
 * paths read as unresolvable expressions (`AuthRoute.Login`) when the literal was one call away
 * -- in BOTH tools, so they agreed about screens neither could see. Only a single-argument call
 * is followed: a factory taking more than one argument is not an identity over its first, and
 * reading it as one would invent an address.
 */
function objLit(n) {
  const k = n.getKind()
  // A wrapper call is transparent only with exactly one argument (see above).
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

/**
 * The initializer of the variable an identifier resolves to, following imports, or the property
 * a destructured binding names, which is how a route file reaches a shared table.
 */
function declInit(id) {
  const sym = id.getSymbol()
  const decls = sym?.getAliasedSymbol()?.getDeclarations() ?? sym?.getDeclarations() ?? []
  for (const d of decls) {
    if (d.getKind() === SyntaxKind.VariableDeclaration) return d.getInitializer()
    // `const { create, update } = internalRoutes.accounts.subRoutes` names a property of the object it destructures.
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
  // A baseUrl workspace imports its own modules without a leading dot (`resource/cluster/module`); resolve those against baseUrl, do not discard them.
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
// Files whose route arrays are reached through loadChildren.
const lazyTargets = new Set()
// Every file a route claims as its own table through loadChildren, mapped to the targets that claim it.
// The first pass fills it and the second reads it, so a hop sees every route's claim, not only
// the ones walked so far.
const tableClaims = new Map()
// The files walkArray reached in the current pass.
const walkedFiles = new Set()

/**
 * The project root a loaded file belongs to: this application, or the `paths` alias root that
 * holds it, as a directory path with a trailing separator, else null. A lazy module may sit in
 * an alias root rather than under `appDir`, so a hop out of it is bounded by its own root. The
 * longest match wins because one alias root can nest inside another (`libs/legacy-crypto/src`
 * and `libs/legacy-crypto/src/node`), and the narrower root is the one that owns the file.
 */
function projectRootOf(file) {
  let best = null
  for (const r of [appDir, ...(ws?.dirs ?? [])]) {
    const b = path.join(r, path.sep)
    if (file.startsWith(b) && (!best || b.length > best.length)) best = b
  }
  return best
}

/**
 * The files a module re-exports by a relative specifier, which is how a barrel stands in front
 * of a routing module (`export { FeatRoutingModule } from './feat-routing.module'`). A non-relative
 * specifier is left out because it can name any file in the application.
 */
function relativeReExports(sf) {
  const deps = []
  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue()
    if (!spec || !spec.startsWith('.')) continue
    const dep = exp.getModuleSpecifierSourceFile() ?? resolveModule(sf.getFilePath(), spec)
    if (dep) deps.push(dep)
  }
  return deps
}

// A lazy route names a barrel, the barrel a feature module and the feature module its routing
// module, so the table a loadChildren mounts can sit three files from the one it names.
const LAZY_OWNER_HOPS = 3

/**
 * The table a lazy target mounts when the target holds none itself, found by following what it
 * imports and what it re-exports. The search is breadth-first and stops at the nearest file that
 * holds a table, so a routing module one hop from the feature module is never outranked by an
 * unrelated table further out. Every ownership test the single hop applied is applied at each
 * level, unchanged; what is new is only that a module holding no table is a hop on the way to one
 * rather than a dead end, which is what a barrel in front of a feature module in front of a
 * routing module requires. Returns null when no level yields one.
 */
function tableBehind(target, routeFile, bound) {
  const seen = new Set([target.getFilePath()])
  let frontier = [target]
  for (let hop = 0; hop < LAZY_OWNER_HOPS && frontier.length > 0; hop += 1) {
    const next = []
    for (const from of frontier) {
      for (const dep of hopCandidates(from, routeFile, bound, target)) {
        if (seen.has(dep.getFilePath())) continue
        seen.add(dep.getFilePath())
        const arrays = routeArraysIn(dep)
        if (arrays.length) return { arrays, owner: dep }
        next.push(dep)
      }
    }
    frontier = next
  }
  return null
}

/**
 * The dependencies of one module that a lazy target may adopt a table from: what it imports,
 * then what it re-exports relatively, each held to the bound, ownership and root-table tests the
 * single hop used. `routeFile` is the file the route being followed sits in, whose own table is
 * never adopted; `bound` is the project root that owns the chain; `target` is the module the
 * loadChildren named, which is the claimant the ownership test is asked about at every level,
 * because the whole chain belongs to that one route.
 */
function hopCandidates(from, routeFile, bound, target) {
  const out = []
  /** Keep a dependency unless one of the tests that bound the hop refuses it. */
  const keep = (dep, relative) => {
    if (!dep || !bound || !dep.getFilePath().startsWith(bound)) return
    if (dep.getFilePath() === routeFile.getFilePath() || claimedElsewhere(dep, target)) return
    if (isRootTable(dep)) return
    // A non-relative specifier reaches the whole application, so follow one only into the importing module's own directory.
    if (!relative && path.dirname(dep.getFilePath()) !== path.dirname(from.getFilePath())) return
    out.push(dep)
  }
  for (const imp of from.getImportDeclarations()) {
    keep(imp.getModuleSpecifierSourceFile(), imp.getModuleSpecifierValue().startsWith('.'))
  }
  for (const dep of relativeReExports(from)) keep(dep, true)
  return out
}

/**
 * Record that the route loading `target` claims it, and every file it re-exports by a relative
 * specifier, as its own table. A route that loads a barrel owns the routing module behind the
 * barrel as much as one that loads the routing module itself, so both are claimed.
 */
function claimTables(target) {
  for (const f of [target, ...relativeReExports(target)]) {
    if (!tableClaims.has(f.getFilePath())) tableClaims.set(f.getFilePath(), new Set())
    tableClaims.get(f.getFilePath()).add(target.getFilePath())
  }
}

/**
 * Does a route other than the one loading `target` claim `dep` as its table, whether by loading
 * it or by loading a barrel that re-exports it? Such a table belongs to that route, so adopting
 * it as this target's would mount it at a second address.
 */
function claimedElsewhere(dep, target) {
  for (const t of tableClaims.get(dep.getFilePath()) ?? []) if (t !== target.getFilePath()) return true
  return false
}

/**
 * Does this file register a table with `RouterModule.forRoot`? Such a table is the application's
 * root table: Angular mounts it at the empty path and nowhere else, and a lazy module registers
 * its own with `forChild`, so no lazy module may adopt a `forRoot` table as its own. mifos's
 * `reports-routing.module` registers with `forChild` and is adopted; its `app-routing.module`
 * registers with `forRoot` and is not. No route claims a root table, so `claimedElsewhere` cannot
 * see it. Three limits, all measured rather than assumed. The test reads the file's own `forRoot`
 * call, so a root table whose array is declared in one file and registered in another is not
 * recognised. It reads `RouterModule.forRoot` only, while the recogniser above accepts
 * `forChild` and `provideRouter` as well, so on an application whose root is registered with the
 * standalone API, or through an alias of `RouterModule`, there is no recognisable root table and
 * this guard is inoperative: two of the six evaluated applications, realworld and alfresco, have
 * no `forRoot` call at all. The first limit costs two more, and in a way worth stating precisely
 * because it is easy to state wrongly. ghostfolio declares its root array in `app/app.routes.ts`
 * and registers it in `main.ts`; k8sdash declares its in `index.routing.ts` and registers it in
 * `index.module.ts`. This test DOES answer true for `main.ts` and for `index.module.ts` -- they
 * hold the `forRoot` call -- but neither holds a route of its own, so answering true about them
 * protects nothing: the file a lazy module would adopt is the one holding the ARRAY, and that
 * file answers false. Four of the six applications therefore have no file whose recognition
 * would refuse anything, and only bitwarden and mifos declare and register in one file. And instrumenting it over the whole corpus, it is asked 698 times
 * and answers true NONE of them, because it is asked only of a lazy target's dependencies and no
 * corpus application names a file holding a `forRoot` call there. So the mifos reading above is
 * a counterfactual rather than an observation: `reports-routing.module` is adopted, and
 * `app-routing.module` would be refused if a lazy target ever reached it, which none does. Every
 * piece of evidence that this guard works is a constructed fixture in `--self-check`. Widening
 * the predicate is not the fix, because a library's own `forRoot` is a different thing from the
 * router's; the fix is to resolve each registration call's argument and mark that ARRAY, not the
 * file, as the root table.
 */
function isRootTable(file) {
  return file.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => /RouterModule\.forRoot$/.test(c.getExpression().getText()))
}

/**
 * Walk one route-table array: record every route it declares, then follow each `children` and
 * `loadChildren` into the table beneath it under that route's full path. `unresolved` is the
 * first path expression above this array that could not be followed to a literal; everything
 * beneath it inherits it, because a child of an unreadable path has no readable address
 * either, so a screen there is admitted as a blind spot and not scored as an address.
 * `lazy` marks tables reached through loadChildren.
 *
 * An NgModule loaded lazily often keeps its routes in a separate *-routing.module that it
 * imports, or in a barrel that re-exports one, so a target with no array of its own is followed
 * one level into its imports and then its re-exports: mifos writes
 * `from 'app/reports/reports-routing.module'`, a tsconfig baseUrl specifier, and refusing it
 * left /reports, /reports/:filter and /reports/run/:name out of the declared set altogether.
 * The project is built with the workspace's baseUrl and `paths`, so TypeScript resolves such a
 * specifier itself, and only to a file already loaded. Four tests then decide whether the file
 * it names may be adopted as the target's table, and they guard against different things.
 *
 * The project-root bound (`projectRootOf`) keeps a hop inside the target's own project. Every
 * `paths` alias root is loaded too, and for bitwarden those include sibling applications
 * (apps/browser/src), and a relative specifier can leave the application as easily as an alias
 * can: a lazy apps/web module that imported or re-exported the extension's AppRoutingModule
 * would mint the popup's routes under its own prefix, and a sibling's module that re-exported
 * this application's AppModule would mark that module lazy and erase this application's whole
 * declared set. A null `dep`, which only rules out npm packages, bounds neither. The dependency
 * must sit inside the root that owns the target, not merely beside the target's file, because a
 * routing module may legitimately live a directory over (`../feat-routing/feat-routing.module`).
 *
 * That root is the whole application, so it cannot tell a module's own routing module from
 * another feature's: `feat` importing `feat-routing` and `a` importing `b-routing` look alike.
 * What tells them apart is ownership. A dependency that another route claims (`tableClaims`: the
 * file it loads through loadChildren and the files that file re-exports by a relative specifier,
 * so a barrel in front of a routing module claims it), or the file that holds the route being
 * followed, belongs to that route, so it is never adopted as this target's table: doing so would
 * mount it at a second address.
 *
 * Ownership cannot see a table that no route claims, and the application's root table is the one
 * that matters: it is mounted at the empty path and nowhere else, so a lazy module that adopted
 * it would mount it under a second prefix and take it out of the roots. `isRootTable` tells it
 * apart by how it is registered, whichever directory it sits in and however the import spells it.
 *
 * Nor can ownership see the chain between the route and a non-relative specifier, which can name
 * any file in the application. An import hop therefore follows a non-relative specifier only into
 * the target's own directory, which is what mifos needs.
 * The rule is conservative: two lazy modules importing, from another directory, a routing module no route loads are each declared a blind spot, though Angular would mount its routes under both.
 *
 * A hop any of these refuses leaves the target without a route array, which is declared as a
 * blind spot and not followed.
 *
 * A table the import hop adopts is never recorded as a claim (`claimTables` records the loadChildren
 * target and its re-exports only), so the two hops disagree about a shared table: one routing
 * module imported by two lazy modules is adopted by both and mounted under both prefixes, by a
 * relative specifier from anywhere inside the project root or by a non-relative one naming the
 * target's own directory, while the same module behind two barrels is refused to both. Each reading is defensible under forChild, but
 * the tool gives imports one and barrels the other.
 *
 * One case stays open. None of the tests governs `target` itself, the module a loadChildren
 * names: it is followed as written wherever it resolves, so a specifier that resolves straight
 * into a sibling application's alias root mounts that application's table under this route's
 * prefix. Bounding it by project root closes that but also refuses a shared lazy library that
 * lives in a `paths` alias root, as alfresco's does, and the path alone cannot tell the two apart.
 * The same absence of a test on `target` lets a loadChildren that names the application's own root
 * table mount the whole root table under that route's prefix, silently; `isRootTable` is asked of
 * the DEPENDENCIES of a target, never of the target itself, because a route that names a file
 * directly is taken at its word. The cost is not only the wrong prefix: the adopted table becomes
 * a lazy target, so the root scan no longer reads it, and the addresses the application really
 * mounts leave the route set altogether while the prefixed ones take their place, with no blind
 * spot recorded.
 */
function walkArray(arr, prefix, sf, depth, unresolved = null, lazy = false) {
  if (depth > 12) return
  const key = `${sf.getFilePath()}:${arr.getStart()}:${prefix}`
  if (visitedArrays.has(key)) return
  visitedArrays.add(key)
  walkedFiles.add(sf.getFilePath())

  for (const el of arr.getElements()) {
    // A wrapper helper such as Route.withShell([...]) is transparent: walk its array argument under the same prefix.
    if (el.getKind() === SyntaxKind.CallExpression) {
      for (const a of el.getArguments()) if (a.getKind() === SyntaxKind.ArrayLiteralExpression) walkArray(a, prefix, sf, depth + 1, unresolved, lazy)
      continue
    }
    // A spread is a route source this reader does not follow, so the table it carries is outside
    // the declared set. Saying so is what keeps the set a lower bound rather than a claim: an
    // application whose routes are partly built by a helper and spread in would otherwise be
    // reported as fully read, and every "this path is declared nowhere" taken from it would rest
    // on a table nobody opened.
    if (el.getKind() === SyntaxKind.SpreadElement) {
      blindSpots.push({ reason: 'spread route source: not followed', spec: el.getText().slice(0, 60), at: `${path.relative(appDir, sf.getFilePath())}:${el.getStartLineNumber()}`, prefix })
      continue
    }
    // An array may name its routes instead of spelling them out (`[ERROR_ROUTE]`).
    const obj = el.getKind() === SyntaxKind.ObjectLiteralExpression ? el : objLit(el)
    if (!obj) continue
    const prop = (n) => obj.getProperty(n)
    const pathProp = prop('path')
    const seg = pathProp ? text(pathProp.getInitializer()) : null
    const full = joinPath(prefix, seg) || '/'
    // A path that is not a string literal (e.g. internalRoutes.about.path) makes this route and every route below it depend on constant resolution.
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
    // A bare path with neither component nor children is still a declared address.
    else kind = 'SCREEN'

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
      // Angular also accepts a direct reference, `loadChildren: () => VaultModule`; reading only `import()` left every route behind one unreachable.
      const direct = !m ? /^\(\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\s*$/.exec(t.replace(/^loadChildren\s*:\s*/, '').trim()) : null
      const target = m ? resolveModule(sf.getFilePath(), m[1]) : direct ? importedFile(sf, direct[1]) : null
      if (!target) {
        blindSpots.push({ reason: 'loadChildren target not resolvable', spec: m ? m[1] : t.slice(0, 60), at, prefix: full })
        routes[routes.length - 1].kind = 'LAZY_UNRESOLVED'
      } else {
        claimTables(target)
        let arrays = routeArraysIn(target)
        let owner = target
        const bound = projectRootOf(target.getFilePath())
        if (arrays.length === 0) {
          const behind = tableBehind(target, sf, bound)
          if (behind) { arrays = behind.arrays; owner = behind.owner }
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
routes.length = 0; blindSpots.length = 0; visitedArrays.clear(); walkedFiles.clear()
for (const sf of files) {
  if (lazyTargets.has(sf.getFilePath())) continue
  // A `paths` alias root can be a SIBLING application -- bitwarden's apps/web resolves its
  // imports through apps/browser -- and that application's route table is not this one's.
  // Walking it put 41 of bitwarden's 111 declared screen paths in another app's popup, and
  // the extractor read the same files, so the two tools agreeing about them was not
  // independent evidence of anything. Such a file is still loaded, so imports through the
  // alias resolve; it is only no longer read as a declaration of THIS application.
  // A path-boundary test: a bare string prefix also passes a sibling directory such as `<appDir>-extension`.
  if (!sf.getFilePath().startsWith(appDir + path.sep)) continue
  for (const arr of routeArraysIn(sf)) walkArray(arr, '', sf, 0)
}

// Pass 2 skipped every file pass 1 took for a lazy table. One that no walk then reached was dropped, not absent
// (a lazy module adopting the one table that was the application's only root is the case), so it is declared and never left silent.
// None of the six corpus applications reaches this declaration, so the lazyHopCheck fixture for it is its only evidence.
for (const f of lazyTargets) {
  if (!f.startsWith(appDir + path.sep) || walkedFiles.has(f)) continue
  blindSpots.push({ reason: 'route table taken as lazy but reached from no root', file: path.relative(appDir, f), prefix: '' })
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
