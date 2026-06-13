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
      new Set(['n_root', 'n_login', 'n_dashboard', 'n_dashboard_settings', 'n_products', 'n_products_id', 'n_checkout', 'n_showcase', 'n_wildcard']),
    )
  })

  it('extracts the expected edge count and modality split', () => {
    expect(graph.edges).toHaveLength(15)
    expect(graph.edges.filter((e) => e.modality === 'must')).toHaveLength(12)
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

  it('extracts nested controls when opts.controls is set', () => {
    const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
    const { graph, soundiness } = extractGraph(buildProject(dir), dir, { controls: true })

    expect(validateGraph(graph)).toEqual([])
    const controls = graph.nodes.filter((n) => n.kind === 'control')
    expect(controls.length).toBeGreaterThan(0)

    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    for (const c of controls) expect(nodeIds.has(c.parent ?? '')).toBe(true)

    const checkoutControls = controls.filter((c) => c.parent === 'n_checkout')
    expect(checkoutControls.some((c) => c.control?.controlType === 'richtext')).toBe(true)
    expect(checkoutControls.some((c) => c.control?.controlType === 'input')).toBe(true)

    const withApi = controls.find((c) => (c.control?.effects ?? []).some((e) => e.startsWith('api:POST')))
    expect(withApi).toBeDefined()

    const allEvents = new Set(controls.flatMap((c) => c.control?.events ?? []))
    expect(allEvents.has('keydown')).toBe(true)
    expect(allEvents.has('mouseenter')).toBe(true)

    const form = controls.find((c) => c.control?.controlType === 'form')
    expect(form?.control?.effects).toContain('error:setError')
    const successNav = graph.edges.find((e) => e.from === form?.id && e.guard === 'onSuccess')
    expect(successNav?.modality).toBe('may')

    expect(graph.nodes.some((n) => n.kind === 'modal')).toBe(true)
    expect(graph.edges.some((e) => e.effect === 'open:modal')).toBe(true)
    expect(controls.some((c) => c.control?.controlType === 'file')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'dynamic-widget')).toBe(true)

    // The Showcase page exercises the full control/event surface: every native
    // control type is extracted, each named, across the spread of DOM events.
    const showcase = controls.filter((c) => c.parent === 'n_showcase')
    const types = new Set(showcase.map((c) => c.control?.controlType))
    for (const t of ['form', 'input', 'checkbox', 'richtext', 'select', 'button', 'file', 'element']) expect(types.has(t)).toBe(true)
    expect(showcase.every((c) => (c.control?.name ?? '').length > 0)).toBe(true)
    const showcaseEvents = new Set(showcase.flatMap((c) => c.control?.events ?? []))
    for (const ev of ['change', 'input', 'focus', 'blur', 'keyup', 'paste', 'contextmenu', 'doubleclick', 'wheel', 'drop', 'dragstart']) expect(showcaseEvents.has(ev)).toBe(true)

    const productControls = new Set(controls.filter((c) => c.parent === 'n_products').map((c) => c.id))
    const indirect = graph.edges.find(
      (e) => productControls.has(e.from) && e.to === 'n_dashboard' && e.witness?.ruleId === 'rr.use-navigate.interprocedural',
    )
    expect(indirect?.modality).toBe('must')
  })

  it('tags success/error branches and opens modals (F2.5+)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import C from './C'\nexport default () => (<Routes><Route path="/c" element={<C/>} /><Route path="/" element={<C/>} /></Routes>)`,
        '/C.tsx': `import { useState } from 'react'\nimport { useNavigate } from 'react-router-dom'\nfunction Dialog(p){ return p.open ? <div>x</div> : null }\nexport default function C(){ const navigate = useNavigate(); const [o,setOpen]=useState(false); const [e,setError]=useState(''); async function go(){ try { await fetch('/api/x',{method:'POST'}); navigate('/') } catch { setError('bad') } } return (<form onSubmit={go}><button type="button" onClick={() => setOpen(true)}>open</button><Dialog open={o} /></form>) }`,
      }),
      '/',
      { controls: true },
    )
    const form = graph.nodes.find((n) => n.control?.controlType === 'form')
    expect(form?.control?.effects).toContain('error:setError')
    const nav = graph.edges.find((x) => x.from === form?.id && x.to === 'n_root')
    expect(nav?.guard).toBe('onSuccess')
    expect(nav?.modality).toBe('may')
    const modal = graph.nodes.find((n) => n.kind === 'modal')
    expect(modal).toBeDefined()
    expect(graph.edges.some((x) => x.to === modal?.id && x.effect === 'open:modal')).toBe(true)
  })

  it('treats any element with an on* handler as a control and records its events', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); return <div onMouseEnter={() => setHover(true)} onContextMenu={() => navigate('/b')} onKeyDown={() => navigate('/b')}>x</div> }`,
      }),
      '/',
      { controls: true },
    )
    const div = graph.nodes.find((n) => n.control?.element === 'div')
    expect(div?.control?.controlType).toBe('element')
    expect(new Set(div?.control?.events)).toEqual(new Set(['mouseenter', 'contextmenu', 'keydown']))
    expect(graph.edges.some((e) => e.from === div?.id && e.to === 'n_b' && e.event === 'contextmenu')).toBe(true)
    expect(graph.edges.some((e) => e.from === div?.id && e.to === 'n_b' && e.event === 'keydown')).toBe(true)
  })

  it('keeps the route graph identical without opts.controls', () => {
    const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
    const { graph } = extractGraph(buildProject(dir), dir)
    expect(graph.nodes.every((n) => n.kind === 'screen')).toBe(true)
    expect(graph.nodes).toHaveLength(9)
    expect(graph.edges).toHaveLength(15)
  })

  it('captures a multi-behavior submit (api + state + navigate)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import C from './C'\nexport default () => (<Routes><Route path="/checkout" element={<C/>} /><Route path="/" element={<C/>} /></Routes>)`,
        '/C.tsx': `import { useState } from 'react'\nimport { useNavigate } from 'react-router-dom'\nexport default function C(){ const navigate = useNavigate(); const [n,setNotes] = useState(''); async function submit(){ await fetch('/api/orders',{method:'POST'}); setNotes(''); navigate('/') } return (<form onSubmit={submit}><input name="email" type="email" /><textarea name="notes" /><button type="submit">Place order</button></form>) }`,
      }),
      '/',
      { controls: true },
    )
    const form = graph.nodes.find((n) => n.control?.controlType === 'form')
    expect(form?.control?.effects).toContain('api:POST /api/orders')
    expect(form?.control?.effects).toContain('state:setNotes')
    expect(graph.edges.some((e) => e.from === form?.id && e.to === 'n_root' && e.effect === 'navigate')).toBe(true)
    expect(graph.nodes.some((n) => n.control?.controlType === 'richtext')).toBe(true)
  })

  describe('no phantom must-edges (red-team soundness)', () => {
    const navTo = (body: string) =>
      extractGraph(
        inMemory({
          '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
          '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); ${body}; return null }`,
        }),
        '/',
      ).graph.edges.find((e) => e.to === 'n_b')

    it('demotes navigate after an early return to may', () => {
      const e = navTo(`function go(){ if (!ok) return; navigate('/b') }`)
      expect(e?.modality).toBe('may')
      expect(e?.guard).toContain('ok')
    })

    it('demotes navigate inside an array iteration callback to may', () => {
      expect(navTo(`function go(){ [1,2].forEach(() => navigate('/b')) }`)?.modality).toBe('may')
    })

    it('demotes navigate inside a loop to may', () => {
      expect(navTo(`function go(){ for (let i=0;i<3;i++) navigate('/b') }`)?.modality).toBe('may')
    })

    it('keeps an unconditional handler navigate as must', () => {
      expect(navTo(`function go(){ navigate('/b') }`)?.modality).toBe('must')
    })

    it('never emits a single must-edge for an ambiguous param literal', () => {
      const { graph } = extractGraph(
        inMemory({
          '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/:org/:repo" element={<A/>} /><Route path="/settings/:tab" element={<A/>} /></Routes>)`,
          '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); return <button onClick={() => navigate('/settings/billing')}>x</button> }`,
        }),
        '/',
      )
      expect(graph.edges.every((e) => e.modality !== 'must')).toBe(true)
      expect(graph.edges.length).toBeGreaterThan(0)
    })
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

describe('extractGraph — interprocedural call-graph reachability (F2.8)', () => {
  // The interprocedural (control-level) edge, distinct from any coarse screen-level
  // twin collectTargets emits from scanning the whole file.
  const edgeTo = (files: Record<string, string>, to: string) =>
    extractGraph(inMemory(files), '/', { controls: true }).graph.edges.find(
      (e) => e.to === to && e.witness?.ruleId === 'rr.use-navigate.interprocedural',
    )

  it('follows a handler into a local helper that navigates (intra-file closure)', () => {
    const e = edgeTo(
      {
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<B/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); function goB(){ navigate('/b') } return <button onClick={() => { goB() }}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      },
      'n_b',
    )
    expect(e?.modality).toBe('must')
    expect(e?.witness?.ruleId).toBe('rr.use-navigate.interprocedural')
  })

  it('binds navigate + literal across a cross-file nav service', () => {
    const e = edgeTo(
      {
        '/App.tsx': `import A from './A'\nimport P from './P'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/products" element={<P/>} /></Routes>)`,
        '/nav.ts': `export function leaveTo(nav, path){ nav(path) }`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nimport { leaveTo } from './nav'\nexport default function A(){ const navigate = useNavigate(); return <button onClick={() => leaveTo(navigate, '/products')}>go</button> }`,
        '/P.tsx': `export default function P(){ return null }`,
      },
      'n_products',
    )
    expect(e?.modality).toBe('must')
    expect(e?.witness?.ruleId).toBe('rr.use-navigate.interprocedural')
  })

  it('conjoins a guard on the helper call into the interprocedural edge', () => {
    const e = edgeTo(
      {
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<B/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); function goB(){ navigate('/b') } return <button onClick={() => { if (isAdmin) goB() }}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      },
      'n_b',
    )
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('isAdmin')
  })

  it('terminates on mutually recursive helpers and emits the edge once', () => {
    const graph = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<B/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); function pa(){ navigate('/b'); pb() } function pb(){ pa() } return <button onClick={() => pa()}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
      { controls: true },
    ).graph
    expect(graph.edges.filter((e) => e.to === 'n_b' && e.witness?.ruleId === 'rr.use-navigate.interprocedural')).toHaveLength(1)
  })

  it('never descends into a non-relative (library) import', () => {
    const e = edgeTo(
      {
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<B/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nimport { foo } from 'somelib'\nexport default function A(){ const navigate = useNavigate(); return <button onClick={() => foo('/b')}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      },
      'n_b',
    )
    expect(e).toBeUndefined()
  })
})

describe('extractGraph — shared-component SPA shells (refapp-driven)', () => {
  // Two routes render the same shell component; a third has its own component.
  const sharedShell = (controls = false) =>
    extractGraph(
      inMemory({
        '/App.tsx': `import Shell from './Shell'\nimport C from './C'\nexport default () => (<Switch><Route path="/a" render={() => <Shell/>} /><Route path="/b" render={() => <Shell/>} /><Route path="/c" component={C} /></Switch>)`,
        '/Shell.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function Shell(){ const navigate = useNavigate(); return <button onClick={() => navigate('/c')}>go</button> }`,
        '/C.tsx': `export default function C(){ return null }`,
      }),
      '/',
      { controls },
    ).graph

  it('labels shared-component nodes by route, unique-component nodes by name', () => {
    const g = sharedShell()
    const labelOf = (id: string) => g.nodes.find((n) => n.id === id)?.label
    expect(labelOf('n_a')).toBe('/a')
    expect(labelOf('n_b')).toBe('/b')
    expect(labelOf('n_c')).toBe('C')
  })

  it('extracts a shared component once, attributed to the first (representative) route', () => {
    const g = sharedShell(true)
    const controls = g.nodes.filter((n) => n.kind === 'control')
    expect(controls).toHaveLength(1)
    expect(controls[0]?.parent).toBe('n_a')
    expect(g.nodes.filter((n) => n.kind === 'control' && n.parent === 'n_b')).toHaveLength(0)
  })
})

describe('extractGraph — dynamic navigation targets surfaced (refapp-driven)', () => {
  it('emits a fully-dynamic navigate(var) as an unknown-modality edge to a dynamic sink', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); const dest = pickUrl(); navigate(dest); return null }`,
      }),
      '/',
    )
    expect(validateGraph(graph)).toEqual([])
    const sink = graph.nodes.find((n) => n.kind === 'unknown')
    expect(sink?.id).toBe('u_n_a')
    const e = graph.edges.find((x) => x.to === 'u_n_a')
    expect(e?.modality).toBe('unknown')
    expect(e?.guard).toBe('dest')
    expect(e?.witness?.ruleId).toBe('rr.dynamic-target')
  })

  it('does not invent a dynamic edge when every target is literal (sample app unaffected)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nimport B from './B'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<B/>} /></Routes>)`,
        '/A.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function A(){ const navigate = useNavigate(); return <button onClick={() => navigate('/b')}>go</button> }`,
        '/B.tsx': `export default function B(){ return null }`,
      }),
      '/',
    )
    expect(graph.nodes.some((n) => n.kind === 'unknown')).toBe(false)
  })
})
