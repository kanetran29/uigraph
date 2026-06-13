import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Project } from 'ts-morph'
import { validateGraph } from '@uigraph/core'
import { buildProject, extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('extractGraph — sample-angular-app golden (M3)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-angular-app', import.meta.url))
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
    expect(graph.edges).toHaveLength(11)
    expect(graph.edges.filter((e) => e.modality === 'must')).toHaveLength(6)
    expect(graph.edges.filter((e) => e.modality === 'may')).toHaveLength(5)
  })

  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  const findEdge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to)

  it('emits literal navigations into unguarded routes as must-edges', () => {
    expect(hasEdge('n_root', 'n_login', 'must')).toBe(true)
    expect(hasEdge('n_root', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_root', 'must')).toBe(true)
    expect(hasEdge('n_checkout', 'n_root', 'must')).toBe(true)
    expect(hasEdge('n_wildcard', 'n_root', 'must')).toBe(true)
  })

  it('emits navigations into canActivate-guarded routes as may-edges with AuthGuard text', () => {
    for (const [from, to] of [
      ['n_login', 'n_dashboard'],
      ['n_dashboard', 'n_dashboard_settings'],
      ['n_dashboard_settings', 'n_dashboard'],
      ['n_products_id', 'n_checkout'],
    ] as const) {
      expect(hasEdge(from, to, 'may')).toBe(true)
      expect(findEdge(from, to)?.guard).toContain('AuthGuard')
      expect(findEdge(from, to)?.confidence).toBe(0.6)
    }
  })

  it('over-approximates a bound [routerLink] target to a may-edge', () => {
    expect(hasEdge('n_products', 'n_products_id', 'may')).toBe(true)
    expect(findEdge('n_products', 'n_products_id')?.guard).toBeNull()
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })

  it('emits exactly the five expected may-edges', () => {
    const may = graph.edges
      .filter((e) => e.modality === 'may')
      .map((e) => `${e.from}->${e.to}`)
      .sort()
    expect(may).toEqual(
      [
        'n_dashboard->n_dashboard_settings',
        'n_dashboard_settings->n_dashboard',
        'n_login->n_dashboard',
        'n_products->n_products_id',
        'n_products_id->n_checkout',
      ].sort(),
    )
  })

  it('emits every edge with a static witness and a ruleId', () => {
    for (const e of graph.edges) {
      expect(e.source).toBe('static')
      expect(e.witness?.source).toBe('static')
      expect(e.witness?.ruleId).toMatch(/^ng\./)
    }
  })
})

describe('extractGraph — in-memory units (M3)', () => {
  it('treats a routerLink into an unguarded route as a must-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_b')?.modality).toBe('must')
  })

  it('treats a navigate into a canActivate-guarded route as a may-edge with guard text', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [AuthGuard] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ standalone: true, template: '<p>a</p>' })\nexport class A { constructor(private router: Router){} go(){ this.router.navigate(['/b']) } }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('AuthGuard')
  })

  it('over-approximates a bound [routerLink] concat to a may-edge over the prefix', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'products', component: A }, { path: 'products/:id', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="\\'/products/\\' + id">go</a>' })\nexport class A { id = '1' }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_products_id')?.modality).toBe('may')
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })
})

