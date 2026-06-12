import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Project, ts } from 'ts-morph'
import { validateGraph } from '@uigraph/core'
import { buildProject, extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('extractGraph — sample-react-app golden (F2.7)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
  const { graph, soundiness } = extractGraph(buildProject(dir), dir)

  it('produces a graph that satisfies the core invariants', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('extracts exactly the declared route nodes', () => {
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(
      new Set(['n_root', 'n_login', 'n_dashboard', 'n_dashboard_settings', 'n_products', 'n_products_id', 'n_checkout', 'n_wildcard']),
    )
  })

  it('extracts the expected edge count and modality split', () => {
    expect(graph.edges).toHaveLength(13)
    expect(graph.edges.filter((e) => e.modality === 'must')).toHaveLength(10)
    expect(graph.edges.filter((e) => e.modality === 'may')).toHaveLength(3)
  })

  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  it('emits literal navigations as must-edges', () => {
    expect(hasEdge('n_root', 'n_login', 'must')).toBe(true)
    expect(hasEdge('n_login', 'n_dashboard', 'must')).toBe(true)
    expect(hasEdge('n_wildcard', 'n_root', 'must')).toBe(true)
  })

  it('emits guarded navigations as may-edges with symbolic guard text', () => {
    expect(hasEdge('n_dashboard', 'n_login', 'may')).toBe(true)
    const guarded = graph.edges.find((e) => e.from === 'n_dashboard' && e.to === 'n_login')
    expect(guarded?.guard).toContain('isAuthenticated')
  })

  it('over-approximates a template target to a may-edge', () => {
    expect(hasEdge('n_products', 'n_products_id', 'may')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })
})

describe('extractGraph — in-memory units (F2.4/F2.5)', () => {
  it('captures an if-guard as a may-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); if (loggedIn) { navigate('/b') } return null }`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('loggedIn')
  })

  it('treats an unconditional navigate as a must-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); return <button onClick={() => navigate('/b')}>go</button> }`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_b')?.modality).toBe('must')
  })

  it('resolves react-router v5 render-prop routes', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Switch><Route path="/a" render={() => <A/>} /><Route path="/b" render={() => <B/>} /></Switch>)`,
        '/A.tsx': `import { useHistory } from 'react-router-dom'\nexport default function A(){ const history = useHistory(); return <button onClick={() => history.push('/b')}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.find((n) => n.id === 'n_a')?.componentPath).toBe('A.tsx')
    expect(graph.edges.some((e) => e.from === 'n_a' && e.to === 'n_b' && e.modality === 'must')).toBe(true)
  })

  it('supports react-router v5 component + Redirect', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Switch><Route path="/a" component={A} /><Route path="/b" component={B} /></Switch>)`,
        '/A.tsx': `import { Redirect } from 'react-router-dom'\nexport default function A(){ return <Redirect to="/b" /> }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.edges.some((e) => e.from === 'n_a' && e.to === 'n_b' && e.modality === 'must')).toBe(true)
  })
})
