# Thesis documentation

These documents serve the master's thesis. They are written to a different standard from
the rest of `docs/`, and the difference is deliberate.

The product documentation describes what uigraph is built to do. These describe **what has
been measured**, under what assumptions, with what provenance. A sentence belongs here only
if it is one of:

- a definition,
- a statement with a proof or a proof obligation stated,
- a number with the inputs that produced it (extractor commit, corpus commit, harness version),
- an explicitly declared approximation or limitation.

Value propositions, market positioning, adoption strategy and roadmap belong in the product
docs and in `ui-graph-dossier-final-en.md`. They are not evidence and must not leak in here.

## Reading order

1. [00-research-questions.md](./00-research-questions.md) — what is being asked, and what is deliberately not claimed
2. [10-formal-model.md](./10-formal-model.md) — the guarded modal LTS, and the scope lattice attribution is defined over
3. [20-attribution.md](./20-attribution.md) — the algorithmic contribution
4. [30-evaluation-protocol.md](./30-evaluation-protocol.md) — the four oracles, their blind spots, and the reproducibility rules
5. [40-baseline-results.md](./40-baseline-results.md) — measured state of the extractor before any fix
6. [50-scope-and-threats.md](./50-scope-and-threats.md) — the declared approximation list, with measured prevalence

## Two rules that govern everything here

**Pin before you measure.** Every number cites the extractor commit and the corpus commits
that produced it. A figure whose inputs are not pinned is not a result.

**Freeze before you fix.** The headline result is a before/after comparison. Improving the
extractor before the baseline is published destroys the "before" and with it the claim.
Fixes go on branches; tags stay untouched.

## Relationship to the rest of docs/

- `../50-validation-ladder.md` — the engineering ladder. Rungs 1–4 are regression discipline,
  not external validity: they compare the extractor against fixtures its own authors wrote.
  Rung 5 is where thesis-grade evidence starts.
- `../validation/` — empirical reports predating this folder. `angular-conduit-coverage-audit-2026-09-09.md`
  is a manual audit that independently identified the attribution defect and is cited as
  evidence in [40-baseline-results.md](./40-baseline-results.md).
- `../ui-graph-dossier-final-en.md` — strategy and market record. Useful history; not a source
  of thesis claims.
