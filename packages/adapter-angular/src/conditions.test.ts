import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { callCondition, templateCondition } from './conditions'

/** Offset of the section sign marking the site, and the template with the sign removed. */
const site = (marked: string): [string, number] => [marked.replace('§', ''), marked.indexOf('§')]

describe('templateConditional', () => {
  it('reports a site with no enclosing condition as unconditional', () => {
    expect(templateCondition(...site('<div><a §routerLink="/x">x</a></div>'))).toBeNull()
  })
  it('does not take braces inside a binding on the site element for a block', () => {
    expect(templateCondition(...site('<a\n  [ngClass]="{ active: x === y() }"\n  §routerLink="/x"\n>x</a>'))).toBeNull()
  })
  it('does not take interpolation braces for a block', () => {
    expect(templateCondition(...site('<p>{{ a }} {{ b | c }}</p><a §routerLink="/x">x</a>'))).toBeNull()
  })
  it('does not let a block or a directive that closed before the site leak into it', () => {
    expect(templateCondition(...site('@if (a) { <span>x</span> }\n<li *ngIf="b">y</li><a §routerLink="/x">x</a>'))).toBeNull()
  })
  it('treats void and self-closing elements as closed', () => {
    expect(templateCondition(...site('<img src="a" /><br><input type="text"><a §routerLink="/x">x</a>'))).toBeNull()
  })
  it('reports a structural directive on an ancestor, an application\'s own included', () => {
    expect(templateCondition(...site('<li *ifAuthenticated="true"><a §routerLink="/x">x</a></li>'))).not.toBeNull()
  })
  it('reports a loop body, since it can run zero times', () => {
    expect(templateCondition(...site('@for (x of xs(); track x.id) {\n  <a §routerLink="/x">x</a>\n}'))).not.toBeNull()
  })
  it('reports a link inside an ng-template, which renders only where something instantiates it', () => {
    expect(templateCondition(...site('<ng-template #t><a §routerLink="/x">x</a></ng-template>'))).not.toBeNull()
  })
  it('does not let an ng-template that closed before the site leak into it', () => {
    expect(templateCondition(...site('<ng-template #t><b>t</b></ng-template><a §routerLink="/x">x</a>'))).toBeNull()
  })
  it('matches the braces of an ICU message as text, not as a block', () => {
    expect(templateCondition(...site('<span i18n>{n, plural, =0 {none} other {some}}</span><a §routerLink="/x">x</a>'))).toBeNull()
    expect(templateCondition(...site('@if (a) { <span i18n>{n, plural, =0 {none} other {some}}</span><a §routerLink="/x">x</a> }'))).not.toBeNull()
  })
  it('ignores a commented-out directive and the braces of a style sheet', () => {
    expect(templateCondition(...site('<!-- <div *ngIf="old"> --><a §routerLink="/x">x</a>'))).toBeNull()
    expect(templateCondition(...site('<style>.a { color: red }</style><a §routerLink="/x">x</a>'))).toBeNull()
  })
  it('fails safe on a brace it cannot match', () => {
    expect(templateCondition(...site('<p>use the } key</p><a §routerLink="/x">x</a>'))).not.toBeNull()
  })
})

