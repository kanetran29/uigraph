import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import { validateGraph } from '@ui-graph/core'
import { extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('inline-JSX route nav (feature 2)', () => {
  it('extracts a Link literal target from inside an inline <Route element={<section>…}>', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import { Link } from 'react-router-dom'
export default () => (<Routes>
  <Route path="/" element={<section><Link to="/about">About</Link></section>} />
  <Route path="/about" element={<section>about</section>} />
</Routes>)`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.from === 'n_root' && x.to === 'n_about')
    expect(e).toBeDefined()
    expect(e?.source).toBe('static')
    expect(validateGraph(graph)).toEqual([])
  })

  it('extracts a <Navigate to="…"> redirect from an inline element', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import { Navigate } from 'react-router-dom'
export default () => (<Routes>
  <Route path="/old" element={<section><Navigate to="/new"/></section>} />
  <Route path="/new" element={<section>new</section>} />
</Routes>)`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.from === 'n_old' && x.to === 'n_new')
    expect(e).toBeDefined()
    expect(e?.effect).toBe('redirect')
  })

  it('captures a ternary/&&-guard on the inline element expr as the edge guard', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import { Navigate } from 'react-router-dom'
export default () => (<Routes>
  <Route path="/dash" element={isAuthed ? <section>dash</section> : <Navigate to="/login"/>} />
  <Route path="/login" element={<section>login</section>} />
</Routes>)`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.from === 'n_dash' && x.to === 'n_login')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBeTruthy()
  })

  it('does NOT follow a nested capitalized component import inside the inline element', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/App.tsx': `import Child from './Child'
export default () => (<Routes>
  <Route path="/" element={<section><Child/></section>} />
  <Route path="/deep" element={<section>deep</section>} />
</Routes>)`,
        '/Child.tsx': `import { Link } from 'react-router-dom'
export default function Child(){ return <Link to="/deep">deep</Link> }`,
      }),
      '/',
    )
    expect(graph.edges.some((x) => x.to === 'n_deep')).toBe(false)
    expect(soundiness.some((s) => s.kind === 'inline-jsx-route')).toBe(true)
  })

  it('extracts a useNavigate(literal) call inside the inline element expr', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import { useNavigate } from 'react-router-dom'
export default () => (<Routes>
  <Route path="/" element={<button onClick={() => useNavigate()('/go')}>go</button>} />
  <Route path="/go" element={<section>go</section>} />
</Routes>)`,
      }),
      '/',
    )
    expect(graph.edges.some((x) => x.from === 'n_root' && x.to === 'n_go')).toBe(true)
  })
})

describe('modal close + dismiss-then-navigate (feature 3)', () => {
  it('emits a close:modal edge when a control calls setShowModal(false)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [showModal, setShowModal] = useState(false)
  return <div>{showModal && <button onClick={() => setShowModal(false)}>Cancel</button>}</div>
}`,
      }),
      '/',
      { controls: true },
    )
    const closeEdges = graph.edges.filter((e) => e.effect === 'close:modal')
    expect(closeEdges.length).toBeGreaterThanOrEqual(1)
    expect(closeEdges[0]?.to).toBe('n_root')
    expect(validateGraph(graph)).toEqual([])
  })

  it('does NOT emit close:modal for setShowModal(true) (semantic false, not text)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [showModal, setShowModal] = useState(false)
  return <button onClick={() => setShowModal(true)}>Open</button>
}`,
      }),
      '/',
      { controls: true },
    )
    expect(graph.edges.some((e) => e.effect === 'close:modal')).toBe(false)
  })

  it('emits BOTH close:modal AND navigate from one dismiss-then-navigate handler', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /><Route path="/done" element={<section>done</section>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
export default function H(){
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()
  const handle = () => { setShowModal(false); navigate('/done') }
  return <div>{showModal && <button onClick={handle}>Save</button>}</div>
}`,
      }),
      '/',
      { controls: true },
    )
    const controlIds = new Set(graph.nodes.filter((n) => n.kind === 'control').map((n) => n.id))
    const closeEdges = graph.edges.filter((e) => e.effect === 'close:modal')
    const navFromControl = graph.edges.filter((e) => e.to === 'n_done' && controlIds.has(e.from))
    expect(closeEdges.length).toBeGreaterThanOrEqual(1)
    expect(navFromControl.length).toBeGreaterThanOrEqual(1)
    expect(controlIds.has(closeEdges[0]?.from ?? '')).toBe(true)
    expect(closeEdges[0]?.from).toBe(navFromControl[0]?.from)
  })

  it('keeps close:modal edge ids stable across re-extraction', () => {
    const files = {
      '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
      '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [showModal, setShowModal] = useState(false)
  return <div>{showModal && <button onClick={() => setShowModal(false)}>Cancel</button>}</div>
}`,
    }
    const a = extractGraph(inMemory(files), '/', { controls: true })
    const b = extractGraph(inMemory(files), '/', { controls: true })
    const idsA = a.graph.edges.filter((e) => e.effect === 'close:modal').map((e) => e.id).sort()
    const idsB = b.graph.edges.filter((e) => e.effect === 'close:modal').map((e) => e.id).sort()
    expect(idsA).toEqual(idsB)
    expect(idsA.length).toBeGreaterThanOrEqual(1)
  })
})

