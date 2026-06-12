# uigraph IR SPEC v0

The Intermediate Representation (IR) is uigraph's single shared data structure: a
**guarded labeled transition system** with modal edge labels. It lives in
`@uigraph/core` and is **framework-agnostic** — the core knows nothing about
React, Angular, or any other framework. React and Angular support live in
*adapter* packages that import the core, read one framework's source, and emit
this IR. Adding a framework means adding an adapter; the IR never changes
(dossier §5.3).

This document defines the on-disk and in-memory shape of that IR, the overlay
format for manual edits, and the invariants `validate()` enforces.

## 1. Enums

```ts
// Modal labels after Larsen–Thomsen modal transition systems (dossier §5.3).
//   must    = the transition provably happens for all declared navigations
//   may     = the transition is possible but guarded / conditional
//   unknown = a target exists but its modality could not be determined
export type Modality = 'must' | 'may' | 'unknown';

// Provenance of every node/edge. Drives the golden invariant (dossier §5.1).
//   static  = produced by an adapter from a deterministic source witness (Tier 1)
//   runtime = produced by a confirmed runtime observation (Tier 3)
//   manual  = a human edit; lives ONLY in the overlay, never in the base graph
export type Source = 'static' | 'manual' | 'runtime';

// What a node represents in the app's state space.
export type NodeKind = 'screen' | 'route' | 'modal' | 'unknown';
```

## 2. TypeScript interfaces

```ts
export interface GraphNode {
  id: string;            // stable, unique within the graph
  route: string | null;  // route pattern, e.g. "/login", "/users/:id"
  componentPath: string | null; // source file backing the node, if known
  label: string;         // human-readable name, e.g. "Login"
  kind: NodeKind;
}

export interface Witness {
  source: Source;        // mirrors the edge's source (the proof's class)
  file?: string;         // source file for a static witness
  loc?: { line: number; col: number };
  ruleId?: string;       // adapter rule that produced a static edge
  observationId?: string; // append-only log entry for a runtime edge
}

export interface GraphEdge {
  id: string;            // stable, unique; identity for merge/diff (see §5)
  from: string;          // GraphNode.id
  to: string;            // GraphNode.id
  event: string;         // trigger, e.g. "click:Link", "navigate", "submit"
  guard: string | null;  // SYMBOLIC source text only — never evaluated (see §6)
  effect: string | null; // symbolic side-effect note, e.g. "history.push"
  modality: Modality;
  source: Source;
  confidence: number;    // 0..1; static literal targets ~1.0, may-edges lower
  witness?: Witness;     // deterministic proof; required for base edges (see §4)
}

export interface UiGraph {
  version: 0;
  meta: {
    adapter: string;        // e.g. "@uigraph/adapter-react"
    adapterVersion: string; // adapter package version
    rulesetVersion: string; // extraction ruleset version
    commit?: string;        // repo commit the graph was extracted from
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Manual human edits. NEVER mutate the base graph (dossier §5.1–5.2).
// Every element here MUST carry source:'manual'.
export interface Overlay {
  version: 0;
  base: string;          // content hash of the UiGraph this overlay applies to
  addedNodes: GraphNode[];
  addedEdges: GraphEdge[];
  editedEdges: GraphEdge[]; // full replacement edges, matched by id
  removedRefs: string[];    // node/edge ids hidden from the merged view
}
```

## 3. Concrete JSON example

A tiny graph: `Home → Login` is a `must`-edge fired by a `Link` click; `Login →
Dashboard` is a guarded `may`-edge whose guard is stored as readable text.

