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

  it('attributes a navigation in a nested child component to the screen (capped to may)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
        // A renders a nested Landing component (not a route) that holds the button.
        '/A.tsx': `import Landing from './Landing'\nexport default function A(){ return <Landing/> }`,
        '/Landing.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function Landing(){ const navigate = useNavigate(); return <button onClick={() => navigate('/b')}>go</button> }`,
      }),
      '/',
      { controls: true },
    )
    // n_b was an orphan via the route component alone; descent into <Landing> connects it.
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
    // and the button is attributed as a control under the screen (n_a)
    expect(graph.nodes.some((n) => n.kind === 'control' && n.parent === 'n_a')).toBe(true)
  })

  it('attributes a nested-route nav in a shared context (const route-map) to the parent route', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import P from './P'\nexport default () => (<Routes><Route path="/profile" element={<P/>} /><Route path="/profile/sell-listings" element={<P/>} /></Routes>)`,
        '/P.tsx': `export default function P(){ return null }`,
        // a context/hook (not a route component) navigates via a const route-map lookup
        '/ctx.tsx': `import { useHistory } from 'react-router-dom'\nconst subviewPaths = { sell: '/profile/sell-listings' }\nexport function useNav(){ const history = useHistory(); return { open: (k: string) => history.push(subviewPaths[k]) } }`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.from === 'n_profile' && x.to === 'n_profile_sell-listings')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
  })

  it('links each modal-opening control to the SPECIFIC modal (matched by its state var)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'\nexport default function H(){
          const [showSell, setShowSell] = useState(false)
          const [showLogin, setShowLogin] = useState(false)
          return <div>
            <button onClick={() => setShowSell(true)}>Sell</button>
            <button onClick={() => setShowLogin(true)}>Login</button>
            {showSell && <CouldSellModal isOpen={showSell}/>}
            {showLogin && <SignupLoginModal isOpen={showLogin}/>}
          </div>
        }`,
      }),
      '/',
      { controls: true },
    )
    const modals = graph.nodes.filter((n) => n.kind === 'modal')
    const sellModal = modals.find((m) => m.label === 'CouldSellModal')
    const loginModal = modals.find((m) => m.label === 'SignupLoginModal')
    const openEdges = graph.edges.filter((e) => e.effect === 'open:modal')
    // both modals receive an open edge (not just the first), each from its own button
    expect(openEdges.some((e) => e.to === sellModal?.id)).toBe(true)
    expect(openEdges.some((e) => e.to === loginModal?.id)).toBe(true)
    // and they come from DIFFERENT controls
    const fromSet = new Set(openEdges.map((e) => e.from))
    expect(fromSet.size).toBeGreaterThanOrEqual(2)
  })

  it('names an otherwise-textless control from its i18n key / icon / className', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `export default function H(){ return <div>
          <button className="hdr__btn hdr__btn--could-sell"><SellIcon/><span><Trans i18nKey="building.offMarket.couldSell"/></span></button>
          <button><CouldBuyIcon/></button>
          <button className="menu__item--contact-us"/>
        </div> }`,
      }),
      '/',
      { controls: true },
    )
    const names = graph.nodes.filter((n) => n.kind === 'control').map((n) => n.control?.name)
    expect(names).toContain('Could sell')   // from <Trans i18nKey="…couldSell">
    expect(names).toContain('Could buy')    // from <CouldBuyIcon/>
    expect(names).toContain('Contact us')   // from BEM modifier --contact-us
    // and the i18n-named control gets a role+name selector, not structural
    const sell = graph.nodes.find((n) => n.kind === 'control' && n.control?.name === 'Could sell')
    expect(sell?.control?.selector?.strategy).toBe('role-name')
  })

  it('names an otherwise-textless control from its i18n key / icon / className', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `export default function H(){ return <div>
          <button className="hdr__btn hdr__btn--could-sell"><SellIcon/><span><Trans i18nKey="building.offMarket.couldSell"/></span></button>
          <button><CouldBuyIcon/></button>
          <button className="menu__item--contact-us"/>
        </div> }`,
      }),
      '/',
      { controls: true },
    )
    const names = graph.nodes.filter((n) => n.kind === 'control').map((n) => n.control?.name)
    // from <Trans i18nKey>, from <CouldBuyIcon/>, and from the BEM --contact-us modifier
    expect(names).toContain('Could sell')
    expect(names).toContain('Could buy')
    expect(names).toContain('Contact us')
    const sell = graph.nodes.find((n) => n.kind === 'control' && n.control?.name === 'Could sell')
    expect(sell?.control?.selector?.strategy).toBe('role-name')
  })

  it('does not descend into node_modules / unresolved components', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /><Route path="/b" element={<A/>} /></Routes>)`,
        '/A.tsx': `import { Dialog } from 'some-lib'\nexport default function A(){ return <Dialog/> }`,
      }),
      '/',
    )
    // Dialog resolves to no project file -> no crash, no phantom edge.
    expect(graph.edges.find((x) => x.to === 'n_b')).toBeUndefined()
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

describe('extractGraph — control selectors + stable identity (F1)', () => {
  const controlsOf = (a: string) =>
    extractGraph(
      inMemory({
        '/App.tsx': `import A from './A'\nexport default () => (<Routes><Route path="/a" element={<A/>} /></Routes>)`,
        '/A.tsx': `export default function A(){ return (${a}) }`,
      }),
      '/',
      { controls: true },
    ).graph.nodes.filter((n) => n.kind === 'control')

  it('prefers data-testid, then role+name', () => {
    const cs = controlsOf(`<div><button data-testid="save-btn" onClick={()=>{}}>Save</button><button onClick={()=>{}}>Cancel</button></div>`)
    const save = cs.find((c) => c.control?.selector?.value === 'save-btn')
    expect(save?.control?.selector?.strategy).toBe('testid')
    const cancel = cs.find((c) => c.label === 'Cancel')
    expect(cancel?.control?.selector).toEqual({ strategy: 'role-name', value: 'button|Cancel' })
  })

  it('disambiguates identical selectors with nth and gives distinct ids', () => {
    const cs = controlsOf(`<form><input name="plan" type="radio" onChange={()=>{}} /><input name="plan" type="radio" onChange={()=>{}} /></form>`)
    const radios = cs.filter((c) => c.control?.selector?.value === 'radio|plan')
    expect(radios).toHaveLength(2)
    expect(new Set(radios.map((r) => r.control?.selector?.nth ?? 0))).toEqual(new Set([0, 1]))
    expect(new Set(radios.map((r) => r.id)).size).toBe(2)
  })

  it('falls back to structural for an attribute-less, textless handler element', () => {
    const cs = controlsOf(`<div onMouseEnter={()=>{}}></div>`)
    expect(cs[0]?.control?.selector?.strategy).toBe('structural')
  })

  it('every extracted control carries a non-empty selector', () => {
    const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
    const controls = extractGraph(buildProject(dir), dir, { controls: true }).graph.nodes.filter((n) => n.kind === 'control')
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((c) => (c.control?.selector?.value ?? '').length > 0)).toBe(true)
  })

  it('extracts input constraints (type/required) from field controls', () => {
    const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
    const controls = extractGraph(buildProject(dir), dir, { controls: true }).graph.nodes.filter((n) => n.kind === 'control')
    const email = controls.find((c) => c.control?.input?.type === 'email')
    expect(email?.control?.input?.required).toBe(true)
    const dateField = controls.find((c) => c.control?.input?.type === 'date')
    expect(dateField).toBeDefined()
  })

  it('a control id is stable when an unrelated control is added earlier (was positional, now selector-keyed)', () => {
    const shellBefore = `<div><button onClick={()=>{}}>Save</button></div>`
    const shellAfter = `<div><button onClick={()=>{}}>Cancel</button><button onClick={()=>{}}>Save</button></div>`
    const idOfSave = (shell: string) => controlsOf(shell).find((c) => c.label === 'Save')?.id
    expect(idOfSave(shellBefore)).toBe(idOfSave(shellAfter))
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

describe('extractGraph — modal-control descent (F-modal-controls)', () => {
  // The login-modal shape: a screen renders an IMPORTED <LoginModal/>, whose own file
  // holds an OAuth button + an email form. Today those are invisible (modal is a leaf).
  const loginModalApp = {
    '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
    '/H.tsx': `import { useState } from 'react'\nimport LoginModal from './LoginModal'\nexport default function H(){ const [show,setShow]=useState(false); return <div><button onClick={()=>setShow(true)}>Login</button>{show && <LoginModal isOpen={show}/>}</div> }`,
    '/LoginModal.tsx': `export default function LoginModal(){ return <div><button onClick={()=>{}}>Continue with Google</button><form onSubmit={()=>{}}><input type="email" name="email"/><button type="submit">Sign in</button></form></div> }`,
  }

  it('descends into an IMPORTED modal file and parents its controls to the modal node', () => {
    const { graph } = extractGraph(inMemory(loginModalApp), '/', { controls: true })
    const modal = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'LoginModal')
    expect(modal).toBeDefined()
    const modalControls = graph.nodes.filter((n) => n.kind === 'control' && n.parent === modal!.id)
    const labels = modalControls.map((c) => c.control?.name ?? c.control?.element)
    expect(labels).toContain('Continue with Google')
    expect(modalControls.some((c) => c.control?.element === 'input')).toBe(true)
    expect(modalControls.some((c) => c.control?.controlType === 'form')).toBe(true)
    expect(modalControls.length).toBeGreaterThanOrEqual(3)
    expect(validateGraph(graph)).toEqual([])
  })

  it('reaches controls in a component the modal DELEGATES to (modal -> child, depth 1)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import AuthModal from './AuthModal'\nexport default function H(){ return <div>{true && <AuthModal isOpen/>}</div> }`,
        '/AuthModal.tsx': `import OAuthButtons from './OAuthButtons'\nexport default function AuthModal(){ return <div><OAuthButtons/></div> }`,
        '/OAuthButtons.tsx': `export default function OAuthButtons(){ return <button onClick={()=>{}}>Continue with Facebook</button> }`,
      }),
      '/',
      { controls: true },
    )
    const modal = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'AuthModal')
    expect(modal).toBeDefined()
    const fb = graph.nodes.find((n) => n.kind === 'control' && n.parent === modal!.id && n.control?.name === 'Continue with Facebook')
    expect(fb).toBeDefined()
  })

  it('caps modal-control navigations to may (modal contents are conditionally rendered)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /><Route path="/dash" element={<H/>} /></Routes>)`,
        '/H.tsx': `import NavModal from './NavModal'\nexport default function H(){ return <div>{true && <NavModal isOpen/>}</div> }`,
        '/NavModal.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function NavModal(){ const navigate=useNavigate(); return <button onClick={()=>navigate('/dash')}>Go dash</button> }`,
      }),
      '/',
      { controls: true },
    )
    const e = graph.edges.find((x) => x.to === 'n_dash')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
    expect(e?.witness).toBeDefined()
  })

  it('does NOT re-parent an inline same-file modal (id stability): controls stay under the screen', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        // ConfirmDialog is a LOCAL function in the same file — not an import.
        '/H.tsx': `function ConfirmDialog(){ return <button onClick={()=>{}}>Confirm inline</button> }\nexport default function H(){ return <div><button onClick={()=>{}}>Open</button>{true && <ConfirmDialog/>}</div> }`,
      }),
      '/',
      { controls: true },
    )
    const inline = graph.nodes.find((n) => n.kind === 'control' && n.control?.name === 'Confirm inline')
    expect(inline).toBeDefined()
    // inline modal controls stay parented to the screen (n_root), NOT a modal node
    expect(inline?.parent).toBe('n_root')
  })

  it('keeps a screen control id byte-stable whether or not an imported modal shares its label', () => {
    const withoutModal = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `export default function H(){ return <div><button onClick={()=>{}}>Cancel</button></div> }`,
      }),
      '/',
      { controls: true },
    ).graph
    const withModal = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import CancelModal from './CancelModal'\nexport default function H(){ return <div><button onClick={()=>{}}>Cancel</button>{true && <CancelModal isOpen/>}</div> }`,
        // imported modal with its OWN same-labelled Cancel button
        '/CancelModal.tsx': `export default function CancelModal(){ return <button onClick={()=>{}}>Cancel</button> }`,
      }),
      '/',
      { controls: true },
    ).graph
    const screenCancel = (g: typeof withoutModal): string | undefined =>
      g.nodes.find((n) => n.kind === 'control' && n.parent === 'n_root' && n.control?.name === 'Cancel')?.id
    expect(screenCancel(withModal)).toBe(screenCancel(withoutModal))
    // and the modal got its own Cancel under the modal node (distinct id, net-new)
    const modal = withModal.nodes.find((n) => n.kind === 'modal')
    const modalCancel = withModal.nodes.find((n) => n.kind === 'control' && n.parent === modal?.id && n.control?.name === 'Cancel')
    expect(modalCancel).toBeDefined()
    expect(modalCancel?.id).not.toBe(screenCancel(withModal))
  })

  it('terminates on a self-importing modal (bounded recursion, no duplicate ids)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import LoopModal from './LoopModal'\nexport default function H(){ return <div>{true && <LoopModal isOpen/>}</div> }`,
        // a modal whose file references its own tag — must not recurse forever
        '/LoopModal.tsx': `import LoopModal from './LoopModal'\nexport default function LoopModal(){ return <div><button onClick={()=>{}}>Inner</button></div> }`,
      }),
      '/',
      { controls: true },
    )
    const ids = graph.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(validateGraph(graph)).toEqual([])
  })

  it('sample-app golden is byte-identical (no-controls: 9 nodes / 15 edges)', () => {
    const dir = fileURLToPath(new URL('../../../examples/sample-react-app', import.meta.url))
    const { graph } = extractGraph(buildProject(dir), dir)
    expect(graph.nodes).toHaveLength(9)
    expect(graph.edges).toHaveLength(15)
  })
})

