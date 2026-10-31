# Instructions given to the two readers of results-must/review.json

Both readings were made on 2026-11-01 by the AI assistant the thesis declares, in two separate contexts, with the instruction text below. `${lens}` was replaced by the reader's lens, and `${CONSTRUCTS...}` by the thirty constructs, one per line as `app site`.

Lens of reader a: read the code literally; when a handler is bound in a template, open the template and check the binding and its position.

Lens of reader b: start from where each component is mounted and each handler is bound, then work inward to the construct.

## Instruction text

```
You are reading Angular source by hand to record, construct by construct, whether a navigation runs whenever the code that holds it runs. Your reading is recorded as an independent check of a static analyser, so do not run any analyser, classifier or test from the repository /Users/kanetran29/personal/uigraph, and do not read packages/adapter-angular/src/conditions.ts, nav.ts or extract.ts, nor any file under thesis-handoff/route-oracle/results-*. Read only the application sources.

Sources: /Users/kanetran29/personal/uigraph-corpus/<app>/<sub>, with sub realworld ".", bitwarden "apps/web", mifos ".". A site path is relative to that directory (bitwarden sites starting ../../libs are in the monorepo's libs). Each site is file:line; a .html line holds a routerLink, a .ts line a Router.navigate or navigateByUrl call (or a routerLink inside an inline template).

The definition to apply. A construct "runs always" when, every time its handler runs (for a call) or its template renders (for a link), the navigation is attempted. It does NOT run always when any of these holds: it sits inside an @if/@else/@for/@empty/@switch/@case/@defer block, under any structural directive (an attribute with a leading *), inside an <ng-template>, or inside an ICU case of its template; or (for a call) it sits under an if/else, ternary, switch case, && || ?? (or their assignment forms), in a loop body, in a catch clause, in an optional call or default parameter value, inside any callback (subscribe, then, tap, setTimeout, an observer object member, an arrow passed to anything), after an earlier await, return, throw or break in an enclosing block; or it sits in a class member that is not itself a handler and that no handler calls unconditionally. A handler is a lifecycle hook, the constructor, a member a decorator such as @HostListener registers, or a member the component's template binds to an event as a bare call (e.g. (click)="go()") outside any template condition. A link in a component also does not run always on a screen where that component is mounted only under a template condition (follow where the component's selector is used). Also record the destination the construct names, as written.

Your lens for tie-breaks: ${lens}

Constructs (app site):
${CONSTRUCTS.map((c) => 
```