describe('callConditional', () => {
  const navigateIn = (body: string) => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/c.ts', `@Component({ template: '<b (click)="go()"></b><b (click)="submit()"></b>' })\nclass C { router: any; svc: any; flag = true\n${body}\n}`)
    const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))
    if (!call) throw new Error('no navigate call in the fixture')
    return callCondition(call)
  }
  it('reports a call at the top of a handler as unconditional', () => {
    expect(navigateIn('go() { this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('does not count the call\'s own await, only an earlier one', () => {
    expect(navigateIn('async go() { await this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('reports a call after an early return, which skips it on some executions', () => {
    expect(navigateIn('go() { if (this.flag) { return } \n this.router.navigate(["/x"]) }')).not.toBeNull()
  })
  it('does not count a return that belongs to a callback in an earlier statement', () => {
    expect(navigateIn('go() { this.svc.items.forEach((i: any) => { return i }) \n this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('does not count a branch the call is not inside when nothing in it leaves the function', () => {
    expect(navigateIn('go() { if (this.flag) { this.svc.log() } \n this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('reports the next member of an observer object', () => {
    expect(navigateIn('go() { this.svc.save().subscribe({ next: () => this.router.navigate(["/x"]) }) }')).not.toBeNull()
  })
  it('reports a call after an await in a class-property arrow function', () => {
    expect(navigateIn('submit = async () => { await this.svc.save(); await this.router.navigate(["/x"]) }')).not.toBeNull()
  })
  it('keeps a call at the top of a class-property arrow function unconditional', () => {
    expect(navigateIn('go = () => { this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('reports a call in a catch clause, which runs only when the try throws', () => {
    expect(navigateIn('go() { try { this.svc.save() } catch (e) { this.router.navigate(["/x"]) } }')).not.toBeNull()
  })
  it('keeps a call in a finally clause unconditional', () => {
    expect(navigateIn('go() { try { this.svc.save() } finally { this.router.navigate(["/x"]) } }')).toBeNull()
  })
  it('reports a call in a loop body, which can run zero times', () => {
    expect(navigateIn('go() { for (const x of this.svc.xs) { this.router.navigate(["/x"]) } }')).not.toBeNull()
    expect(navigateIn('go() { while (this.flag) { this.router.navigate(["/x"]) } }')).not.toBeNull()
  })
  it('reports a call in any callback, not only one passed to subscribe', () => {
    expect(navigateIn('go() { setTimeout(() => this.router.navigate(["/x"])) }')).not.toBeNull()
    expect(navigateIn('go() { this.svc.save().pipe(tap(() => this.router.navigate(["/x"]))).subscribe() }')).not.toBeNull()
    expect(navigateIn('go() { this.svc.save().subscribe({ next() { this.router.navigate(["/x"]) } }) }')).not.toBeNull()
  })
  it('does not count a return or an await that belongs to a function declared in an earlier statement', () => {
    expect(navigateIn('go() { function h() { return 1 } \n this.router.navigate(["/x"]) }')).toBeNull()
    expect(navigateIn('go() { const o = { get v() { return 1 } } \n this.router.navigate(["/x"]) }')).toBeNull()
    expect(navigateIn('go() { const f = async () => { await this.svc.a() } \n this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('reports a return inside a switch case of an earlier statement', () => {
    expect(navigateIn('go() { switch (this.flag) { case true: return } \n this.router.navigate(["/x"]) }')).not.toBeNull()
  })
})

describe('callConditional at module level', () => {
  const navigateAt = (code: string) => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/g.ts', code)
    const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))
    if (!call) throw new Error('no navigate call in the fixture')
    return callCondition(call)
  }
  it('takes a function declared at the top of a module for a helper, whose callers it does not follow', () => {
    expect(navigateAt('export const guard = () => { router.navigate(["/x"]) }')).toBe('in a helper function')
    expect(navigateAt('export function guard() { router.navigate(["/x"]) }')).toBe('in a helper function')
  })
  it('reports a function declared inside another, which runs only when called', () => {
    expect(navigateAt('export function outer() { function inner() { router.navigate(["/x"]) } }')).not.toBeNull()
  })
})

describe('the reason a condition reader gives', () => {
  const callIn = (body: string) => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/r.ts', `@Component({ template: '<b (click)="go()"></b>' })\nclass C { router: any; svc: any; flag = true\n${body}\n}`)
    return callCondition(sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))!)
  }
  it('names the construct that makes a site conditional', () => {
    expect(callIn('async go() { await this.svc.a(); this.router.navigate(["/x"]) }')).toBe('after await')
    expect(callIn('go() { if (!this.flag) return \n this.router.navigate(["/x"]) }')).toBe('after early exit')
    expect(callIn('go() { try { this.svc.a() } catch { this.router.navigate(["/x"]) } }')).toBe('in a catch clause')
    expect(callIn('go() { this.svc.a().subscribe(() => this.router.navigate(["/x"])) }')).toBe('in a callback')
    expect(templateCondition(...site('@if (a) { <a §routerLink="/x">x</a> }'))).toBe('control-flow block')
    expect(templateCondition(...site('<p *ngIf="a"><a §routerLink="/x">x</a></p>'))).toBe('structural directive')
    expect(templateCondition(...site('<ng-template><a §routerLink="/x">x</a></ng-template>'))).toBe('ng-template')
  })
})

describe('templateCondition on markup a scan can misread', () => {
  it('reports a link inside an ICU case, where Angular instantiates no directive', () => {
    expect(templateCondition(...site('<span i18n>{n, plural, =0 {<a §routerLink="/x">x</a>} other {y}}</span>'))).toBe('ICU case')
    expect(templateCondition(...site('<span i18n>{g, select, a {<a §routerLink="/x">x</a>} other {y}}</span>'))).toBe('ICU case')
  })
  it('reads past a > inside a quoted attribute value', () => {
    expect(templateCondition(...site('<div [class.a]="n > 0" *ngIf="c"><a §routerLink="/y">y</a></div>'))).toBe('structural directive')
    expect(templateCondition(...site('<div [class.a]="n > 0"><a §routerLink="/y">y</a></div>'))).toBeNull()
  })
})

describe('callCondition on the rest of the ways a call can be skipped', () => {
  const callIn = (body: string, tpl = '<b (click)="go()"></b>') => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/k.ts', `@Component({ template: '${tpl}' })\nclass C { router: any; svc: any; flag = true; r: any\n${body}\n}`)
    return callCondition(sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))!)
  }
  it('reports a call in a ternary arm, after && || ??, in a case clause, in a for loop and after a throw', () => {
    expect(callIn('go() { this.flag ? this.router.navigate(["/x"]) : null }')).toBe('under a branch')
    expect(callIn('go() { this.flag && this.router.navigate(["/x"]) }')).toBe('under a branch')
    expect(callIn('go() { this.flag || this.router.navigate(["/x"]) }')).toBe('under a branch')
    expect(callIn('go() { this.r ?? this.router.navigate(["/x"]) }')).toBe('under a branch')
    expect(callIn('go() { switch (this.flag) { case true: this.router.navigate(["/x"]) } }')).toBe('under a branch')
    expect(callIn('go() { for (let i = 0; i < 3; i++) { this.router.navigate(["/x"]) } }')).toBe('in a loop')
    expect(callIn('go() { if (!this.flag) { throw new Error() } \n this.router.navigate(["/x"]) }')).toBe('after early exit')
  })
  it('reports a call after a break that leaves its block, on the right of a logical assignment, in an optional call or a default value', () => {
    expect(callIn('go() { do { if (this.flag) break; this.router.navigate(["/x"]) } while (false) }')).toBe('after early exit')
    expect(callIn('go() { out: { if (this.flag) break out; this.router.navigate(["/x"]) } }')).toBe('after early exit')
    expect(callIn('go() { this.r ||= this.router.navigate(["/x"]) }')).toBe('under a branch')
    expect(callIn('go() { this.r ??= this.router.navigate(["/x"]) }')).toBe('under a branch')
    expect(callIn('go() { this.svc?.log(this.router.navigate(["/x"])) }')).toBe('under a branch')
    expect(callIn('go(r = this.router.navigate(["/x"])) { }')).toBe('under a branch')
    expect(callIn('go() { this.router?.navigate(["/x"]) }')).toBe('under a branch')
  })
  it('does not count a break that leaves only a loop of its own', () => {
    expect(callIn('go() { for (const x of this.svc.xs) { if (x) break } \n this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('treats a member the template does not bind as a helper, conditional unless a handler calls it unconditionally', () => {
    expect(callIn('go() { this.bail() } \n private bail() { this.router.navigate(["/x"]) }')).toBeNull()
    expect(callIn('go() { if (this.flag) { this.bail() } } \n private bail() { this.router.navigate(["/x"]) }')).toBe('in a helper method')
    expect(callIn('other() { this.router.navigate(["/x"]) }')).toBe('in a helper method')
    expect(callIn('ngOnInit() { this.router.navigate(["/x"]) }')).toBeNull()
  })
  it('treats a member bound only under a template condition, or bound with a guard, as conditional', () => {
    expect(callIn('go() { this.router.navigate(["/x"]) }', '<b *ngIf="flag" (click)="go()"></b>')).toBe('in a helper method')
    expect(callIn('go() { this.router.navigate(["/x"]) }', '<b (click)="flag && go()"></b>')).toBe('in a helper method')
    expect(callIn('go = () => { this.router.navigate(["/x"]) }')).toBeNull()
    expect(callIn('stay = () => { this.router.navigate(["/x"]) }')).toBe('in a helper method')
  })
})

describe('the remaining fallbacks of the condition readers', () => {
  it('fails safe on a close tag it cannot match', () => {
    expect(templateCondition(...site('</div><a §routerLink="/x">x</a>'))).toBe('unreadable template')
  })
  it('does not take a binding that calls a member and then more for a bare call', () => {
    const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('/h.ts', `@Component({ template: '<b (click)="go() || reset()"></b>' })\nclass C { router: any\ngo() { this.router.navigate(["/x"]) }\nreset() {}\n}`)
    expect(callCondition(sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => /\.navigate$/.test(c.getExpression().getText()))!)).toBe('in a helper method')
  })
})