describe('self-loop effect edges (feature A)', () => {
  it('mints a control->parent-screen edge for a control whose only effect is an api call', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `export default function H(){
  return <button onClick={() => fetch('/api/orders', { method: 'POST' })}>Buy</button>
}`,
      }),
      '/',
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    expect(control).toBeDefined()
    const e = graph.edges.find((x) => x.from === control?.id)
    expect(e).toBeDefined()
    expect(e?.to).toBe('n_root')
    expect(e?.effect).toBe('api:POST /api/orders')
    expect(e?.modality).toBe('must')
    expect(e?.source).toBe('static')
    expect(e?.witness?.source).toBe('static')
    expect(validateGraph(graph)).toEqual([])
  })

  it('mints a control->parent-screen edge for a control whose only effect is a state setter', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [cart, setCart] = useState([])
  return <button onClick={() => setCart([])}>Clear</button>
}`,
      }),
      '/',
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    const e = graph.edges.find((x) => x.from === control?.id)
    expect(e).toBeDefined()
    expect(e?.to).toBe('n_root')
    expect(e?.effect).toBe('state:setCart')
  })

  it('joins multiple effects on the handler onto ONE self-loop edge, not one per effect', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [cart, setCart] = useState([])
  return <button onClick={() => { fetch('/api/orders', { method: 'POST' }); setCart([]) }}>Buy</button>
}`,
      }),
      '/',
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    const selfLoopEdges = graph.edges.filter((x) => x.from === control?.id)
    expect(selfLoopEdges.length).toBe(1)
    expect(selfLoopEdges[0]?.effect).toBe('api:POST /api/orders, state:setCart')
  })

  it('does NOT mint a self-loop when the control already navigates (nav edge untouched)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /><Route path="/done" element={<section>done</section>} /></Routes>)`,
        '/H.tsx': `import { useNavigate } from 'react-router-dom'
export default function H(){
  const navigate = useNavigate()
  return <button onClick={() => { fetch('/api/x'); navigate('/done') }}>Go</button>
}`,
      }),
      '/',
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    const fromControl = graph.edges.filter((x) => x.from === control?.id)
    expect(fromControl.length).toBe(1)
    expect(fromControl[0]?.to).toBe('n_done')
    expect(fromControl[0]?.effect).toBe('navigate')
  })

  it('does NOT mint a self-loop for a control with only a close:modal effect (already edged)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
        '/H.tsx': `import { useState } from 'react'
export default function H(){
  const [showModal, setShowModal] = useState(false)
  return <div>{showModal && <button onClick={() => setShowModal(false)}>Cancel</button>}</div>
}`,
      }),
      '/',
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    const fromControl = graph.edges.filter((x) => x.from === control?.id)
    expect(fromControl.length).toBe(1)
    expect(fromControl[0]?.effect).toBe('close:modal')
  })

  it('keeps self-loop edge ids stable across re-extraction', () => {
    const files = {
      '/App.tsx': `import H from './H'\nexport default () => (<Routes><Route path="/" element={<H/>} /></Routes>)`,
      '/H.tsx': `export default function H(){
  return <button onClick={() => fetch('/api/orders', { method: 'POST' })}>Buy</button>
}`,
    }
    const a = extractGraph(inMemory(files), '/', { controls: true })
    const b = extractGraph(inMemory(files), '/', { controls: true })
    const controlA = a.graph.nodes.find((n) => n.kind === 'control')
    const controlB = b.graph.nodes.find((n) => n.kind === 'control')
    const idA = a.graph.edges.find((e) => e.from === controlA?.id)?.id
    const idB = b.graph.edges.find((e) => e.from === controlB?.id)?.id
    expect(idA).toBeDefined()
    expect(idA).toEqual(idB)
  })
})
