# Formal model

## The graph

A UI transition graph is a guarded labelled transition system with modal edge labels, after
Larsen and Thomsen's modal transition systems.

- `S` — states: screens, routes and modals
- `E ⊆ S × Σ × G × M × S` — transitions, each carrying an event `σ ∈ Σ`, a guard `g ∈ G`
  held as symbolic source text, and a modality `m ∈ M = {must, may, unknown}`

`must` means the transition provably occurs for all declared navigations; `may` that it is
possible but conditional; `unknown` that a target exists but its modality could not be
determined.

**Legibility over decidability.** A guard is stored as the literal condition text and is never
evaluated. The consumer reads guards; it does not decide them. This keeps `G` an opaque
domain and removes any obligation to model application state.

**The golden invariant.** Every edge with `source ∈ {static, runtime}` carries a witness: a
`file:line` for a static edge, an observation id for a runtime one. Manual edits live in a
sidecar overlay and never enter the base graph. The invariant is stated in `../30-ir-spec-v0.md`
and is checked mechanically — see Test B in [30-evaluation-protocol.md](./30-evaluation-protocol.md).

## Soundness of the `must` tier

> **Claim.** Every `must` edge corresponds to a navigation that occurs, for every input on
> which the enclosing code executes, over the declared route set.

This is the only soundness claim the thesis makes. It is conditional on the declared route
set: a navigation to a target outside the route configuration is not covered. `may` and
`unknown` carry no such guarantee by construction — a `may` edge's witness proves that the
call site exists, not that the transition fires.

The distinction is load-bearing in evaluation. Asking whether a witness's target agrees with
an edge's target is a valid question for `must` edges and for `may` edges with a literal
target. It is *not* valid for over-approximated edges, and asking it anyway produces
meaningless failure counts.

## Scope: the domain attribution is defined over

A navigation site `l` occurs somewhere in the source. The question attribution answers is:
from which screens can a user trigger it? The answer is a **scope**, an element of the lattice

```
                 ⊤            every screen in the application
                 |
            subtree(r)        every screen under route r
                 |
            screen(r)         exactly one screen
                 |
                 ⊥            unreachable
```

ordered by set inclusion of the screens they denote, with join the least scope containing
both operands. The lattice has finite height, bounded by the depth of the route tree.

Each Angular construct has a scope:

| construct | scope |
| --- | --- |
| component above the router outlet (the application shell) | `⊤` |
| component within screen `r`'s subtree | `screen(r)`, joined over every screen containing it |
| component mounted at several routes | the join of those screens |
| a method of an injectable service | the join of the scopes of its callers |
| `canActivate` / `canMatch` on route `r` | `subtree(r)` |
| HTTP interceptor | `⊤` |
| route resolver on `r` | `subtree(r)` |
| NgRx effect reacting to an action | the join of the scopes of everything that dispatches it |

The service row is what makes this an analysis rather than a traversal: a service has no
intrinsic scope and inherits the join over its call sites, so attribution is a fixpoint over
the call graph with scopes as the abstract domain — a monotone dataflow framework in the
Kildall sense, terminating because the lattice height is finite and join is monotone.

## Guards, defined

The guard of an edge is not the guard of its target route. It is

> `guard(e) = ⋀ { conditions on the containment path from the screen to the call site }
>           ∧ ⋀ { guards of the target route }`

Structural directives (`@if`, `*ngIf`, `@switch`, custom structural directives) contribute the
first conjunction; route guards the second. Reporting only the second is strictly weaker and
is a measured defect: a link rendered only under `@if (isUser())` was labelled with the target
route's `requireAuth`, a predicate an authenticated non-owner satisfies while never being able
to take the transition.

## Edges are anchored, not materialised

A navigation site in the shell can fire from every screen. Materialising that yields one edge
per screen — on the largest corpus application, 674 screens against 1624 call sites in the
limit. The representation therefore anchors an edge at its scope:

```json
{ "fromScope": "⊤", "to": "n_login", "event": "click:routerLink",
  "guard": "!isAuthenticated", "modality": "may",
  "witness": { "file": "core/layout/header.component.html", "loc": { "line": 31 } } }
```

and expansion is a query:

```
edgesFrom(r) = edges anchored at ⊤
             ∪ edges anchored at subtree(r′) for every ancestor r′ of r
             ∪ edges anchored at screen(r)
```

This keeps the stored representation `O(call sites)` rather than `O(screens × call sites)`.

> **Proof obligation.** The expansion of the scope-anchored edge set equals the materialised
> edge set, modulo the constructs on the declared approximation list.
