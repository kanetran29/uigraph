# Sample form app — the decision tree (the spec the UI graph must match)

A multi-control **account sign-up** form. The graph is verified against THIS tree.

## Screens (graph nodes, `kind: screen`)

| id | route | meaning |
| --- | --- | --- |
| `n_home` | `/` | landing, link to sign-up |
| `n_signup` | `/signup` | the form (all controls live here) |
| `n_welcome` | `/welcome` | success screen (after 201) |
| `n_locked` | `/locked` | lockout screen (after 3 failed attempts / 429) |

## Controls on `/signup` (graph nodes, `kind: control`, parent `n_signup`)

| name | element | input.type | required | rule |
| --- | --- | --- | --- | --- |
| email | input | email | yes | non-empty + matches email pattern |
| password | input | password | yes | length ≥ 8 AND has digit AND has symbol |
| confirm | input | password | yes | must equal password |
| promo | input | text | no | if non-empty must match `^[A-Z0-9]{6}$` |
| terms | checkbox | — | yes | must be checked |
| submit | button | — | — | enabled only when ALL rules pass |

## Backend (OpenAPI) — `POST /api/signup`

Deterministic by email so every branch is reproducible at runtime:

| email value | status | body |
| --- | --- | --- |
| any new valid email | `201` | `{ "userId": "..." }` |
| `taken@example.com` | `409` | `{ "error": "email already registered" }` |
| `boom@example.com` | `500` | `{ "error": "internal" }` |
| (server-side reject) `bad@example.com` | `400` | `{ "errors": { "email": "rejected" } }` |
| (rate limit) after 3 failed attempts | `429` | `{ "error": "too many attempts" }` |

## The decision tree (cases → graph edges)

Legend: `T#` = tree case → edge `from --event[guard]/effect--> to`. `S`=stage that
materializes it: **1** static / **2** proposal-or-overlay / **3** runtime-confirm.

### A. Navigation into the form
- **T1** `n_home --click:Link--> n_signup` · S1 (must, static)

### B. Per-input validation (self-loops, `to:<self>`, effect annotates the outcome)
- **T2** email `change[email==='']` → `effect: error:required` · S2
- **T3** email `change[!emailPattern]` → `effect: error:invalid-email` · S2
- **T4** email `change[emailPattern]` → `effect: clear-error` · S2
- **T5** password `change[len<8 || !digit || !symbol]` → `effect: error:weak-password` · S2
- **T6** password `change[strong]` → `effect: clear-error` · S2
- **T7** confirm `change[confirm!==password]` → `effect: error:mismatch` · S2
- **T8** confirm `change[confirm===password]` → `effect: clear-error` · S2
- **T9** promo `blur[promo!=='' && !promoPattern]` → `effect: error:invalid-code` · S2
- **T10** terms `change` → `effect: state:setTerms` (gate input) · S2

### C. The valid-to-submit GATE
- **T11** submit `click[!allValid]` → `to:<self>` `effect: blocked (button disabled)` · S2 (may)
- **T12** submit `click[allValid]` → `to:<self>` `effect: api:POST /api/signup; loading` · S1/S2
  (the POST itself; the four outcome branches below fan out from the response)

### D. Submit outcome branches (from `n_signup`)
- **T13** `submit[allValid && res.201]` → `n_welcome` · `effect: navigate` · **S1** (guarded navigate, static) → S3 confirm (happy path, autonomous)
- **T14** `submit[allValid && res.400]` → `to:<self>` · `effect: toast:error; show:field-errors` · S2 → S3 (agent-driven)
- **T15** `submit[allValid && res.409]` → `to:<self>` · `effect: error:email-taken; toast:error` · S2 → S3 (agent-driven)
- **T16** `submit[allValid && res.500]` → `to:<self>` · `effect: toast:error; retry-allowed` · S2 → S3 (agent-driven)

### E. Retry / lockout
- **T17** any failed submit → `effect: increment:attempts` (counter lives in guard text, not a native field) · S2
- **T18** `submit[attempts>=3]` → `n_locked` · `effect: navigate` · **S1** (guarded navigate, static) → S3 (agent-driven)
- **T19** `n_locked` is terminal (no out-edges) · structural

## What "the graph MATCHES the decision tree" means (measurable)

1. **Structure**: all 4 screens + 6 controls present as nodes; every T# above present as an edge with the correct `from/to/event/guard/effect/modality`.
2. **Provenance is correct per stage**: T1/T13/T18 land as `source:static` after Stage 1; B/C/D-non-nav land as proposals/overlay after Stage 2; confirmed branches become `source:runtime` after Stage 3.
3. **Coverage honesty**: `accountedRatio == 1.0` (every edge runtime-confirmed OR parked-with-reason). `runtimeRatio` = the branches actually driven (happy path autonomously + value-branches agent-driven). Anything left only-proposed or only-static-may = MISMATCH.
4. **Planning**: `plan_path(n_signup → n_welcome)` and `plan_path(n_signup → n_locked)` return the guarded success / lockout paths.

Mismatch handling: if a T# is missing/mis-typed after the 3 stages → root-cause (adapter gap? bad proposal? undrivable?), `clear` the graph (re-map / reset overlay+observations), and rerun the offending stage.

---

## Verification result (3 stages run on this app)

Workspace: `~/uigraph-demo-ws/form` · registered as `sample-form` ("Sample (Form)").

**Stage 1 — static map** (`map --controls`): 4 screens + 7 controls; 5 edges. Captured
T1 (must) and — crucially — the two *guarded* navigations T13 `[res.status === 201] → /welcome`
and T18 `[attempts >= 3] → /locked` as `static may` (the adapter lifts the enclosing
`if` guard as symbolic text). The B/C/D non-navigation branches are absent (correct — not
statically provable).

**Stage 2 — proposals** (`migrate proposals.json`, 12 proposals): materialised into 3
outcome sub-states off `n_signup` — `error` (validation + 400 + 409 + 500), `toast` (429),
`loading` (POST in-flight). After this stage `accountedRatio = 0.2` (only the static `must`
edge is credited — a `may`+static edge is NOT counted until runtime, by design).

**Stage 3 — verify** (agent-driven, real browser): the autonomous runner confirmed **0/7**
— it fills one valid value per input and can't reproduce value/multi-field/repetition
branches. Driving the live app with branch-specific values instead, all branches were
runtime-confirmed: T13 happy→/welcome, T2/T3/T5/T7/T9 validation→error, T14/T15/T16
400·409·500→error, T16b 429→toast, T12 loading, T18 lockout→/locked. The two adapter
duplicate `<form>`-control navigations and the two non-transition micro-interactions
(T11 disabled-submit gate, T17 attempts counter) were resolved with auditable reasons
(parked / unverifiable).

**Mismatch found & fixed (the rerun step):** after the first Stage-3 pass the `loading`
edge was missing — its observation was confirmed but I had not `addNode`- d the
`ps_n_signup__loading` sub-state, so `applyObservations` dropped the edge (its `to` was not
in the merged graph). Root-caused, added the node, re-read → the stored observation folded
into the edge.

**Final: `accountedRatio = 100%` (8/8), `runtimeRatio = 63%` (5/8), open = 0, loopDone = true.**
Every decision-tree branch is present as an edge with correct event/guard/effect; the spine
(home→signup→welcome / →locked) and the three outcome sub-states are runtime-witnessed
(`must`, emerald); the duplicates are parked; the two micro-interactions are unverifiable
with reasons. The UI graph matches the decision tree.
