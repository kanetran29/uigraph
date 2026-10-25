# Evaluation protocol

## Verified preconditions

Both were checked before any measurement was believed, and both hold:

- **Determinism.** Two extractions over unchanged source produce identical node and edge sets,
  compared on id, route, event, guard and modality after sorting. Without this, every delta in
  the mutation harness would be noise.
- **No state accumulation.** Extracting over an existing database yields the same graph as
  extracting after deleting it, so mutant runs are not polluted by the baseline run.

## Four oracles, each with a stated blind spot

No single oracle establishes correctness. Each is used for what it can prove, and its blind
spot is declared.

**Test B — witness verification (precision).** For every static edge, re-open the witness at
`file:line` and check that a construct of the kind the rule claims is present, and that its
target agrees with the edge's target. Blind to missing edges. Target agreement is only a valid
question for the `must` tier and for literal-target `may` edges.

**Test C — differential testing (diagnosis).** An independently written route-configuration
parser, sharing no code with the adapter. Disagreements are cases to diagnose, not a metric.
Requires independence, not superiority — which matters, because the first version of the
parser was weaker than the extractor in four of six applications.

**Test D — the application's own E2E suite as oracle (recall).** Every URL a passing test
visits is a screen that provably exists; ground truth comes from execution rather than from
re-reading the source. Measures node-level recall over the tested subset only. A direct `goto`
is not a UI transition, so visit pairs must not be counted as edges.

**Test F — mutation testing (sensitivity).** Inject a change whose effect on the graph is known
in advance; check the graph moved that way. Ground truth is the delta the experimenter
authored, so nothing is circular and no second analyser is needed. This produces the number the
impact-analysis question rests on.

## Three corrections the protocol had to make to itself

Each is recorded because it generalises, and because each would have put a wrong number in the
thesis.

1. **A permissive matcher flatters the system.** Test D initially allowed a URL parameter
   observed in a test to match a literal route segment, inventing matches. A visited parameter
   is a runtime value and can only stand where the route declares a parameter. Recall fell from
   86.7% to 66.7% when this was tightened.
2. **Tier-blind precision manufactures failures.** Test B initially reported 44.7% precision on
   the largest application. All 177 flagged edges were `may` at confidence 0.5 and all cited a
   single source line — one over-approximation fan-out from an unresolvable dynamic target. On
   the tier the soundness claim is about, the same run showed 69 of 69 clean.
3. **Mutants whose target is absent from the baseline test nothing.** They re-detect a coverage
   gap already counted elsewhere, and scoring them as sensitivity failures double-counts one
   defect across two metrics. They belong in a separate bucket.

The general rule: **interrogate any instrument that produces a dramatic number, in either
direction, before reporting it.** Both dramatic numbers this protocol produced were instrument
artefacts.

## Reproducibility

One command regenerates every figure from pinned inputs:

```
node run-all.mjs
```

It clones the extractor at its pinned commit, applies the recorded build patch, builds, fetches
each corpus application at its exact commit — never a branch tip — extracts, runs all four
oracles and writes `results.json` plus generated Markdown tables.

Three properties make this the protocol rather than a convenience:

- **Inputs are pinned.** Corpus applications were initially shallow clones of moving branches;
  two received new commits on the day of capture. The manifest pins exact SHAs and the runner
  refuses to proceed on drift.
- **Tables are generated, never typed.** Every transcription error in this project so far
  happened while copying numbers or aggregating across tiers.
- **Provenance is recorded.** Extractor commit, corpus commits, harness version, runtime version
  and timestamps accompany every run, so a figure in the thesis traces to what produced it.

## Corpus selection

Screened against six criteria, in reverse order of cost so that cheap disqualifiers run first:
a real application rather than a library or template; a non-trivial, nested, lazily-loaded route
tree; guards present, since guards are what produce `may` edges; a genuine E2E suite that drives
a browser; retrievable history in which tests and source change together; and an active history
rather than an archive.

The screening produced a structural finding that shaped the design: **route-tree size and E2E
density are inversely related.** The largest applications have thin or no UI E2E, while the one
with a dense navigation-focused suite is mid-sized. No single application supplies both scale
and execution-derived ground truth, so the corpus splits: applications with test suites carry
Test D, and the full set carries Tests B, C and F, which need no tests at all.

## Known gaps in the harness

Stated here rather than discovered later:

- mutant sampling is convenience rather than random, and the quota is not fixed per mutation
  kind, so cross-application rates are not yet comparable
- one mutation operator retargets to a non-existent route, making the expected delta ambiguous;
  it should retarget to a declared route
- Test D extracts URLs written as literals, so navigation expressed through page objects is
  invisible — a bias whose direction is unfavourable, since it under-samples exactly the
  click-driven navigation the graph is about
- Test B has checkers for two extraction rules only
- measurements were taken without control extraction enabled, so they describe the route and
  transition layer, not the control layer the audit in `../validation/` examined
