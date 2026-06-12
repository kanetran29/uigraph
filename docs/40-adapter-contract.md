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

## 5. Adding a third adapter

A new framework (say Vue or SolidStart) is added entirely outside the core:

1. Create `@uigraph/adapter-<framework>`, depending on `@uigraph/core` for the IR
   types and the `Adapter` interface — nothing else.
2. Implement `detect` and `extract`, using the `AdapterContext` for file reads and
   the TS project. Map the framework's router constructs onto IR per §2's rules.
3. Register the adapter with the CLI/MCP by `name` (e.g.
   `uigraph map --adapter <framework>`).

No core file changes. The core consumes the resulting `UiGraph` identically to
every other adapter's output.

## 6. The one hard rule

**No framework import may appear in `@uigraph/core`.** No `react`,
`react-router`, `@angular/*`, ts-morph, or framework-specific AST type may be
imported, referenced, or re-exported from the core package. The core depends only
on its own IR; adapters depend on the core. Any framework knowledge living in the
core is a contract violation — it belongs in an adapter. This is what keeps the
"adding a framework = adding an adapter" guarantee true.
