# uigraph — Adapter Contract

This is the boundary every framework adapter implements so `@uigraph/core` stays
framework-agnostic. The core defines the IR (a guarded labeled transition system
with modal `must|may|unknown` labels, per-edge `source` and `confidence`), the
pure ops, the graph-algorithms layer, and *this contract*. It knows nothing about
React, Angular, or any router. An adapter is a plugin that turns one framework's
source into the shared `UiGraph`. Adding a framework = adding an adapter; the core
never changes.

The contract maps onto the dossier's tap points: an adapter sits at the **source
substrate** (the compiler reads the possibility space — branches, readable guards,
declared routes), never the DOM or build output. `register` and `stamp` are
declared here so the DOM/registration and testid surfaces have a home, but in v1
they are future stubs.

## 1. The interface

An adapter is a plain object exposing `name`, a cheap `detect`, and `extract`. The
core passes it an `AdapterContext` carrying shared services so adapters never open
files or spin up a TS project themselves.

```ts
interface Adapter {
  /** Stable id, e.g. 'react' | 'angular'. */
  name: string

  /** Cheap heuristic: does this projectDir look like our framework? */
  detect(projectDir: string): boolean

  /** The only required v1 capability: source -> shared IR. */
  extract(projectDir: string, opts: ExtractOptions, ctx: AdapterContext): Promise<UiGraph>

  /** FUTURE STUB (v1): bind a graph node to a live DOM anchor. */
  register?(...args: unknown[]): never

  /** FUTURE STUB (v1): emit a stable testid for a node/edge. */
  stamp?(...args: unknown[]): never
}

interface AdapterContext {
  readFile(path: string): string          // cached, sandboxed file reads
  tsProject(): TsProject                   // shared ts-morph / TS compiler project
  log: Logger                              // structured, level-gated logging
}
```

`ExtractOptions` carries the commit hash and ruleset version so the result is
content-addressable per the pure-system law `G = fold(reduce_fn, static_facts)`.

## 2. What `extract` MUST guarantee

`extract` is the contract's load-bearing method, and it is bound by the golden
invariant: **no edge enters the graph without a deterministic witness.** Concretely:

- Every emitted edge carries `source: 'static'`. An adapter never invents
  `manual` or `runtime` edges — those enter only via the overlay and the
  observation log, downstream of the adapter.
- `must`-edges are emitted **only** for statically proven navigations (a literal
  target resolvable against the declared route set).
- Unresolved or over-approximated targets become `may` or `unknown` edges, fanned
  out **over the declared route set only** — never a guessed string, never an
  interprocedural points-to chase beyond literal targets.
- Guards are captured as **symbolic text** (the guard expression / guard class
  name), not evaluated. A guarded navigation is at most a `may`-edge.
- `extract` emits a **soundiness report**: the list of declared-but-unresolved
  cases (dynamic targets, computed paths, lazy boundaries) it deliberately
  over-approximated, so coverage is honestly accounted rather than silently
  dropped.

## 3. Capability levels

| Level | Emits | v1 targets |
|---|---|---|
| **L0** | Node inventory only (screens/states; no edges) | floor for any adapter |
| **L1** | Routes + literal navigations as `must`/`may`-edges | Angular (minimum) |
| **L2** | L1 + guards as symbolic text + over-approximated `may`-edges over the route set | React |

React targets **L2**; Angular targets **L1–L2** (routes minimum; guards as far as
cheaply available).

## 4. Framework constructs → IR

**React** (`@uigraph/adapter-react`, via ts-morph / TS compiler API; v5 **and** v6):

| Construct | IR element |
|---|---|
| `<Route path component\|render\|element>` (`<Switch>` / `<Routes>`) | node + declared route |
| `useHistory().push` / `useNavigate()` literal arg | `must`-edge |
| `useHistory().push` / `useNavigate()` non-literal arg | `may`/`unknown` over route set |
| `<Redirect>` / `<Navigate>` | `must`-edge |
| guard wrapper / conditional render | symbolic guard text → `may`-edge |

**Angular** (`@uigraph/adapter-angular`, via TS compiler API):

| Construct | IR element |
|---|---|
| `RouterModule` / `Routes` (`path` / `component` / `children`) | node + declared route (incl. nesting) |
| `Router.navigate` / `navigateByUrl` literal | `must`-edge |
| `Router.navigate` / `navigateByUrl` non-literal | `may`/`unknown` over route set |
| `routerLink` | `must`-edge |
| `canActivate` guard class name | symbolic guard text → `may`-edge |

## 5. Supported / not-yet-supported per adapter

This is the honest coverage matrix as of the current code, after the
crash-safety / soundiness / dedup hardening. It exists so community users set
correct expectations: uigraph extracts the **statically witnessed** routing/nav
surface per framework — and is deliberately silent (a soundiness note, never an
invented edge) on everything below the line. Anything in "Not yet supported"
needs a future adapter pass or **runtime verification** (`report_observation`)
to enter the graph; none of it is a completeness claim.

These limitations are surfaced at extraction time, not just here: `extract`
returns a soundiness report (§2) listing the unresolved cases it
over-approximated, and `uigraph map` prints a per-kind summary, so a partial map
is distinguishable from a clean one.

### React (`@uigraph/adapter-react`, react-router v5 + v6)

