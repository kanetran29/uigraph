# Attribution — the algorithmic contribution

## The defect

A navigation site is currently attributed to a screen only when it occurs directly in that
screen's route component. Everything else contributes nothing. Three separately observed
symptoms share this one cause:

1. **Shared components contribute no edges.** The application shell holds the header beside
   the router outlet, not inside any screen's subtree, so its links are attributed nowhere.
2. **Multi-mounted components contribute one edge instead of several.** A component mounted at
   both `/` and `/tag/:tag` emits a single edge.
3. **Applications that navigate from services emit no edges at all.** Three of six corpus
   applications produce a route inventory with zero transitions; one of them holds 108
   `router.navigate` calls, none in a route component.

The manual audit in `../validation/angular-conduit-coverage-audit-2026-09-09.md` reached the
same conclusion independently and by hand: *"Header controls are absent... the source renders
the header outside the router outlet, so the navigation applies across screens."* It also
records that 43 of 62 extracted controls have no outgoing edge.

## The analysis

Compute, for every navigation site, its scope (see [10-formal-model.md](./10-formal-model.md)),
by fixpoint over a framework-aware call graph:

```
initial:  scope(l) = ⊥ for every navigation site
          scope(c) = ⊤                    for components above the router outlet
          scope(c) = ⨆ { screen(r) : c ∈ reach(C(r)) }   for components in screen subtrees
          scope(g) = subtree(r)           for guards and resolvers on r
          scope(i) = ⊤                    for interceptors

propagate: scope(m) = ⨆ { scope(caller) : caller calls m }   until fixpoint

emit:     for each navigation site l in unit u,  anchor an edge at scope(u)
```

Termination follows from finite lattice height and monotone join. Complexity is
`O(h · |callgraph|)` with `h` the route-tree depth.

## The four input relations, in order of difficulty

**Component nesting.** `A → B` when A's template instantiates B's selector. Requires resolving
a selector to a component *within the correct import scope*: NgModule `declarations`/`imports`
for module-based code, the `imports` array for standalone components. Matching selector text
globally is not sound — two components may share a selector string in different scopes.

**Router outlets as the interlock.** `<router-outlet>` is where the route tree plugs into the
nesting graph. Components on the path from the application root to the outlet are the shell and
take scope `⊤`; components below a screen component take that screen's scope. Named outlets
carry a second, parallel mount, which is what makes auxiliary routes representable — a defect
class that disappears as a side effect rather than needing separate treatment.

**Call graph with dependency injection.** `this.nav.goHome()` links to a method only through
type resolution. Angular DI adds real points-to difficulty: interface tokens resolved by
`useClass` / `useExisting` / `useFactory`, the same token bound to different implementations in
different injector scopes (`providedIn: 'root'` versus component-level `providers`), and
factories choosing at runtime. Where a token admits several candidates the analysis joins over
all of them — an over-approximation, and therefore `may`.

**Dispatch relations.** Indirection layers that a syntactic call graph does not cross. The
generalisation that covers them: *a dispatch is a call-graph edge from every dispatcher to
every handler*. This admits NgRx (`dispatch(action)` → `createEffect(ofType(action), …)`),
router event subscriptions, and host listeners on directives under the same fixpoint.

## Guards are program points, not annotations

A guard that returns a `UrlTree` **is** a navigation:

```ts
canActivate: [() => inject(UserService).isAuthenticated()
  ? true
  : inject(Router).createUrlTree(['/login'])]
```

That is a redirect edge from `subtree(r)` to `/login` under `!isAuthenticated`. Treating guards
as labels on inbound edges both misses this edge class — probably the most common transition in
authenticated applications — and produces the wrong label, as measured.

## Where the analysis stops

```ts
effect(() => { if (shouldRedirect()) router.navigate(['/login']) })
```

The firing condition is a data dependence on a reactive graph, not control flow. The signal
read set is statically visible; when it fires is not. The treatment is modality `unknown` with
the read set recorded as the symbolic guard, consistent with guards being read and never
evaluated. Declaring the boundary is worth more than appearing to resolve it, and it marks
exactly the edges only a runtime witness can confirm.

## Evaluation of this chapter

Same corpus, same harness, same protocol, two extractor tags:

| measure | `eval-1` | `eval-2` |
| --- | --- | --- |
| construct-to-transition conversion, per repo | baseline | after attribution |
| mutation detection rate, per repo | baseline | after attribution |
| E2E node-level recall, where a suite exists | baseline | after attribution |
| witness-clean rate on the `must` tier | baseline | after attribution |

The before/after table is the result. It requires the baseline to be frozen and published
first.
