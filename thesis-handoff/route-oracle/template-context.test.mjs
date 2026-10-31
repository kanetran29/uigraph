#!/usr/bin/env node
// Checks templateContextsOf on synthetic templates, half of them cases where NO condition must be
// reported. A test that only asserts the conditional cases passes a scanner that calls every site
// conditional; the negative cases are what catch a brace inside a binding, an interpolation or a
// closed block leaking into the site's context. Run: node template-context.test.mjs
import assert from 'node:assert/strict'
import { templateContextsOf } from './template-context.mjs'

// Each case marks the site with the section sign, which is removed before scanning.
const CASES = [
  ['plain link', '<div><a §routerLink="/x">x</a></div>', []],
  ['*ngIf on the site element', '<a *ngIf="f" §routerLink="/x">x</a>', ['*ngIf']],
  ['custom structural directive on an ancestor', '<li *ifAuthenticated="true"><a §routerLink="/x">x</a></li>', ['*ifAuthenticated']],
  ['@if block', '@if (f) {\n  <a §routerLink="/x">x</a>\n}', ['@if']],
  ['@empty branch of @for', '@for (x of xs; track x) { <i>{{x}}</i> } @empty {\n  <a §routerLink="/x">x</a>\n}', ['@empty']],
  ['@for body', '@for (x of xs(); track x.id) {\n  <a §routerLink="/x">x</a>\n}', ['@for']],
  ['braces inside a multi-line tag holding the site', '<a\n  [ngClass]="{ active: x === y() }"\n  §routerLink="/x"\n>x</a>', []],
  ['interpolation braces before the site', '<p>{{ a }} {{ b | c }}</p><a §routerLink="/x">x</a>', []],
  ['void and self-closing elements before the site', '<img src="a" /><br><input type="text"><a §routerLink="/x">x</a>', []],
  ['a closed block before the site does not leak', '@if (a) { <span>x</span> }\n<a §routerLink="/x">x</a>', []],
  ['a closed element with a directive does not leak', '<li *ngIf="a">x</li><a §routerLink="/x">x</a>', []],
  ['realworld home.component.html:23', '<ul>\n  <li class="nav-item" *ifAuthenticated="true">\n    <a\n      class="nav-link"\n      [ngClass]="{ active: listConfig().type === \'feed\' }"\n      §routerLink="/"\n      [queryParams]="{ feed: \'following\' }"\n    >', ['*ifAuthenticated']],
]

let failed = 0
for (const [name, marked, want] of CASES) {
  const offset = marked.indexOf('§')
  const text = marked.replace('§', '')
  const got = templateContextsOf(text, offset)
  try {
    assert.notEqual(got, null, 'did not parse')
    assert.deepEqual([...got].sort(), [...want].sort())
    console.log(`ok   ${name}  ${JSON.stringify(got)}`)
  } catch (e) {
    failed += 1
    console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}
console.log(failed ? `\n${failed} of ${CASES.length} failed` : `\nall ${CASES.length} pass`)
process.exit(failed ? 1 : 0)
