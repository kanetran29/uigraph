# Premise ablation (the dossier kill-switch)

The dossier's #1 falsification test: agent+repo vs agent+repo+graph on navigation
tasks; if the delta is small, stop and rethink. Run on `sample-react-app`
(8 routes), 5 navigation tasks x 2 conditions x 2 runs (n=10/condition), judged
against runtime-verified ground truth.

## Results

| Metric | agent+repo | agent+graph |
| --- | --- | --- |
| Accuracy | 1.00 | 1.00 |
| Cross-run consistency | 5/5 tasks | 5/5 tasks |
| Avg sources consulted | 4.2 | 1.0 |

All 5 tasks scored 1.0 in both conditions, both runs.

## Verdict: premise NOT validated (at this scale)

- **No accuracy delta.** The graph did not make the agent more correct; capable
  agents answer an 8-route app perfectly from source.
- **The runtime-discrepancy task (T2) did not discriminate.** Both repo runs
  correctly identified that the `/dashboard` redirect is a navigate-during-render
  no-op — they inferred runtime truth from source. The runtime-verified artifact's
  expected correctness advantage did not materialize.
- **Only measured win: cost.** The graph is a single artifact vs ~4.2 source files
  read — the amortization axis, modest in absolute terms.

By the dossier's own gate (success delta < 30% -> rethink), the success delta is
zero. This is a stop/rethink signal **at this scale**.

## The honest caveat

The dossier predicts the delta only opens past ~100 routes (map exceeds context,
source-reading gets expensive, self-derived maps vary across runs). An 8-route
sample is far below the ICP, so a null accuracy delta is *expected*, not disproof
— but it is also not validation. Validating the premise requires a real
100-300-route app, which is not yet wired up. n=10 is also small.

## Implication

Do not claim the graph improves agent correctness on small/mid apps; it does not
(measured). The defensible value today is (a) cost/amortization (grows with size,
untested at scale) and (b) catching Code-vs-Runtime discrepancies that are
genuinely non-obvious from source (T2 was not one of those for a capable agent).
The next honest step is a large-app test, not more features.
