# Must-fix gate, 2026-11-05

**Gate result: 3 of 13 items met, 10 partly met, none fully unmet.** The files changed are thesis.tex and ch3 to ch7. ch1-introduction.tex was unchanged on disk: every ch1 edit its editor reported was missing.

| Item | Status | What is still missing |
|---|---|---|
| REV-03 | partly | Estimated real-pair counts missing; `tab:world` row lacks "grouped after reading" and "relative recall". |
| REV-06 | partly | ch1 early statement lost; title puts scope attribution first; ch7 points to `sec:res-earlier` for the 36-site figure (it is in `sec:res-ablation`). |
| REV-07 | partly | Table 7.1 and appendix print 45/45 without "rename excluded"; RQ4 has two tables and a figure, not one. |
| REV-08 | partly | Expected chance hits (13.5, 9.7) not given; abstract and ch7 do not mention fan-out; new causal claims in ch5 unsupported. |
| REV-12 | met | |
| REV-13 | partly | Missing: whether the author saw the proposing tool, an interval for 41/41, an abstract marker for model readings. |
| REV-14 | partly | ch3 A1-A4 paragraph needs rewrite; under-approximating rules mislabelled "demotion rules"; ch1 1.2 states soundness without assumptions; ch6 contradicts ch3 on counting. |
| REV-15 | partly | Four-relation model not moved to an "extensions" section; Fig 2.1 draws unimplemented effect edge; "fallbacks ... not monotone" should be "one of which". |
| REV-16 | partly | Per-application median and range not given. |
| REV-17 | met | |
| REV-18 | partly | Extractor licence, DOI, licence column in Table 4.1, how to get the Rima et al. checkout; Availability text appears three times. |
| REV-22 | partly | "k8sdash" still in generated tables and ch3; mutation denominator not unified; Fig 3.1 note lacks nesting remark. |
| REV-23 | met | |

## Regressions
- R1. None of the ch1 edits are on disk.
- R2. The abstract grew from 360 to 380 words.
- R3. ch5:627, "blind to the tool that proposed it" is false for the first comparison.
- R4. ch5:485 and ch5:879, unsupported causal claims about the 39.4 % fan-out site; 136935 of mifos's 161363 pairs are reached only from the shell.
- R5. ch3:114-116, editor's working notes leaked ("No macro gives ..."), self-contradiction on A2.
- R6. ch6:189 and ch7 end, "trustworthy transitions" stronger than Claim 3.1 supports.
- R7. The Availability caveat is stated three times.

## Required edits
1. ch1:85 insert the main-contribution sentence after "depends on this extractor."
2. ch1:90 "an open-source static analyser" -> "a static analyser".
3. ch1:121 soundness property for the must tier, relative to stated assumptions (Claim~\ref{claim:must}).
4. thesis.tex:67 title (needs author and supervisor decision): "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution".
5. Abstract: replace "Scope attribution recovers" through "is not measured." with the 360-word block using the new macros.
6. ch5:627 delete ", blind to the tool that proposed it".
7. ch5:485 replace the no-chance-baseline passage with the \EtoEMifosChanceHits sentence; ch4:245 likewise.
8. ch5:879 delete the "same fan-out" sentence.
9. ch3:109-117 replace the A1-A4 paragraph.
10. ch3:217 reword the under-approximating rules; ch3:232 "one of which is not monotone"; ch6:95 counterexample wording.
11. ch6:189 and ch7 last sentence: "transitions that hold under the assumptions of Claim~\ref{claim:must}".
12. ch6:282-283 replace the two sentences; ch5:711 add the Wilson interval.
13. ch5:698, ch7:33, appendix:430: estimated real pairs and "grouped after reading; relative recall".
14. Mutation denominator: ch7:37 and appendix:429 use \MutDetected/\MutScored; move `tab:mutation` and \FigMutation to the appendix.
15. ch7:34 chance hits and fan-out; ch7:302 `sec:res-earlier` -> `sec:res-ablation`.
16. REV-16: per-application median and range in ch5:186, ch7:33, ch6:210.
17. Availability: delete ch6:324-326 paragraph and the ch3:458 licence sentence; rewrite ch4:441; add Licence column to Table 4.1 (realworld MIT, alfresco LGPL-3.0, ghostfolio AGPL-3.0, kubernetes/dashboard Apache-2.0, bitwarden GPL-3.0 with Bitwarden License for `bitwarden_license/`, openMF MPL-2.0).
18. Generators: `rima/head2head/score.mjs` Real macro; `e2e-nav/score.mjs` ChanceHits (13.5, 9.7); `rima/head2head/author-check.mjs` Wilson range (91.4 %-100.0 %); `route-oracle/compare.mjs` median and range (40.2 %, 14.3 %-100.0 %).
19. REV-15: remove `profile` node and dotted `effect` edge from fig-utg-example; move D/T parts of ch3 into an "Extensions not evaluated" subsection.
20. REV-22: "k8sdash" -> "k8s dashboard" in generators and ch3; Fig 3.1 note on nesting; fig-overview "uigraph extractor" -> "extractor".

Verdict: NOT PASSED before these edits.
