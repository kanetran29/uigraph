// Unit tests for non-literal route `path` resolution (the Outline silent-miss fix):
// helper-call paths (single-return literals and :param-form templates), imported and
// aliased const paths, template-literal paths over const parts, and the loud
// `dynamic-route-path` soundiness note for everything that stays unresolvable —
// covering both JSX <Route path={…}> and data-router `path:` declarations.

import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import { extractGraph } from './extract'

/** Build an in-memory ts-morph project from a path→source map (mirrors extract.test.ts). */
function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('non-literal JSX <Route path={…}> resolution', () => {
  it('resolves a path built by an imported helper returning a string literal', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import Drafts from './Drafts'
import { draftsPath } from './routeHelpers'
export default () => (<Routes><Route path={draftsPath()} element={<Drafts/>} /></Routes>)`,
        '/routeHelpers.ts': `export function draftsPath(): string { return '/drafts' }`,
        '/Drafts.tsx': `export default function Drafts(){ return null }`,
      }),
      '/',
    )
    const n = graph.nodes.find((x) => x.id === 'n_drafts')
    expect(n?.route).toBe('/drafts')
    expect(n?.componentPath).toBe('Drafts.tsx')
    expect(soundiness.filter((s) => s.kind === 'dynamic-route-path')).toEqual([])
  })

  it('resolves a locally declared arrow helper with an expression body', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'
const archivePath = () => '/archive'
export default () => (<Routes><Route path={archivePath()} element={<A/>} /></Routes>)`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.route === '/archive')).toBe(true)
  })

  it('resolves an imported const path, including through an import alias', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'
import B from './B'
import { TRASH, SETTINGS as SETTINGS_PATH } from './paths'
export default () => (<Routes>
  <Route path={TRASH} element={<A/>} />
  <Route path={SETTINGS_PATH} element={<B/>} />
</Routes>)`,
        '/paths.ts': `export const TRASH = '/trash'; export const SETTINGS = '/settings'`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.route === '/trash')).toBe(true)
    expect(graph.nodes.some((n) => n.route === '/settings')).toBe(true)
  })

  it('resolves a template-literal path whose spans are imported consts, stripping param regex groups', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import Doc from './Doc'
import { matchDocumentSlug as documentSlug } from './paths'
export default () => (<Routes><Route path={\`/doc/\${documentSlug}/edit\`} element={<Doc/>} /></Routes>)`,
        '/paths.ts': `export const matchDocumentSlug = ':documentSlug([0-9a-zA-Z-_~]*-[a-zA-z0-9]{10,15})'`,
        '/Doc.tsx': `export default function Doc(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.route === '/doc/:documentSlug/edit')).toBe(true)
  })

  it('maps a template helper param to the :param form when it occupies a whole segment', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import Doc from './Doc'
import Bad from './Bad'
import { docPath, docAnchorPath } from './routeHelpers'
export default () => (<Routes>
  <Route path={docPath(id)} element={<Doc/>} />
  <Route path={docAnchorPath(id)} element={<Bad/>} />
</Routes>)`,
        '/routeHelpers.ts': `export const docPath = (slug: string) => \`/doc/\${slug}\`
export const docAnchorPath = (slug: string) => \`/doc-\${slug}\``,
        '/Doc.tsx': `export default function Doc(){ return null }`,
        '/Bad.tsx': `export default function Bad(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.route === '/doc/:slug')).toBe(true)
    // The non-whole-segment substitution must NOT invent "/doc-:slug" — it degrades loudly.
    expect(graph.nodes.some((n) => n.route?.startsWith('/doc-'))).toBe(false)
    const note = soundiness.find((s) => s.kind === 'dynamic-route-path' && s.detail.includes('docAnchorPath(id)'))
    expect(note?.file).toBe('App.tsx')
    expect(note?.loc?.line).toBeGreaterThan(0)
  })

  it('notes (never guesses) a computed path and a helper too complex to resolve', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'
import { searchPath } from './routeHelpers'
export default (props) => (<Routes>
  <Route path={props.config.path} element={<A/>} />
  <Route path={\`\${searchPath()}/:query?\`} element={<A/>} />
</Routes>)`,
        '/routeHelpers.ts': `export function searchPath(params = {}): string {
  const search = String(params)
  return \`/search\${search ? '?' + search : ''}\`
}`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes).toEqual([])
    const notes = soundiness.filter((s) => s.kind === 'dynamic-route-path')
    expect(notes.some((s) => s.detail.includes('props.config.path'))).toBe(true)
    expect(notes.some((s) => s.detail.includes('searchPath()'))).toBe(true)
  })

  it('skips a child under an unresolvable-path ancestor instead of joining a wrong path', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'
export default (props) => (<Routes>
  <Route path={props.base}>
    <Route path="sub" element={<A/>} />
  </Route>
</Routes>)`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    // "/sub" would be a fabricated path — the subtree is dropped with the ancestor's note.
    expect(graph.nodes).toEqual([])
    expect(soundiness.some((s) => s.kind === 'dynamic-route-path' && s.detail.includes('props.base'))).toBe(true)
  })
})

describe('non-literal data-router `path:` resolution', () => {
  it('resolves helper-call and imported-const paths in a createBrowserRouter table', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import A from './A'
import B from './B'
import { draftsPath, ARCHIVE } from './routeHelpers'
export const router = createBrowserRouter([
  { path: draftsPath(), element: <A /> },
  { path: ARCHIVE, element: <B /> },
])`,
        '/routeHelpers.ts': `export function draftsPath(): string { return '/drafts' }
export const ARCHIVE = '/archive'`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(new Set(graph.nodes.map((n) => n.route))).toEqual(new Set(['/drafts', '/archive']))
    expect(soundiness.filter((s) => s.kind === 'dynamic-route-path')).toEqual([])
  })

  it('notes a computed data-router path as dynamic-route-path with its expression text', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import A from './A'
export const router = createBrowserRouter([
  { path: window.basePath + '/a', element: <A /> },
])`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes).toEqual([])
    const note = soundiness.find((s) => s.kind === 'dynamic-route-path')
    expect(note?.detail).toContain("window.basePath + '/a'")
    expect(note?.file).toBe('router.tsx')
  })
})

// A `*` splat inside a parent route catches only that parent's unmatched URLs, so it is a
// different route from the application's own catch-all. Both used to fold to `*`, mint the one
// node `n_wildcard`, and the first one walked kept it while the other screen vanished.
describe('nested catch-all splat is not the application catch-all', () => {
  it('keeps a JSX splat under a parent route apart from the root splat', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import Admin from './Admin'
import AdminMissing from './AdminMissing'
import NotFound from './NotFound'
export default () => (
  <Routes>
    <Route path="admin" element={<Admin/>}>
      <Route path="*" element={<AdminMissing/>} />
    </Route>
    <Route path="*" element={<NotFound/>} />
  </Routes>)`,
        '/Admin.tsx': `export default function Admin(){ return null }`,
        '/AdminMissing.tsx': `export default function AdminMissing(){ return null }`,
        '/NotFound.tsx': `export default function NotFound(){ return null }`,
      }),
      '/',
    )
    const nested = graph.nodes.find((n) => n.id === 'n_admin_wildcard')
    const root = graph.nodes.find((n) => n.id === 'n_wildcard')
    expect(nested?.route).toBe('/admin/*')
    expect(nested?.componentPath).toBe('AdminMissing.tsx')
    expect(root?.route).toBe('*')
    expect(root?.componentPath).toBe('NotFound.tsx')
  })

  it('keeps a data-router splat under a parent route apart from the root splat', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Admin from './Admin'
import AdminMissing from './AdminMissing'
import NotFound from './NotFound'
export const router = createBrowserRouter([
  { path: 'admin', element: <Admin />, children: [{ path: '*', element: <AdminMissing /> }] },
  { path: '*', element: <NotFound /> },
])`,
        '/Admin.tsx': `export default function Admin(){ return null }`,
        '/AdminMissing.tsx': `export default function AdminMissing(){ return null }`,
        '/NotFound.tsx': `export default function NotFound(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_admin_wildcard')?.route).toBe('/admin/*')
    expect(graph.nodes.find((n) => n.id === 'n_wildcard')?.route).toBe('*')
  })

  it('still folds a splat under a root-path layout to the root catch-all', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import Layout from './Layout'
import NotFound from './NotFound'
export default () => (
  <Routes>
    <Route path="/" element={<Layout/>}>
      <Route path="*" element={<NotFound/>} />
    </Route>
  </Routes>)`,
        '/Layout.tsx': `export default function Layout(){ return null }`,
        '/NotFound.tsx': `export default function NotFound(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_wildcard')?.route).toBe('*')
  })
})

// react-router v6 lets a child declare an absolute path that extends its parent, so the ancestor
// chain legitimately repeats the prefix. The parent must be resolved, not flattened: flattening
// minted /dashboard/dashboard/admin/…, an address the application never mounts.
describe('an absolute child path that extends its parent is not doubled', () => {
  const files = {
    '/Dash.tsx': `export default function Dash(){ return null }`,
    '/Admin.tsx': `export default function Admin(){ return null }`,
    '/AdminMissing.tsx': `export default function AdminMissing(){ return null }`,
    '/Reports.tsx': `export default function Reports(){ return null }`,
  }

  it('resolves a JSX splat under an absolute-child ancestor to the mounted address', () => {
    const { graph } = extractGraph(
      inMemory({
        ...files,
        '/App.tsx': `import Dash from './Dash'
import Admin from './Admin'
import AdminMissing from './AdminMissing'
export default () => (
  <Routes>
    <Route path="/dashboard" element={<Dash/>}>
      <Route path="/dashboard/admin" element={<Admin/>}>
        <Route path="*" element={<AdminMissing/>} />
      </Route>
    </Route>
  </Routes>)`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_dashboard_admin_wildcard')?.route).toBe('/dashboard/admin/*')
    expect(graph.nodes.some((n) => n.route?.includes('/dashboard/dashboard'))).toBe(false)
  })

  it('resolves a JSX relative child under an absolute-child ancestor to the mounted address', () => {
    const { graph } = extractGraph(
      inMemory({
        ...files,
        '/App.tsx': `import Dash from './Dash'
import Admin from './Admin'
import Reports from './Reports'
export default () => (
  <Routes>
    <Route path="/dashboard" element={<Dash/>}>
      <Route path="/dashboard/admin" element={<Admin/>}>
        <Route path="reports" element={<Reports/>} />
      </Route>
    </Route>
  </Routes>)`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_dashboard_admin_reports')?.route).toBe('/dashboard/admin/reports')
    expect(graph.nodes.some((n) => n.route?.includes('/dashboard/dashboard'))).toBe(false)
  })

  it('resolves the same two shapes in a data-router table', () => {
    const { graph } = extractGraph(
      inMemory({
        ...files,
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Dash from './Dash'
import Admin from './Admin'
import AdminMissing from './AdminMissing'
import Reports from './Reports'
export const router = createBrowserRouter([
  { path: '/dashboard', element: <Dash />, children: [
    { path: '/dashboard/admin', element: <Admin />, children: [
      { path: '*', element: <AdminMissing /> },
      { path: 'reports', element: <Reports /> },
    ] },
  ] },
])`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_dashboard_admin_wildcard')?.route).toBe('/dashboard/admin/*')
    expect(graph.nodes.find((n) => n.id === 'n_dashboard_admin_reports')?.route).toBe('/dashboard/admin/reports')
    expect(graph.nodes.some((n) => n.route?.includes('/dashboard/dashboard'))).toBe(false)
  })
})

describe('two declarations at one address (F-react-adapter)', () => {
  it('declares the collision when a nested splat and a literal segment take the same node id', () => {
    // `/admin/*` and `/admin/wildcard` hash to one id, and the second declaration used to be
    // dropped with a bare continue: a screen left the graph with nothing said about it.
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import Admin from './Admin'
import AdminNF from './AdminNF'
import W from './W'
export default () => (<Routes><Route path="admin" element={<Admin/>}><Route path="*" element={<AdminNF/>}/><Route path="wildcard" element={<W/>}/></Route></Routes>)`,
        '/Admin.tsx': `export default function Admin(){ return null }`,
        '/AdminNF.tsx': `export default function AdminNF(){ return null }`,
        '/W.tsx': `export default function W(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/admin', '/admin/*'])
    expect(soundiness.filter((n) => n.kind === 'route-address-collision')).toHaveLength(1)
  })
})

describe('two declarations at one address in a data-router config (F-react-adapter)', () => {
  it('declares the collision instead of dropping the second declaration', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/routes.tsx': `import A from './A'
import B from './B'
export const router = createBrowserRouter([{ path: '/dash', element: <A/> }, { path: '/dash', element: <B/> }])`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/dash'])
    expect(soundiness.filter((n) => n.kind === 'route-address-collision')).toHaveLength(1)
  })
})

describe('quoted and computed route keys (F-react-adapter)', () => {
  it('reads a data-router config whose keys are quoted, instead of reading it as empty', () => {
    // ts-morph's getProperty compares against getName(), which keeps a quoted key's quotes, so
    // the whole config was read as holding no routes: no node, no note, every link into it dead.
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/routes.tsx': `import A from './A'
import B from './B'
export const router = createBrowserRouter([{ "path": '/a', "element": <A/> }, { "path": '/b', "element": <B/> }])`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/a', '/b'])
    expect(soundiness.filter((n) => n.kind === 'dynamic-route-path')).toEqual([])
    // Not only the paths: the quoted `element` has to be read too, or the nodes carry no
    // component and the graph says two screens exist with nothing rendering at either.
    expect(graph.nodes.map((n) => n.label).sort()).toEqual(['A', 'B'])
  })

  it('resolves a computed key through its own scope, not the module-level name', () => {
    // `getVariableDeclaration` on the file answers with the module-level `path`, so a key
    // shadowed inside the factory was read with the outer value and a route minted at an
    // address this config never names.
    const { graph } = extractGraph(
      inMemory({
        '/routes.tsx': `import A from './A'
import B from './B'
const path = 'path'
export function makeRouter() {
  const path = 'id'
  return createBrowserRouter([{ [path]: '/alpha', element: <A/> }, { path: '/beta', element: <B/> }])
}`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/beta'])
  })

  it('reads a computed key whose constant is imported from another file', () => {
    const { graph } = extractGraph(
      inMemory({
        '/keys.ts': `export const K = 'path'`,
        '/routes.tsx': `import A from './A'
import { K } from './keys'
export const router = createBrowserRouter([{ [K]: '/a', element: <A/> }])`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/a'])
  })

  it('does not read a computed key from a binding that is reassigned', () => {
    const { graph } = extractGraph(
      inMemory({
        '/routes.tsx': `import A from './A'
import B from './B'
let K = 'path'
K = 'id'
export const router = createBrowserRouter([{ path: '/b', element: <B/> }, { [K]: '/alpha', element: <A/> }])`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/b'])
  })

  it('does not read a computed key by its spelling', () => {
    // `{ [path]: '/a' }` where `const path = 'id'` declares an id, not an address; matching the
    // key by how its expression is spelled minted a node at an address the application never
    // mounts, which is the one error the deterministic tier may not make.
    const { graph } = extractGraph(
      inMemory({
        '/routes.tsx': `import A from './A'
import B from './B'
const path = 'id'
export const router = createBrowserRouter([{ [path]: '/a', element: <A/> }, { path: '/b', element: <B/> }])`,
        '/A.tsx': `export default function A(){ return null }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/b'])
  })
})
