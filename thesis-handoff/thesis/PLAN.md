# Work plan

Working document. Not part of the thesis.

## Hard constraints

- Study right ends 31 December 2026. The December Degree Programme Committee meeting is the last one inside it.
- Submission target: 30 November 2026 in MyStudies (PDF/A, abstract, publishing permission) plus the graduation request in Sisu.
- Full draft to Petri: 2 November. He needs three to four weeks to read and write the statement.
- Thesis presentation must happen before submission; date to be agreed with Petri.

## Supervisor feedback (5 Oct 2026)

Plan approved as is, no signature needed. Hold 2 November strictly. Review points, all
addressed in the draft of 5 Oct:
1. RQs shortened; measures moved to the text after each RQ and to Section 4.2.
2. Section 2.5 grounded in IoC/DI, call graph construction, points-to, FRP; Section 2.6
   adds dataflow analysis (Kildall, Cousot, Nielson).
3. Chapter 3 split: Ch 3 analysis (model, attribution, implementation), Ch 4 evaluation
   setup (corpus, metrics, methods). Thesis now has seven chapters.
4. Loss breakdown per defect class per application (Table 5.4) and a before/after table
   skeleton for RQ3 (Table 5.6).
5. Section 6.4 on transfer to React Router and Vue Router.

## Status 12 Oct 2026

- Attribution v1 implemented on top of c4f8b833 (branch `attribution-v1`, commit 4505fd2,
  patch file delivered): component nesting, router outlets, shell (top), subtree
  anchors, expansion query, merged witnesses, precise inline-template witnesses. 63 adapter
  tests and 228 core tests pass. With the flag off the graph equals the baseline on all six apps.
- Before/after measured (harness 1.2.0): conversion realworld 15.0 -> 37.5%, k8s 0 -> 4.2%,
  bitwarden 12.1 -> 15.9%, mifos 5.4 -> 10.0%; alfresco and ghostfolio unchanged. Must tier
  86/87 -> 155/156 (only failure pre-existing). 81 of 468 attribution losses recovered.
- Remaining losses: owner not reached 156, target has no node 132, services 48, dynamic 34,
  unexplained 17.
- Not done: DI call graph (services, 48 constructs), dispatch relations, UrlTree guard edges,
  mutation re-run (RQ4).
- Proposed: tag `eval-1` = c4f8b833 (the version actually measured) and `eval-2` = the
  attribution commit. Unpushed local work stays out of the measured versions.

## Two rules

1. Pin the version under test. Every number cites the extractor tag and the corpus commits.
2. Freeze before fix. The headline result is a before/after table. Tag `eval-1` and publish its numbers before touching attribution. Fixes go on a branch.

## Milestones

| Date | Milestone | Done when |
|---|---|---|
| 28 Sep | `eval-1` frozen | working copy pushed; tag created; `corpus.json` updated with the new SHA; `run-all.mjs` re-run; results.json and tables committed |
| 5 Oct | Chapter 3 complete | corpus, model, protocol sections final; attribution section matches what will be built |
| 12 Oct | Attribution implemented | nesting graph with import-scope resolution; router-outlet interlock; DI-aware call graph; guards as program points; anchored edges |
| 15 Oct | Tripwire | RQ1 data on the tagged tool exists. If attribution is not working by now, RQ4 moves to future work and RQ3 reports the subset that works |
| 19 Oct | `eval-2` measured | same harness, same corpus; before/after tables generated |
| 26 Oct | Chapters 2, 4, 5 drafted | Android lineage read properly, not skimmed; results generated from results.json; limitations written |
| 2 Nov | Draft to Petri | complete, language pass done |
| 30 Nov | Submission | |

## Weekly

| Week | Work |
|---|---|
| 22–28 Sep | Push, tag, re-run. Fix mutation sampling (seeded, fixed quota per operator; retarget to a declared route instead of a non-existent one). Fix the mifos E2E glob. Read Yang et al. 2015 and 2018 in full. |
| 29 Sep–5 Oct | Attribution part 1: component nesting with import-scope resolution, router-outlet interlock. Read ProMal and UI-CTX in full. Finalise Chapter 3. |
| 6–12 Oct | Attribution part 2: DI-aware call graph, dispatch relations, guards returning UrlTree, anchored edges with expansion query. |
| 13–19 Oct | Tag `eval-2`. Full re-run. Before/after tables. Start Chapter 4 from generated tables. |
| 20–26 Oct | Chapters 4 and 5. Approximation list with prevalence table. Threats. Language pass on 1–3. |
| 27 Oct–2 Nov | Chapter 6. Consistency pass: every number traces to results.json; every citation opened. Send draft. |
| Nov | Presentation. Revisions from Petri. Final language pass. Format check against aaltothesis class. |

## Risks

| Risk | Mitigation |
|---|---|
| Study right timing | Email the SCI study coordinator this week: which date must the right cover (submission, DPC decision, or degree registration), and how to apply for an extension and by when. Filing an extension application costs nothing. |
| Attribution not done by 12 Oct | Chapters 1–2 and the RQ1/RQ2 results stand alone. Drop RQ4 first. Report RQ3 on whatever input relations are implemented and declare the rest. |
| Petri's reading time | Agree the draft date and reading window by email now, not in November. |
| Corpus apps need a backend | No planned method runs an application. If the runtime tier is added, Ghostfolio only. |
| Tool drift during measurement | Tags only. Never measure a working copy. |
| Bibliography | All 23 entries verified. Anything new goes through the same check before it is cited. |
| Prose reads as machine-generated | Rewrite each chapter in own words after the content is final. Check the SCI guidance on AI use and follow the disclosure it asks for. |

## Open admin items

- [ ] Push working copy; tag `eval-1`
- [ ] Get the 2026–27 DPC deadline table from MyCourses (current dates are inferred from earlier years)
- [ ] Email study coordinator about study-right timing and extension procedure
- [ ] Download `aaltothesis.cls` and `aaltologo.sty` from the Aalto wiki; replace the preview preamble in `thesis.tex`
- [ ] Ask Petri whether he will be listed as advisor as well (his other theses do this)
- [ ] Ask Petri about an industrial case study on the employer's Angular app (aggregate figures only)
- [ ] Agree presentation format and date

## Deliverables

- Thesis PDF/A, 60–75 pages
- uigraph tags `eval-1` and `eval-2`
- `corpus.json` manifest and `run-all.mjs` harness
- `results.json` and generated tables for both tags
- `references.bib`, every entry verified
