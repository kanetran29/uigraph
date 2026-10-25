# Petri's review of the draft (received ~21 Oct 2026), verbatim summary by chapter

Ch1: introduction clear, reads well. No changes requested.

Ch2:
- Too short (~7 pages vs target 15-20).
- Move 2.6 Formal foundations BEFORE 2.5 Angular mechanisms.
- Add/expand: (1) AST-based static analysis, typed JS/TS AST parsing (bridge to Ch3);
  (2) mutation testing theory (Jia & Harman) and use in web framework evaluation (bridge to Ch4/RQ4);
  (3) DI/IoC architectural literature beyond docs; (4) reactive state / signals dataflow analysis boundaries.

Ch3:
- Definition 3.1: explicitly define S (screens/states), Sigma (events), G (guards), M, alongside E ⊆ S×Σ×G×M×S.
  NOTE: in our model M is the MODALITY set {must, may, unknown}, not navigation targets. Define it as such and say so politely.
- Give an explicit equation linking routes to screen nodes, e.g. S = { screen(r) | r ∈ Routes }.
- Clarify bottom (⊥) in ⊥ ⊑ screen(r) ⊑ subtree(r) ⊑ ⊤.
- 3.2.2: if join is set union over P(S), lattice height is |S| not route-tree height h. Either clamp join to LCA in the route
  tree (height h) or update the complexity bound O(h·|callgraph|).
- 3.2.6 anchored-edges formula: ancestor relation must be reflexive (r' ⪰ r) or include E_subtree(r) explicitly.
- 3.2: state upfront which relations are in the full model vs implemented/evaluated in the uigraph prototype.

Ch4:
- Praise for systematic filtering + reporting rejected apps.
- Limitations to address: tool-driven selection bias (e.g. Spartacus rejected because route parser lacks config-driven routing);
  inverse relationship between app size and e2e test density.
- In discussion/future work, recommend: (1) automated GitHub search pipeline from a larger pool; (2) proprietary industrial
  case study; (3) minimum UI-test-density thresholds for ground-truth oracles.

Ch5:
- Ghostfolio/mifos analysis clear. Emphasise the core bottleneck: node extraction defects (constant path references,
  lazy module boundaries). Attribution works as expected but cannot draw edges to screen nodes never created.
  NOTE: ghostfolio constants are publicRoutes/internalRoutes (e.g. path: publicRoutes.about.path), not "ROUTES.GHOSTFOLIO".

Ch6 (unfinished; write all):
- 6.1 Key findings: synthesis of RQ1-RQ4 without repeating raw numbers; node-extraction bottleneck vs attribution.
- 6.2 Limitations & threats: internal (e2e oracle precision, metric formulation), external (open-source vs enterprise,
  NgModules vs standalone), construct validity.
- 6.3 Declared approximations per the soundiness manifesto (Livshits et al.): dynamic targets, signal effects,
  unresolved DI tokens, etc.
- 6.4 Add a note that the React/Vue comparison is a qualitative theoretical analysis.
- 6.5 Future work: constant path resolution, full DI/NgRx passes, industrial case studies, utility for AI coding agents /
  automated test generation.
- Utility assessment (6.1/6.5): how static navigation graphs help change impact analysis and zero-execution-cost CI/CD
  checks; acknowledge limits from runtime dynamic routing.

References (37 now): add peer-reviewed sources on mutation testing (Stryker, Jia & Harman), TypeScript AST static analysis
(ICSE/FSE/ISSTA/ASE), DI static analysis, LLM/AI coding agents for GUI testing (for 1.1 and 6.5).
-> 43 verified candidates are in lit2.bib with notes in lit2-notes.md.

Implied: RQ4 (mutation testing) stays in scope.
