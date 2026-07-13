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