```json
{
  "version": 0,
  "meta": {
    "adapter": "@uigraph/adapter-react",
    "adapterVersion": "0.1.0",
    "rulesetVersion": "rr-v5-2026.06",
    "commit": "a1b2c3d"
  },
  "nodes": [
    { "id": "n_home", "route": "/", "componentPath": "src/Home.tsx", "label": "Home", "kind": "screen" },
    { "id": "n_login", "route": "/login", "componentPath": "src/Login.tsx", "label": "Login", "kind": "screen" },
    { "id": "n_dash", "route": "/dashboard", "componentPath": "src/Dashboard.tsx", "label": "Dashboard", "kind": "screen" }
  ],
  "edges": [
    {
      "id": "e_home_login",
      "from": "n_home", "to": "n_login",
      "event": "click:Link", "guard": null, "effect": "navigate",
      "modality": "must", "source": "static", "confidence": 1.0,
      "witness": { "source": "static", "file": "src/Home.tsx", "loc": { "line": 12, "col": 6 }, "ruleId": "rr.link-to" }
    },
    {
      "id": "e_login_dash",
      "from": "n_login", "to": "n_dash",
      "event": "submit", "guard": "isAuthenticated", "effect": "history.push('/dashboard')",
      "modality": "may", "source": "static", "confidence": 0.6,
      "witness": { "source": "static", "file": "src/Login.tsx", "loc": { "line": 30, "col": 4 }, "ruleId": "rr.use-history-push" }
    }
  ]
}
```

For the Angular adapter the same `e_login_dash` edge would carry the guard class
name as its symbolic text, e.g. `"guard": "AuthGuard"` with `ruleId:
"ng.can-activate"`. The graph shape is identical (§7).

## 4. Invariants `validate()` enforces

`validate(graph)` and `validate(graph, overlay)` reject any graph that violates:

1. **No dangling refs.** Every `edge.from` and `edge.to` resolves to a node `id`
   present in the graph (or added by the overlay, when validating a merge).
2. **Unique ids.** Node ids are globally unique; edge ids are globally unique.
3. **Witnessed base edges (golden invariant, dossier §5.1).** Every edge whose
   `source` is `static` or `runtime` MUST carry a matching `witness`. No edge
   enters the base graph without a deterministic witness.
4. **Overlay purity.** Every node/edge in an `Overlay` MUST have `source:
   'manual'`. No overlay element may claim `source: 'static'` or `'runtime'`,
   and the base graph may contain **no** `source: 'manual'` element.
5. **`must` provenance.** A `must`-edge may only originate from a Tier-1 static
   fact (a literal, fully-resolved navigation over the declared route set) or a
   Tier-3 confirmed observation. Manual edges and over-approximated targets are
   `may` or `unknown`, never `must`.
6. **Confidence range.** `0 ≤ confidence ≤ 1`.

## 5. `merge` and `diff` semantics

**Edge/node identity is the stable `id`** — never structural position.

`merge(base, overlay) → UiGraph`. The displayed graph is the merge; the base on
disk is never mutated (dossier §5.2).

- `addedNodes` / `addedEdges` are appended (id collisions are a validation
  error).
- `editedEdges` replace the base edge with the same `id`; the manual edge wins in
  the view but the base record is untouched on disk.
- `removedRefs` hides the listed base ids from the merged result (soft delete);
  the base still contains them.

`diff(a, b) → { addedNodes, removedNodes, addedEdges, removedEdges,
changedEdges }`, all keyed by `id`:

- **added**: id present in `b`, absent in `a`.
- **removed**: id present in `a`, absent in `b`.
- **changed**: id in both, but some field (`to`, `guard`, `modality`,
  `confidence`, …) differs. The diff reports the changed fields so a behavior
  change is explainable edge by edge (dossier §5.2, "lockfile for behavior").

## 6. Legibility principle

A guard is stored as **symbolic source text** — the literal condition or guard
identifier copied from source (`"isAuthenticated"`, `"user.role === 'admin'"`,
`"AuthGuard"`). uigraph **never evaluates** it. The consumer is an LLM agent that
only needs to *read* the guard, not decide it (dossier §4.4: legibility over
decidability). `validate()` does not parse or interpret guard text; it is opaque
data.

## 7. The IR is adapter-independent

This IR is identical regardless of which adapter produced it. The React adapter
(react-router v5/v6) and the Angular adapter (`RouterModule`/`Routes`,
`canActivate`) differ only in **how they populate** the same fields — which
source constructs map to nodes, events, guards, and witnesses. Every downstream
consumer — `@uigraph/core` ops, the `@uigraph/mcp` server, the CLI, and the
dashboard — sees one shape and never branches on framework. That is the whole
point of the framework-agnostic core plus adapter-layer architecture.
