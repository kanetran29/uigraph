// Unit tests for react-router DATA-ROUTER extraction: createBrowserRouter/
// createHashRouter/createMemoryRouter object config (flat, nested+index, redirect
// elements, wrapper unwrap, lazy components, dynamic-config soundiness,
// createRoutesFromElements) plus the target-precision upgrades that shipped with it
// (imported as-const route maps, object-form navigate).

import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import { extractGraph } from './extract'

/** Build an in-memory ts-morph project from a path→source map (mirrors extract.test.ts). */
function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('collectDataRoutes — object route tables', () => {
  it('extracts a flat createBrowserRouter table (element, Component, catch-all) and its nav edges', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Home from './Home'
import About from './About'
import NotFound from './NotFound'
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/about', Component: About },
  { path: '*', element: <NotFound /> },
])`,
        '/Home.tsx': `import { useNavigate } from 'react-router-dom'
export default function Home(){ const navigate = useNavigate(); return <button onClick={() => navigate('/about')}>about</button> }`,
        '/About.tsx': `export default function About(){ return null }`,
        '/NotFound.tsx': `export default function NotFound(){ return null }`,
      }),
      '/',
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_about', 'n_wildcard']))
    const e = graph.edges.find((x) => x.from === 'n_root' && x.to === 'n_about')
    expect(e?.modality).toBe('must')
  })

  it('extracts createHashRouter and createMemoryRouter tables the same way', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createHashRouter, createMemoryRouter } from 'react-router-dom'
import H from './H'
import M from './M'
export const hash = createHashRouter([{ path: '/h', element: <H /> }])
export const mem = createMemoryRouter([{ path: '/m', element: <M /> }])`,
        '/H.tsx': `export default function H(){ return null }`,
        '/M.tsx': `export default function M(){ return null }`,
      }),
      '/',
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_h', 'n_m']))
  })

  it('joins nested children: index child claims the parent path, relative child joins, absolute child stays absolute', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Layout from './Layout'
import Index from './Index'
import Detail from './Detail'
import Abs from './Abs'
export const router = createBrowserRouter([
  { path: '/products', element: <Layout />, children: [
    { index: true, element: <Index /> },
    { path: ':productId', element: <Detail /> },
    { path: '/abs', element: <Abs /> },
  ] },
])`,
        '/Layout.tsx': `export default function Layout(){ return null }`,
        '/Index.tsx': `export default function Index(){ return null }`,
        '/Detail.tsx': `export default function Detail(){ return null }`,
        '/Abs.tsx': `export default function Abs(){ return null }`,
      }),
      '/',
    )
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    expect(byId.get('n_products')?.route).toBe('/products')
    expect(byId.get('n_products')?.componentPath).toBe('Index.tsx')
    expect(byId.get('n_products_productId')?.route).toBe('/products/:productId')
    expect(byId.get('n_abs')?.route).toBe('/abs')
  })

  it('emits a redirect-only <Navigate to> route as a node PLUS a must redirect edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter, Navigate } from 'react-router-dom'
import New from './New'
export const router = createBrowserRouter([
  { path: '/legacy', element: <Navigate to="/new" replace /> },
  { path: '/new', element: <New /> },
])`,
        '/New.tsx': `export default function New(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.id === 'n_legacy')).toBe(true)
    const e = graph.edges.find((x) => x.from === 'n_legacy' && x.to === 'n_new')
    expect(e?.modality).toBe('must')
    expect(e?.event).toBe('redirect')
  })

  it('unwraps a children-forwarding wrapper to the wrapped page and scans the wrapper for its own redirect', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Protected from './Protected'
import Account from './Account'
import Login from './Login'
export const router = createBrowserRouter([
  { path: '/account', element: (<Protected><Account /></Protected>) },
  { path: '/login', element: <Login /> },
])`,
        '/Protected.tsx': `import { Navigate } from 'react-router-dom'
export default function Protected({ children }) { const ok = false; return ok ? <>{children}</> : <Navigate to="/login" /> }`,
        '/Account.tsx': `export default function Account(){ return <p>account</p> }`,
        '/Login.tsx': `export default function Login(){ return null }`,
      }),
      '/',
    )
    const account = graph.nodes.find((n) => n.id === 'n_account')
    expect(account?.componentPath).toBe('Account.tsx')
    const e = graph.edges.find((x) => x.from === 'n_account' && x.to === 'n_login')
    expect(e?.modality).toBe('may')
  })

  it('resolves a React.lazy element (through <Suspense>) and a route-level lazy to their files; notes an unresolvable lazy', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/router.tsx': `import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import Home from './Home'
const Help = lazy(() => import('./Help'))
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/help', element: <Suspense fallback={<p>Loading</p>}><Help /></Suspense> },
  { path: '/settings', lazy: () => import('./Settings') },
  { path: '/broken', lazy: loadBroken },
])`,
        '/Home.tsx': `export default function Home(){ return null }`,
        '/Help.tsx': `import { Link } from 'react-router-dom'