describe('extractGraph — gated overlay-view control descent (F-deep-view-controls)', () => {
  // refapp's ProfileView shape: a deep imported view gated by a *Visible state var
  // (not a *Modal tag), holding a verify CTA + phone input + a NotificationSettings subview.
  const profileApp = {
    '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
    // Landing is depth 1; it gates the deep ProfileView (depth 2) behind a *Visible var.
    '/H.tsx': `import Landing from './Landing'\nexport default function H(){ return <Landing/> }`,
    '/Landing.tsx': `import { useState } from 'react'\nimport ProfileView from './ProfileView'\nexport default function Landing(){ const [profileViewVisible]=useState(false); const isLoggedIn=true; return <div><button onClick={()=>{}}>Open profile</button>{profileViewVisible && isLoggedIn && (<ProfileView/>)}</div> }`,
    '/ProfileView.tsx': `import NotificationSettings from './NotificationSettings'\nexport default function ProfileView(){ return <div><button onClick={()=>{}}>Verify identity</button><input type="tel" name="phone"/><NotificationSettings/></div> }`,
    '/NotificationSettings.tsx': `export default function NotificationSettings(){ return <button onClick={()=>{}}>Save notification settings</button> }`,
  }

  it('treats a *Visible-gated imported view as an overlay node and descends its controls', () => {
    const { graph } = extractGraph(inMemory(profileApp), '/', { controls: true })
    const overlay = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'ProfileView')
    expect(overlay).toBeDefined()
    const kids = graph.nodes.filter((n) => n.kind === 'control' && n.parent === overlay!.id)
    const labels = kids.map((c) => c.control?.name ?? c.control?.element)
    expect(labels).toContain('Verify identity')
    expect(kids.some((c) => c.control?.element === 'input')).toBe(true)
    expect(validateGraph(graph)).toEqual([])
  })

  it('detects the gate through a multi-&& guard (a && b && <View/>) that modalGateVar misses', () => {
    const { graph } = extractGraph(inMemory(profileApp), '/', { controls: true })
    // profileViewVisible && isLoggedIn && <ProfileView/> — the overlay must still be found
    expect(graph.nodes.some((n) => n.kind === 'modal' && n.label === 'ProfileView')).toBe(true)
  })

  it('reaches controls in a subview the gated view delegates to (ProfileView -> NotificationSettings)', () => {
    const { graph } = extractGraph(inMemory(profileApp), '/', { controls: true })
    const overlay = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'ProfileView')
    const save = graph.nodes.find((n) => n.kind === 'control' && n.parent === overlay!.id && n.control?.name === 'Save notification settings')
    expect(save).toBeDefined()
  })

  it('does NOT turn a non-*Visible-gated component into an overlay (blow-up bound)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        // gated by showThing (NOT *Visible) -> ordinary conditional render, stays at depth-1 behaviour
        '/H.tsx': `import { useState } from 'react'\nimport SharedHeader from './SharedHeader'\nexport default function H(){ const [showThing]=useState(false); return <div>{showThing && <SharedHeader/>}</div> }`,
        '/SharedHeader.tsx': `import Deep from './Deep'\nexport default function SharedHeader(){ return <div><button onClick={()=>{}}>Header btn</button><Deep/></div> }`,
        '/Deep.tsx': `export default function Deep(){ return <button onClick={()=>{}}>Deep btn</button> }`,
      }),
      '/',
      { controls: true },
    )
    // no overlay node created for SharedHeader; and the depth-2 Deep btn is NOT reached
    expect(graph.nodes.some((n) => n.kind === 'modal')).toBe(false)
    expect(graph.nodes.some((n) => n.control?.name === 'Deep btn')).toBe(false)
  })

  it('caps a gated-view navigation to may', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /><Route path="/x" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'\nimport SettingsView from './SettingsView'\nexport default function H(){ const [settingsVisible]=useState(false); return <div>{settingsVisible && <SettingsView/>}</div> }`,
        '/SettingsView.tsx': `import { useNavigate } from 'react-router-dom'\nexport default function SettingsView(){ const navigate=useNavigate(); return <button onClick={()=>navigate('/x')}>Go x</button> }`,
      }),
      '/',
      { controls: true },
    )
    const e = graph.edges.find((x) => x.to === 'n_x')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
    expect(e?.witness).toBeDefined()
  })

  it('does NOT promote a component merely NESTED inside a *Visible-gated wrapper (no re-home)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        // Card is rendered unconditionally AND nested inside a drawerVisible-gated <section>.
        // The gate is on <section> (a host element), not on <Card/> — Card must NOT become an
        // overlay, and its unconditional control must stay parented to the screen.
        '/H.tsx': `import { useState } from 'react'\nimport Card from './Card'\nexport default function H(){ const [drawerVisible]=useState(false); return <div><Card/>{drawerVisible && <section><Card/></section>}</div> }`,
        '/Card.tsx': `export default function Card(){ return <button onClick={()=>{}}>Card action</button> }`,
      }),
      '/',
      { controls: true },
    )
    expect(graph.nodes.some((n) => n.kind === 'modal')).toBe(false)
    const cardCtrl = graph.nodes.find((n) => n.kind === 'control' && n.control?.name === 'Card action')
    expect(cardCtrl?.parent).toBe('n_root')
  })

  it('emits a nested overlay’s control exactly once (no double-count across overlays)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'\nimport OuterView from './OuterView'\nexport default function H(){ const [outerVisible]=useState(false); return <div>{outerVisible && <OuterView/>}</div> }`,
        '/OuterView.tsx': `import { useState } from 'react'\nimport InnerView from './InnerView'\nexport default function OuterView(){ const [innerVisible]=useState(false); return <div><button onClick={()=>{}}>Outer btn</button>{innerVisible && <InnerView/>}</div> }`,
        '/InnerView.tsx': `export default function InnerView(){ return <button onClick={()=>{}}>Inner btn</button> }`,
      }),
      '/',
      { controls: true },
    )
    const inner = graph.nodes.filter((n) => n.kind === 'control' && n.control?.name === 'Inner btn')
    expect(inner).toHaveLength(1)
  })

  it('links a control nested INSIDE one overlay that opens ANOTHER overlay (precise gate-var match)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        // The screen renders an imported FlowModal (descended) and gates a LoginModal by
        // loginModalVisible. A control INSIDE FlowModal opens the login modal via the same
        // setter — exactly refapp's BuildingModal -> setLoginModalVisible(true) shape.
        '/H.tsx': `import { useState } from 'react'\nimport FlowModal from './FlowModal'\nimport LoginModal from './LoginModal'\nexport default function H(){ const [loginModalVisible,setLoginModalVisible]=useState(false); return <div><FlowModal setLoginModalVisible={setLoginModalVisible}/>{loginModalVisible && <LoginModal isOpen={loginModalVisible}/>}</div> }`,
        '/FlowModal.tsx': `export default function FlowModal({setLoginModalVisible}){ return <button onClick={()=>setLoginModalVisible(true)}>Sign in to continue</button> }`,
        '/LoginModal.tsx': `export default function LoginModal(){ return <button onClick={()=>{}}>Google</button> }`,
      }),
      '/',
      { controls: true },
    )
    const login = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'LoginModal')
    const opener = graph.nodes.find((n) => n.kind === 'control' && n.control?.name === 'Sign in to continue')
    const edge = graph.edges.find((e) => e.from === opener?.id && e.to === login?.id && e.effect === 'open:modal')
    expect(edge).toBeDefined()
    // opener is inside a descended overlay -> the open link is may, and witnessed
    expect(edge?.modality).toBe('may')
    expect(edge?.witness).toBeDefined()
  })

  it('does NOT let a nested-overlay control use the sole-modal fallback (no mislink)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        // One modal on the screen; a control inside FlowModal fires an open:modal effect whose
        // var matches NOTHING. A screen control would fall back to the sole modal — a nested
        // one must NOT (it could mislink across unrelated overlays).
        '/H.tsx': `import FlowModal from './FlowModal'\nimport LoginModal from './LoginModal'\nexport default function H(){ return <div><FlowModal/>{true && <LoginModal isOpen/>}</div> }`,
        '/FlowModal.tsx': `export default function FlowModal(){ return <button onClick={()=>setShowSomethingElseModal(true)}>x</button> }`,
        '/LoginModal.tsx': `export default function LoginModal(){ return <button onClick={()=>{}}>Google</button> }`,
      }),
      '/',
      { controls: true },
    )
    const flow = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'FlowModal')
    const login = graph.nodes.find((n) => n.kind === 'modal' && n.label === 'LoginModal')
    // the FlowModal control's effect var matches no gate -> NO open:modal edge to LoginModal
    expect(graph.edges.some((e) => e.to === login?.id && e.effect === 'open:modal' && graph.nodes.find((n) => n.id === e.from)?.parent === flow?.id)).toBe(false)
  })

  it('keeps screen control ids byte-stable when a gated view is added', () => {
    const base = {
      '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
    }
    const without = extractGraph(inMemory({ ...base, '/H.tsx': `export default function H(){ return <div><button onClick={()=>{}}>Top</button></div> }` }), '/', { controls: true }).graph
    const withView = extractGraph(
      inMemory({
        ...base,
        '/H.tsx': `import { useState } from 'react'\nimport DetailView from './DetailView'\nexport default function H(){ const [detailVisible]=useState(false); return <div><button onClick={()=>{}}>Top</button>{detailVisible && <DetailView/>}</div> }`,
        '/DetailView.tsx': `export default function DetailView(){ return <button onClick={()=>{}}>Top</button> }`,
      }),
      '/',
      { controls: true },
    ).graph
    const topId = (g: typeof without): string | undefined =>
      g.nodes.find((n) => n.kind === 'control' && n.parent === 'n_root' && n.control?.name === 'Top')?.id
    expect(topId(withView)).toBe(topId(without))
  })
})