describe('extractGraph — control extraction parity (F-angular-controls)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-angular-app', import.meta.url))

  it('keeps the route graph identical (all screens) without opts.controls', () => {
    const { graph } = extractGraph(buildProject(dir), dir)
    expect(graph.nodes.every((n) => n.kind === 'screen')).toBe(true)
    expect(graph.nodes).toHaveLength(8)
    expect(graph.edges).toHaveLength(11)
  })

  describe('golden sample-angular-app with opts.controls', () => {
    const { graph } = extractGraph(buildProject(dir), dir, { controls: true })
    const controls = graph.nodes.filter((n) => n.kind === 'control')
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const ctrlEdge = (parent: string, to: string) =>
      graph.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control' && byId.get(e.from)?.parent === parent)

    it('still satisfies the core invariants', () => {
      expect(validateGraph(graph)).toEqual([])
    })

    it('emits control nodes whose parent is always a real node', () => {
      expect(controls.length).toBeGreaterThan(0)
      for (const c of controls) {
        expect(c.parent).toBeDefined()
        expect(byId.has(c.parent as string)).toBe(true)
        expect(c.control?.selector?.value).toBeTruthy()
      }
    })

    it("wires CheckoutComponent's button to n_root as a must-edge", () => {
      const e = ctrlEdge('n_checkout', 'n_root')
      expect(e?.modality).toBe('must')
      expect(e?.witness?.ruleId).toMatch(/^ng\.control\./)
    })

    it('wires guarded control navigations as may-edges with AuthGuard', () => {
      for (const [parent, to] of [
        ['n_login', 'n_dashboard'],
        ['n_dashboard_settings', 'n_dashboard'],
        ['n_products_id', 'n_checkout'],
      ] as const) {
        const e = ctrlEdge(parent, to)
        expect(e?.modality).toBe('may')
        expect(e?.guard).toContain('AuthGuard')
      }
    })

    it('exposes the email input constraints and the form/submit control', () => {
      const loginControls = controls.filter((c) => c.parent === 'n_login')
      const email = loginControls.find((c) => c.control?.controlType === 'input')
      expect(email?.control?.input).toMatchObject({ type: 'email', required: true })
      const form = loginControls.find((c) => c.control?.controlType === 'form')
      expect(form?.control?.events).toContain('submit')
    })

    it('prefers a data-testid selector when present', () => {
      const submit = controls.find((c) => c.control?.selector?.strategy === 'testid')
      expect(submit?.control?.selector?.value).toBe('login-submit')
    })
  })
})

describe('control units (F-angular-controls)', () => {
  function controlsOf(template: string, klassBody = '') {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ standalone: true, template: \`${template}\` })\nexport class A { constructor(private router: Router){} ${klassBody} }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
      { controls: true },
    )
    const controls = graph.nodes.filter((n) => n.kind === 'control' && n.parent === 'n_a')
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const navTo = (to: string) => graph.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control')
    return { controls, navTo, soundiness }
  }

  it('selector precedence: testid > role-name > label > text > structural', () => {
    expect(controlsOf('<button data-testid="x" (click)="g()">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'testid', value: 'x' })
    expect(controlsOf('<button (click)="g()">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'role-name', value: 'button|Save' })
    expect(controlsOf('<input formControlName="email" (input)="g()" />').controls[0]?.control?.selector).toMatchObject({ strategy: 'label', value: 'email' })
    expect(controlsOf('<div (mouseenter)="g()"></div>').controls[0]?.control?.selector).toMatchObject({ strategy: 'structural', value: 'div' })
  })

  it('nth disambiguates two identical controls into two distinct ids', () => {
    const { controls } = controlsOf('<input name="plan" type="radio" /><input name="plan" type="radio" />')
    expect(controls).toHaveLength(2)
    expect(new Set(controls.map((c) => c.id)).size).toBe(2)
  })

  it('traces a (click) handler to a method that navigates (must when unguarded)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'go(){ this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('must')
  })

  it('demotes a conditional navigation to may with the condition as guard', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'x = true; go(){ if (this.x) this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('may')
    expect(navTo('n_b')?.guard).toContain('x')
  })

  it('demotes an early-returned navigation to may (no phantom must)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'ok = false; go(){ if (!this.ok) return; this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('may')
  })

  it('demotes a navigation inside forEach to may (iteration, not must)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'items = [1]; go(){ this.items.forEach(() => this.router.navigate(["/b"])) }')
    expect(navTo('n_b')?.modality).toBe('may')
  })

  it('traces navigateByUrl handlers and emits no edge for non-navigating methods', () => {
    expect(controlsOf('<button (click)="go()">go</button>', 'go(){ this.router.navigateByUrl("/b") }').navTo('n_b')?.modality).toBe('must')
    expect(controlsOf('<button (click)="noop()">x</button>', 'noop(){ console.log("hi") }').navTo('n_b')).toBeUndefined()
  })

  it('captures multiple events and input constraints', () => {
    const { controls } = controlsOf('<input type="email" required (input)="g()" (blur)="h()" />')
    expect(controls[0]?.control?.events).toEqual(expect.arrayContaining(['input', 'blur']))
    expect(controls[0]?.control?.input).toMatchObject({ type: 'email', required: true })
  })

  it('classifies a (submit) form as a form control', () => {
    const { controls } = controlsOf('<form (submit)="g()"><button>ok</button></form>')
    const form = controls.find((c) => c.control?.controlType === 'form')
    expect(form?.control?.events).toContain('submit')
  })
})