export default function Help(){ return <Link to="/">home</Link> }`,
        '/Settings.tsx': `export default function Settings(){ return null }`,
      }),
      '/',
    )
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    expect(byId.get('n_help')?.componentPath).toBe('Help.tsx')
    expect(byId.get('n_settings')?.componentPath).toBe('Settings.tsx')
    expect(byId.get('n_broken')).toBeDefined()
    expect(graph.edges.some((x) => x.from === 'n_help' && x.to === 'n_root' && x.modality === 'must')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'dynamic-route-config' && s.detail.includes('/broken'))).toBe(true)
  })

  it('notes (never guesses) dynamic route config: variable arg, spread entry, non-literal path', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Home from './Home'
import { extra, dyn } from './extra'
export const a = createBrowserRouter(externalRoutes)
export const b = createBrowserRouter([
  { path: '/', element: <Home /> },
  ...extra,
  { path: dyn, element: <Home /> },
])`,
        '/Home.tsx': `export default function Home(){ return null }`,
        '/extra.ts': `export const extra = []; export const dyn = '/x'`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_root'])
    const notes = soundiness.filter((s) => s.kind === 'dynamic-route-config')
    expect(notes.length).toBe(3)
  })

  it('reads createRoutesFromElements(<Route>…) through the existing JSX walker, nesting included', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter, createRoutesFromElements, Route } from 'react-router-dom'
import Home from './Home'
import A from './A'
export const router = createBrowserRouter(createRoutesFromElements(
  <Route path="/" element={<Home />}>
    <Route path="a" element={<A />} />
  </Route>,
))`,
        '/Home.tsx': `export default function Home(){ return null }`,
        '/A.tsx': `export default function A(){ return null }`,
      }),
      '/',
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_a']))
  })

  it('dedupes by route path with JSX declarations winning over data-router config', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import X1 from './X1'
export default () => (<Routes><Route path="/x" element={<X1/>} /></Routes>)`,
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import X2 from './X2'
export const r = createBrowserRouter([{ path: '/x', element: <X2 /> }])`,
        '/X1.tsx': `export default function X1(){ return null }`,
        '/X2.tsx': `export default function X2(){ return null }`,
      }),
      '/',
    )
    const xNodes = graph.nodes.filter((n) => n.route === '/x')
    expect(xNodes).toHaveLength(1)
    expect(xNodes[0]?.componentPath).toBe('X1.tsx')
  })
})

describe('classifyTarget upgrades shipped with data-router support', () => {
  it('resolves navigate(ROUTES.key) through an imported as-const route map to a must-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import Pricing from './Pricing'
import Account from './Account'
export const r = createBrowserRouter([
  { path: '/pricing', element: <Pricing /> },
  { path: '/account', element: <Account /> },
])`,
        '/routes.ts': `export const ROUTES = { account: '/account' } as const`,
        '/Pricing.tsx': `import { useNavigate } from 'react-router-dom'
import { ROUTES } from './routes'
export default function Pricing(){ const navigate = useNavigate(); return <button onClick={() => navigate(ROUTES.account)}>go</button> }`,
        '/Account.tsx': `export default function Account(){ return null }`,
      }),
      '/',
    )
    expect(graph.edges.some((x) => x.from === 'n_pricing' && x.to === 'n_account' && x.modality === 'must')).toBe(true)
  })

  it('resolves object-form navigate({ pathname }) as a literal target', () => {
    const { graph } = extractGraph(
      inMemory({
        '/router.tsx': `import { createBrowserRouter } from 'react-router-dom'
import A from './A'
import B from './B'
export const r = createBrowserRouter([
  { path: '/a', element: <A /> },
  { path: '/b', element: <B /> },
])`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'
export default function A(){ const navigate = useNavigate(); return <button onClick={() => navigate({ pathname: '/b', search: '?sort=price' })}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.edges.some((x) => x.from === 'n_a' && x.to === 'n_b' && x.modality === 'must')).toBe(true)
  })
})
