# Baseline results

**Provenance.** Extractor `c4f8b83` (2026-07-19, the GitHub head at capture). Corpus pinned at
the commits listed below. Harness 1.0.0. Measured 2026-09-13.

**This baseline is provisional.** The working copy is roughly two months ahead of the measured
commit and includes adapter fixes not present here. Re-run and re-tag as `eval-1` after pushing,
before any figure is quoted. Control extraction was not enabled, so these figures describe the
route and transition layer only.

## Corpus

| application | commit | app directory | declared routes |
| --- | --- | --- | --- |
| gothinkster/angular-realworld-example-app | `dd99ed2c` | `.` | 14 |
| alfresco/alfresco-content-app | `b88d47f4` | `projects/aca-content` | 71 |
| ghostfolio/ghostfolio | `9884fa0b` | `apps/client` | 119 |
| kubernetes/dashboard | `0ba796d9` | `modules/web` | 119 |
| bitwarden/clients | `e40ce6f0` | `apps/web` | 437 |
| openMF/web-app | `7f781796` | `.` | 674 |

## RQ1 — construct-to-transition conversion

| application | routerLink | router.navigate | nodes | `must` edges | conversion |
| --- | --- | --- | --- | --- | --- |
| realworld | 40 | 11 | 11 | 7 | 13.7% |
| bitwarden | 39 | 174 | 78 | 10 | 4.7% |
| mifos | 1042 | 582 | 178 | 69 | 4.2% |
| alfresco | 5 | 108 | 30 | 0 | 0% |
| k8s dashboard | 57 | 4 | 40 | 0 | 0% |
| ghostfolio | 308 | 45 | 1 | 0 | 0% |

Across six real applications, static extraction turns **0–14%** of the navigation constructs
present in the source into deterministic transitions. Three of six produce a route inventory
with no transitions at all.

Not every construct should become a distinct edge — duplicates, external links and repeated
targets collapse — but no collapsing rule takes 113 constructs to zero.

**Report edge counts per tier or not at all.** The largest application's 246 edges are 69
transitions plus a single 177-way over-approximation from one unresolvable call site. The
aggregate is not a meaningful quantity.

## RQ2 — defect classes

Each corroborated by at least two independent oracles.

| class | evidence | scale |
| --- | --- | --- |
| **Attribution**: navigation outside route components is invisible | every mutation miss on realworld; two on alfresco; the multi-mount edge absent from `/tag/:tag`; the manual audit's header finding; 43 of 62 controls with no outgoing edge | dominant; plausibly the cause of the three 0% applications |
| **Lazy module boundaries not followed** | Test C reports the route declared and absent; Test D proves two passing tests visit it; Test F renames its path and the graph does not move | one module observed |
| **Guards unreliable in both directions** | removing `canActivate` leaves the graph unchanged; edges carry the target route's guard where the enabling condition was a template `@if`; two distinct predicates share one opaque guard id | systematic |
| **Named and auxiliary outlets not modelled** | three E2E specs visit `(viewer:view/:id)` URLs with no corresponding node; 8 `outlets:` usages in source | one application |
| **Constant-valued route paths not resolved** | ghostfolio yields 1 node from ~150 declared screens; bitwarden uses the same idiom | two applications |

## RQ4 — change sensitivity

| application | mutants scored | detected | re-detecting a coverage gap | detection rate |
| --- | --- | --- | --- | --- |
| realworld | 13 | 8 | 0 | 61.5% |
| alfresco | 4 | 2 | 3 (excluded) | 50% |

Samples are far too small to quote; they establish the method, not the figure. The
interpretation is what matters: a change the graph cannot see is a change impact analysis would
miss, so this rate bounds any change-propagation claim built on the graph.

## Precision on the `must` tier

| application | `must` edges | witness-clean |
| --- | --- | --- |
| mifos | 69 | 69/69 |
| realworld | 7 | 6/7 |

The single violation is a `must` edge at confidence 1.0 whose witness navigates to
`/profile/:username` while the edge targets `/profile`. Both nodes exist, so this is not a
resolution failure — the edge points at the wrong one. A `must` edge with a wrong target is
precisely what the soundness claim forbids.

Otherwise the tier the formal claim concerns is clean on this sample, which is a positive
result and should be reported as one.

## Corroboration from prior manual work

`../validation/angular-conduit-coverage-audit-2026-09-09.md` audited the same application by
hand five days before these measurements, using the live dashboard and a running browser, and
reached the same principal conclusion by an entirely different route. It is the third
independent line of evidence for the attribution defect and is stronger than either automated
oracle on the specific point that the header renders outside the router outlet.

## A note on the repository's public claims

The project README presents badges asserting a passing extraction gauntlet and proof-gated
verification. Those describe behaviour on authored fixtures. They are not false, but a reader
arriving from the thesis will compare them against 0–14% on real applications. Either the
badges should state their scope, or the thesis should state theirs first and explicitly. The
second is cheaper and is done in [00-research-questions.md](./00-research-questions.md).
