import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { callConditional, templateConditional } from './conditions'

/** Offset of the section sign marking the site, and the template with the sign removed. */
const site = (marked: string): [string, number] => [marked.replace('§', ''), marked.indexOf('§')]

describe('templateConditional', () => {
  it('reports a site with no enclosing condition as unconditional', () => {
    expect(templateConditional(...site('<div><a §routerLink="/x">x</a></div>'))).toBe(false)
  })
  it('does not take braces inside a binding on the site element for a block', () => {
    expect(templateConditional(...site('<a\n  [ngClass]="{ active: x === y() }"\n  §routerLink="/x"\n>x</a>'))).toBe(false)
  })
  it('does not take interpolation braces for a block', () => {
    expect(templateConditional(...site('<p>{{ a }} {{ b | c }}</p><a §routerLink="/x">x</a>'))).toBe(false)
  })
  it('does not let a block or a directive that closed before the site leak into it', () => {
    expect(templateConditional(...site('@if (a) { <span>x</span> }\n<li *ngIf="b">y</li><a §routerLink="/x">x</a>'))).toBe(false)
  })
  it('treats void and self-closing elements as closed', () => {
    expect(templateConditional(...site('<img src="a" /><br><input type="text"><a §routerLink="/x">x</a>'))).toBe(false)
  })
  it('reports a structural directive on an ancestor, an application\'s own included', () => {
    expect(templateConditional(...site('<li *ifAuthenticated="true"><a §routerLink="/x">x</a></li>'))).toBe(true)
  })
  it('reports a loop body, since it can run zero times', () => {
    expect(templateConditional(...site('@for (x of xs(); track x.id) {\n  <a §routerLink="/x">x</a>\n}'))).toBe(true)
  })
})

describe('callConditional', () => {
  const navigateIn = (body: string) => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/c.ts', `class C { router: any; svc: any; flag = true\n${body}\n}`)
    const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))
    if (!call) throw new Error('no navigate call in the fixture')
    return callConditional(call)
  }
  it('reports a call at the top of a handler as unconditional', () => {
    expect(navigateIn('go() { this.router.navigate(["/x"]) }')).toBe(false)
  })
  it('does not count the call\'s own await, only an earlier one', () => {
    expect(navigateIn('async go() { await this.router.navigate(["/x"]) }')).toBe(false)
  })
  it('reports a call after an early return, which skips it on some executions', () => {
    expect(navigateIn('go() { if (this.flag) { return } \n this.router.navigate(["/x"]) }')).toBe(true)
  })
  it('does not count a return that belongs to a callback in an earlier statement', () => {
    expect(navigateIn('go() { this.svc.items.forEach((i: any) => { return i }) \n this.router.navigate(["/x"]) }')).toBe(false)
  })
  it('does not count a branch the call is not inside when nothing in it leaves the function', () => {
    expect(navigateIn('go() { if (this.flag) { this.svc.log() } \n this.router.navigate(["/x"]) }')).toBe(false)
  })
  it('reports the next member of an observer object', () => {
    expect(navigateIn('go() { this.svc.save().subscribe({ next: () => this.router.navigate(["/x"]) }) }')).toBe(true)
  })
  it('reports a call after an await in a class-property arrow function', () => {
    expect(navigateIn('submit = async () => { await this.svc.save(); await this.router.navigate(["/x"]) }')).toBe(true)
  })
})