**Supported**
- `<Route path component|render|element>` inside `<Switch>` / `<Routes>`, including nested route trees → route nodes.
- `<Link>` / `<NavLink>` `to`, `<Navigate>` / `<Redirect>` → `must`/`may` nav edges.
- `useNavigate()` / `useHistory().push|replace` with a **literal** target → `must`-edge; non-literal (template prefix, const route-map, branch) → `may`-edges fanned over the declared route set.
- `withRouter`-injected `history.push` (the older HOC pattern).
- Guards / conditional renders captured as **symbolic text** → at most a `may`-edge.
- Controls (buttons / inputs / links) and their nav handlers when run with `--controls`.

**Not yet supported (soundiness note, no edge invented)**
- **Data-router object config**: `createBrowserRouter([...])` / `createRoutesFromElements` + `RouterProvider`. Only JSX `<Route>` declarations are read today.
- **Inline-JSX route elements**: `element={<div>…}` with no component file to scan — emitted as an `inline-jsx-route` note.
- **Dispatch / state-driven navigation**: a handler that `dispatch()`es a store action whose reducer/effect navigates — recorded as a `dispatch-driven-nav` note. Needs runtime verify or a future dispatch-aware adapter.
- **Aliased / indirected router hooks** and **fully dynamic targets** computed at runtime — `dynamic-target` / `over-approximation` notes; never a single guessed `must`.

### Next.js (`@uigraph/adapter-next`, App Router + Pages Router)

**Supported**
- File-system routes: `app/**/page.*` (App Router) and `pages/**/*` (Pages Router) → route nodes.
- Dynamic `[slug]` → `:slug`; catch-all `[...slug]` / optional `[[...slug]]` → wildcard segment; route groups `(marketing)` and named slots `@team` carry no URL segment.
- `<Link href>`, `useRouter().push|replace`, route-level `redirect()` → nav edges (via the shared react engine).
- **App Router layout-chain navigation**: `<Link href>` declared in the wrapping `layout.tsx` chain (shared chrome — Navbar/Sidebar) attributed to the routes it wraps → `may`-edges (`layout-nav` note records the count).

**Not yet supported (soundiness note, no edge invented)**
- **Parallel routes** (`@slot`) and **intercepting routes** (`(.)`, `(..)`, `(...)`) beyond treating the slot as carrying no segment — their interception/composition semantics are not modeled.
- `next.config` **redirects / rewrites** (config-level, not in source).
- The same dispatch/state-driven and fully-dynamic-target gaps as React (shared engine).

### Vue (`@uigraph/adapter-vue`, vue-router)

**Supported**
- `Routes` array (`path` / `name` / `component`, incl. nesting) → route nodes; lazy `() => import('…')` components resolved.
- `<router-link to|:to>` (literal, named-route, template-prefix) → nav edges over the route set.
- `router.push|replace` from a `useRouter()`-bound ref — inline in a handler **or** traced from an `@event` handler to its method definition (script-setup fn/const-arrow or Options-API method) → `must`/`may` edges; guards captured symbolically.
- Controls and their handlers when run with `--controls`.

**Not yet supported (soundiness note, no edge invented)**
- **Fully dynamic / computed targets** and non-`useRouter` navigation indirections — `dynamic-target` / `over-approximation` notes.
- Programmatic navigation routed through a store action (Pinia/Vuex) — same dispatch-driven gap; needs runtime verify.

### Angular (`@uigraph/adapter-angular`)

**Supported**
- `Routes` array (`path` / `component` / `loadComponent` / nested `children`) → route nodes; `loadChildren: () => import('./x.routes')` followed into the imported module under its parent prefix.
- `routerLink` / `[routerLink]` (literal, template-prefix, array-segment) → nav edges over the route set.
- `Router.navigate([...])` / `navigateByUrl(...)` literal → `must`-edge; non-literal → `may`.
- `canActivate: [Guard]` class names captured as **symbolic guard text** → at most a `may`-edge.
- Controls parsed from the inline component template (buttons / inputs / links) and their nav handlers when run with `--controls`.

**Not yet supported (soundiness note, no edge invented)**
- **Signal-based routing / `input`-binding router state** (Angular signals) — not traced; navigation that flows through a signal is not statically witnessed.
- **API effects**: the Angular adapter does not yet attach `api:*` effects to controls (React/Vue parity gap).
- Fully dynamic targets and store/effect-driven navigation — `dynamic-target` notes; needs runtime verify.

### Cross-adapter floor

For **every** adapter: timing/race, multi-field interactions, and cross-session
behavior are outside what a finite static graph represents and are never emitted;
`unknown`-modality nodes/edges exist in the IR but no adapter emits them yet.
The golden invariant holds across the table: **no edge without a static
witness** — when in doubt, the adapter records a soundiness note rather than
inventing an edge.

## 6. Adding a third adapter

A new framework (say Vue or SolidStart) is added entirely outside the core:

1. Create `@uigraph/adapter-<framework>`, depending on `@uigraph/core` for the IR
   types and the `Adapter` interface — nothing else.
2. Implement `detect` and `extract`, using the `AdapterContext` for file reads and
   the TS project. Map the framework's router constructs onto IR per §2's rules.
3. Register the adapter with the CLI/MCP by `name` (e.g.
   `uigraph map --adapter <framework>`).

No core file changes. The core consumes the resulting `UiGraph` identically to
every other adapter's output.

## 7. The one hard rule

**No framework import may appear in `@uigraph/core`.** No `react`,
`react-router`, `@angular/*`, ts-morph, or framework-specific AST type may be
imported, referenced, or re-exported from the core package. The core depends only
on its own IR; adapters depend on the core. Any framework knowledge living in the
core is a contract violation — it belongs in an adapter. This is what keeps the
"adding a framework = adding an adapter" guarantee true.
