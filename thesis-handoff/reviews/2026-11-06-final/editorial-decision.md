# Editorial Decision, Round 2 (Verification)

**Manuscript**: "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution", D. K. Tran. Aalto University MSc thesis (Computer Science, supervisor Prof. Petri Vuorimaa). Revised draft: 117 pp., body pp. 8-96 (89 pp.), bibliography pp. 97-104, Appendix A pp. 105-111, Appendix B pp. 112-116. The title has changed since round 1, which used "Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications".
**Review round**: 2, a verification of the revision against the round-1 decision and roadmap (`../2026-11-05-full/editorial-decision.md`, REV-01 to REV-29).
**Decision date**: 2026-11-05 by the system clock. The review folder is dated 2026-11-06.
**Calibration status**: `NOT_CALIBRATED`

## Run notes

- **This is a simplified re-review.** No sprint-contract checkers were run, and the #576 three-gate re-review contract was not used. That means no `check_re_review_synthesis.py` recomputation, no FULLY/PARTIALLY/NOT_ADDRESSED/MADE_WORSE/CANNOT_VERIFY item derivation, and no mechanical decision gate. No Schema 6 or `revision-roadmap/1.0` machine artifacts were produced. The decision below is the synthesizer's judgement on five narrative seat reports.
- **A mechanical reading might differ.** R0 notes that applying the re-review derivation mechanically "would give a different answer", because REV-04, REV-09, REV-10 and REV-22 keep must-fix residuals. That derivation was not run, so I cannot say what it would give.
- **No cross-model decision check** was configured, so the decision is single-model.
- **Roadmap order.** The workflow asked for the remaining roadmap in severity order. The template orders by source, so this is a departure. The order ranks severity only and is not a work plan.
- **Verdict scale.** The matrix uses Addressed / Partly / Not addressed / Not applicable. A = the round-1 minimum fix and acceptance criterion are met at the places they name. P = met only in part. N = no material change.
- **My checks.** Where seats disagree, I checked the claim against `manuscript.txt`. Line numbers (`l. n`) refer to that file, and page numbers are the printed ones. I also checked the one repository fact that bears on the decision, R2's evidence on Rima et al.'s tool (see V7). I raise no critique of my own. Every item below traces to a seat.

---

## Review panel provenance

There is no typed `review-panel-provenance/1.0` artifact for this run. The values below come from the workflow's description and the seats' own input statements. They were not machine-verified.

| Seat | Role (card) | Actor | Context | Peer outputs visible in round 2 | Model family | Human reviewer |
|---|---|---|---|---|---|---|
| R0 | Journal-Fit / examiner (EIC card) | AI | fresh; own card and own round-1 report | no | Claude (Opus) | none |
| R1 | Methodology | AI | fresh; own card and own round-1 report | no | Claude (Opus) | none |
| R2 | Domain (static analysis) | AI | fresh; own card and own round-1 report | no | Claude (Opus) | none |
| R3 | Cross-disciplinary / practical | AI | fresh; own card and own round-1 report | no | Claude (Opus) | none |
| DA | Devil's Advocate (fixed) | AI | fresh; own round-1 report | no | Claude (Opus) | none |
| Synthesizer | Editorial synthesis | AI | separate context; reads all five reports | yes (by design) | Claude (Opus) | none |

| Provenance axis | Status |
|---|---|
| Role-separated | true |
| Context separation within the panel | true (as reported by the workflow) |
| Blind to peer outputs in round 2 | true (each seat states it read no other round-2 report) |
| Model-family distinct | **false**: one family (Claude) for every seat and the synthesizer |
| Provider distinct | false |
| Human-reviewer distinct | false: no human reviewer |

- **Model change between rounds.** Round-1 seats were Claude Sonnet and round-2 seats are Claude Opus. So a round-2 seat is not the same model as its round-1 counterpart, although it was given that report.
- **Inputs beyond the manuscript.** Each seat read the revised text and also opened repository material:
  - R0 checked rendered PDF pages and LaTeX cross-references.
  - R1 read `generated-h2h.tex` and the Ch. 4 and Ch. 6 sources.
  - R2 read the `rima/` result files and Rima et al.'s checkout and output.
  - R3 checked rendered pages, `LICENSE`, `PREREGISTRATION.txt` and `references.bib`, and looked at `ai-use-draft.tex` for orientation only.
  - DA checked rendered pages, `may-reasons.mjs` and `generated-may-reasons.tex`.

  Findings that rest only on such files are marked "repository evidence" below.
- **Correlated errors.** All seats and the synthesizer are one model family, so agreement across seats is not independent confirmation.
- **No independence claim.** No binary independence claim is made.
- **Accountable human.** The author, who approved the cards (`cards.md`).

---

## Decision: **Minor Revision**

All four scoring seats now recommend Minor Revision, each with confidence 4. The DA's own line also reads Minor Revision. The DA raises no new CRITICAL issue. Both round-1 CRITICAL items are resolved in the body of the thesis, and C1 keeps a one-clause residual in the abstract.

Every remaining must-fix item is a sentence-level edit, removal of a placeholder, the printing of figures already computed, or mechanical cutting. The one exception (F-04) is a unit relabel, or an optional re-count on existing data. No item needs a new experiment.

**Next check.** A full panel round is not needed again. A targeted check of the items below by the supervisor, or by one human outside the author-and-assistant loop, is enough. R1 and the DA say the same.

## Expected grade band (Aalto 1-5)

This is the synthesizer's projection. It is not computed or calibrated, and the supervisor and examiner set the grade. Only R0 was asked for a grade signal. R0 gives "around 4 (range 3-4) once the residuals are done", and still names readability "the first grade-limiting factor".

| State | Band | Reasons (seat evidence) |
|---|---|---|
| **As submitted now** | **3** (range 3-4) | **For.** The claims are now calibrated: R0 finds the thesis "claims no more than Ch. 5 shows on every point I raised as decision-bearing in round 1". Both round-1 CRITICALs are defused (DA §1). The preregistered comparison, the correction ledger (now Appendix A) and the calibrated closing sentence are kept (R0 strengths S1-S4, R1 strengths). This removes the round-1 low end of 2. **Against.** First, the text visibly is not final. There are four `[author: ...]` / "confirm" notes (l. 2200, 2202, 2254, 3968; all five seats), and R0 says "An examiner reading these will conclude the text is not final". The AI-use statement is unchanged, and R3 finds two of its sentences contradicted by the repository. Second, the supervisor's first request is still short: 89 body pages against the agreed ≤ about 80, and about 12 of the 19 pages saved were relocated to appendices, not deleted (DA). Third, the revision introduced two abstract regressions, "always fire" and 82.0 % without its comparator. Fourth, the Ch. 7 services sentence is contradicted by the tool the thesis ran (R2-W5). Fifth, sentence length and cross-reference density did not improve (R0 rows 15-16). In practice a supervisor would normally return a draft with visible author notes before grading; the band assumes it is graded as is. |
| **After the must-fix items (F-01 to F-14)** | **4** (range 3-4) | Matches R0's signal. With the services claim narrowed, the abstract regressions undone and the hygiene items cleared, what remains is presentation density (R0). |
| **What separates 4 from 5** | 5 not supported | The independence ceiling is unchanged. X-01 to X-05 were not done (R1 §1d). Every check of the must tier, the scope references and the pair readings still passes through the author or one model family. The thesis now says this itself (R1 Part 3, item 3). Readability, which R0 calls grade-limiting, is unchanged. |

## Blocking issues (3)

These block a positive outcome now. Every must-fix item in Part 4 is a condition for it.

| Ref | Blocking issue | Source seats | Evidence anchor | Resolving item |
|---|---|---|---|---|
| B1 | The text is not final, and two of the supervisor's requests are unmet. There are author placeholders, the AI-use statement is unchanged, and the length is 89 body pp. against ≤ about 80 unless the supervisor confirms 89. | R0 N1, W1, W5; R1 N3; R2 N4; R3 N1, REV-10 note; DA N3, REV-04 | text: l. 2200 "[author: archive DOI; a repository URL would name the extractor]"; text: p. 2 "An AI coding assistant was used in this work" | F-05, F-06, F-07 |
| B2 | The services-novelty claim is contradicted by the output and code of the tool the thesis ran. Ch. 7 keeps the sentence the round-1 roadmap said must go. | R2 W5 (Major); R0 row 9; R1 W11; R3 REV-09; DA REV-09 | text: l. 4351-4352 "accounts for the transitions it adds over their rules on their own subjects"; repository: `softscanner_fa/.../logic-utils.ts:229` "F1: Bounded Router-service tracing" | F-01 |
| B3 | The abstract's results paragraph says more than Ch. 5 at four points. "159 edges that always fire" states Claim 3.1 as fact. 82.0 % has no comparator and no self-reference caveat. "1631 of the 1657 constructs" uses a unit other than the thesis's construct. The pooled 66.7 % is put first, against the thesis's own declared primary summary. | N-01 (5 seats), N-02 (4), N-09 (DA), N-04 (5) | text: l. 40 "The corpus yields 159 edges that always fire"; text: l. 47-48 "its precision against a reference read from one application's source is 82.0 %" | F-02, F-03, F-04, F-08 |

---

## Reviewer summary

| Seat | Recommendation (r1 → r2) | Confidence (scope disclosure, not a weight) | Own tally | Key point |
|---|---|---|---|---|
| R0 Journal-Fit / examiner | Major → **Minor** | 4 | 17 items: 8 A / 6 P / 3 N | All six round-1 overclaims are fixed. What remains is local editing: 9 pp. over the length target, abstract density, the services sentence, figure names, placeholders and the AI statement. |
| R1 Methodology | Major → **Minor** | 4 | W1-W11: 2 A / 9 P / 0 N; 15 roadmap items: 6 A / 9 P / 0 N | The defects that bore on the decision are fixed in the body. The cut stripped two caveats from the abstract. The independence ceiling is now stated. |
| R2 Domain | Major → **Minor** | 4 (5 on W5) | 17 items: 6 A / 8 P / 3 N | One Major item is left: the repository shows that Rima et al.'s implementation already follows router-named services. The fix is text only. |
| R3 Practical | Major → **Minor** | 4 | 17 roadmap units: 6 A / 10 P / 1 N | The overclaims in R3's remit are fixed. Runtime cost, URL/DOI, the scope statement and ethics notification remain. |
| DA | Findings only; its line reads **Minor Revision** | per-finding | 21 roadmap items: 8 A / 12 P / 1 N | No new CRITICAL; 3 new MAJOR, 5 new MINOR. Strongest remaining argument: every external check was spent as a repair driver, and Ch. 7 leads with the post-repair figures. |

Four Minor Revision recommendations give **Minor Revision** under the decision matrix. No seat recommends Accept, Major Revision or Reject.

---

## Part 1: Verification matrix, REV-01 to REV-29

Seat columns show each seat's own round-2 status: A / P / N, or "—" where the seat did not assess the item. Where seats disagree, the verdict is arbitrated below (V1-V10) and checked against the manuscript.

| REV | Item (round-1 obligation) | R0 | R1 | R2 | R3 | DA | **Verdict** | Basis and residual |
|---|---|---|---|---|---|---|---|---|
| REV-01 | RQ1 must-tier headline (must) | A | A | P | A | A | **Addressed** (V1) | The definition and the 33/159/203 sensitivity stand beside every attribution of the small tier (l. 40-43, p. 56, p. 82, Table 7.1). Regressions in the same abstract sentence are tracked as N-01, N-07 and N-09. |
| REV-02 | RQ3 criterion cannot fail (must) | (N4) | P | — | (REV-06 note) | P | **Partly** | The monotone rule is gone (p. 46). The width is in the abstract, and the reversal is in Table 7.1. The abstract gives 82.0 % with neither comparator nor self-reference caveat (N-02). 59 % of k8s dashboard appears only in 5.3.2. |
| REV-03 | Rima headline is a post hoc subgroup (must) | A | A | A | A | A | **Addressed** | The label is "grouped after reading" everywhere it appears. The union definition and the 1512/163 real-pair estimates are given, and "does not rank the tools" is stated. Residual: the mifos stratum sizes are still missing (R1; F-14). |
| REV-04 | Length (must) | P | P | P | P | P | **Partly** | Body 108 → 89 pp.; total 124 → 117. Target ≤ about 80 pp. not met. Table 6.1 (pp. 82-89) and Table 7.1 (pp. 93-95) are uncompressed. Ch. 3 did not shrink (R2, R3). Caveats are still repeated (R0, R3, DA). |
| REV-05 | Abstract density (must) | P | P | P | P | P | **Partly** | About 360-377 words against a target of about 250, with 16 numerals. Must and may are now glossed. The limits sentence keeps in-sample and consumer use, but lost "non-independent references". |
| REV-06 | Title and contribution order (must) | A | — | A | A | A | **Addressed** | The title, abstract, 1.1, 1.3 and Ch. 7 agree. 36 sites (2.0 %) are stated early (p. 10). |
| REV-07 | RQ4 cannot fail (must) | A | A | — | A | A | **Addressed** (V8) | It is a sanity check throughout, with 67/67 as the headline denominator. 6.1 uses 45 with "rename excluded" (l. 3610-3614), which the round-1 fix allowed. |
| REV-08 | One fan-out site; e2e chance baseline (must) | — | A | P | P | — | **Partly** (V2) | The baseline (13.5 / 9.7) is in 4.2, 5.3.5 and Table 7.1. The 39.4 % appears in Table 7.1 and 5.5.3 (l. 3485), but not in the abstract or the Ch. 7 prose. The roadmap's link of 6.5 % to that site was wrong (R1; R2 Part 3), and the abstract's shell explanation is correct. |
| REV-09 | Services novelty (must) | P | P | P (Major) | P | P | **Partly** (V7) | Done: the qualifier "published rules" and the evidence size. Not done: how their tool holds the 3 airbus pairs, and which three pairs the repair removed (l. 3191 is still ambiguous). The Ch. 7 clause is kept word for word (l. 4351-4352), as is "no earlier mechanism can place" (l. 3087). |
| REV-10 | AI-use statement (must) | N | N (noted) | N (noted) | N | N | **Not addressed** | Deferred by design and counted once. R3 adds that two of its current sentences are contradicted by the repository. |
| REV-11 | 1.2 aims only (must) | P | — | A | — | A* | **Partly** (V3) | The text is aims-only (l. 367-371). Fig. 1.1 was not moved and still sits between RQ1 and RQ2 (l. 375-397). *DA marks A but lists the figure as a residual. |
| REV-12 | RQ5 "the loss was the tool's" (must) | A | P | — | — | P | **Partly** (V4) | The three-way answer and the bound to the classes found and fixed are done. "The lists below count causes, not constructs" (l. 3362-3363), so the per-outcome construct count is not done. |
| REV-13 | Validity and traceability of AI readings (must) | P | P | — | P | P | **Partly** | Verdict-blindness, the 3/45 and 10/114 change rates and the Wilson interval for 41/41 are stated. Tool-blindness is a placeholder (l. 3968). Ch. 7 says "I confirmed" (N-10). The abstract does not mark the alfresco reference as AI-built. |
| REV-14 | Must "lower bound" / may "upper bound" (must) | — | A | P (W2) / A (W3) | — | — | **Partly** (V5) | A1-A4 are stated with counterexamples. The may tier is now a "design intent". "The edges resting on A3 and A4 are not counted" (l. 1136-1137), and A3 can be counted. |
| REV-15 | Formal model vs evaluated pass (must) | (N2) | — | P | — | P | **Partly** | The least-solution claim is restricted to the core, D and T moved to 3.2.7, and the Fig. 2.1 edge removed. Algorithm 1 keeps model-only lines. The relation count is now inconsistent (N-06). |
| REV-16 | Pooled figures are mostly mifos (must) | (N5) | P | (N7) | (N3) | P | **Partly** | The median and range are in 5.3 and Table 7.1, and the selection is stated as not tool-blind. The abstract and 5.5.1 still lead with the pooled 66.7 % (N-04). |
| REV-17 | "Usable" vs untested consumers (must) | A | — | — | A | A | **Addressed** | "Consumer use is not measured" is in the abstract, and the may and must tiers are separated in Ch. 7. |
| REV-18 | Artifact availability, licences (must) | (N1) | P | (N4) | P | P | **Partly** | The licence column was added and verified against the checkouts (R3). The URL/DOI and the Rima licence status are placeholders (l. 2200, 2202). |
| REV-19 | Runtime cost (should) | — | — | — | P | — | **Partly** | The claim is hedged as "not itself measured", but "at no execution cost" is kept (l. 3645-3646). No figure is given. |
| REV-20 | Workspace-library layouts (should) | — | — | — | P | — | **Partly** | The library shell appears in Table 7.1. There is no single-source-tree scope statement in the abstract or 6.2. |
| REV-21 | Node "complete" (consider) | — | — | — | — | A | **Addressed** | "2 of six complete against the mounted routes" (Table 7.1). |
| REV-22 | Figure and table consistency (must) | P | A (own parts) | A (own part) | P | P | **Partly** (V6) | Denominators and the R1 and R2 notes are fixed. Three names remain for the oracle (Fig. 1.1 "runtime probe", l. 392; Fig. 4.2 note). "kdash" remains (l. 2395). Floats are deferred (Tables 4.1-4.3, Algorithm 1, the Table 6.1 header). There are Fig. 5.1 and 5.2 defects (R3, DA). |
| REV-23 | Abbreviations (must) | A | — | — | A | A | **Addressed** | NgRx, SPIN, ZAP and Ajax were added. Nit: F1 (Table 2.1) is undefined. |
| REV-24 | Provenance gaps (should) | — | P | — | — | P | **Partly** | The risks are stated. The oracle was not re-run and has no digest, and "preregistered" is kept on p. 45 without the caveat. |
| REV-25 | Ethics (should) | — | — | — | P | P | **Partly** | The licence is stated as a placeholder, and dead links stay candidates. There is no notification sentence, and 10.2 % is not qualified. |
| REV-26 | `unknown` modality vs MTS (should) | — | — | P | — | — | **Partly** | Now called "confidence labels". Def. 3.1 still says "never denotes ... a navigation target" (l. 1017), and 2.6.1 still says "adopts" (l. 673). |
| REV-27 | UrlTree redirect edges in limits (should) | — | — | N | — | — | **Not addressed** | Ch. 7 open items (l. 4354-4356) and the abstract are silent. Checked. |
| REV-28 | Dependencies not installed (consider) | — | — | N | — | — | **Not addressed** | Acceptable at "consider" (R2). |
| REV-29 | Android sentence (consider) | — | — | N | — | — | **Not addressed** | Unchanged (l. 926). |

### Counts

| Group | Addressed | Partly | Not addressed | Not applicable |
|---|---|---|---|---|
| All REV items (29) | **7** (01, 03, 06, 07, 17, 21, 23) | **18** (02, 04, 05, 08, 09, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 24, 25, 26) | **4** (10, 27, 28, 29) | **0** |
| Round-1 must-fix items only (20) | 6 | 13 | 1 (REV-10, deferred) | 0 |

No extension was done by the author: R1 marks X-01 to X-05 not done, R3 marks X-06 and X-09 not done, and R2 marks X-07 and X-08 not done. X-08 is a special case. R2 did the X-08 inspection itself in the repository (R2-W5), and that settles round-1 disagreement D1 (V7).

### Disagreements on verification and their arbitration

**V1. REV-01: Addressed (R0, R1, R3, DA) or Partly (R2)?**
- **R2** finds three gaps:
  - "always fire" drops the conditions of the claim;
  - the toolbar caveat has left the abstract;
  - 203 has no source in the results chapter.
- **Others**: the acceptance criterion is met.
- **Check**: l. 40-43 put the definition ("largely a matter of definition") and the 33/159/203 figures beside the small tier. Table 7.1 (l. 4204-4210) carries "125 from one toolbar" and the 62 unread destinations, as REV-01(d) required.
- **Resolution: Addressed** against the round-1 criterion. R2's three gaps are real. They are regressions introduced by the cut, so they are tracked as new issues N-01 and N-07 rather than as a failure of REV-01.

**V2. REV-08: Addressed (R1) or Partly (R2, R3)?**
- **Check**: the abstract does not mention 39.4 %. Ch. 7 has it in Table 7.1 (l. 4246) but not in its prose.
- **The roadmap's own error.** The round-1 minimum fix tied the 6.5 % to the 39.4 % site. R2 (Part 3) retracts that round-1 attribution, and R1 says the revision "correctly separates" the drivers. The abstract's "most of whose pairs only the shell reaches" is the correct explanation.
- **Resolution: Partly.** The baseline part is fully met. The remaining part, the 39.4 % edge share in the abstract, is downgraded to should_fix (F-22), because REV-05 asks for fewer numbers in the abstract.

**V3. REV-11: Partly (R0) or Addressed (R2, DA)?**
- **Check**: the 1.2 text is aims-only (l. 367-371). Fig. 1.1 renders between RQ1 and RQ2 (l. 375-397), and the round-1 minimum fix required moving it.
- **Resolution: Partly.** DA's own status rule ("met at the places it names") gives Partly, since DA lists the figure as not moved. The residual is should_fix (F-16).

**V4. REV-12: Addressed (R0) or Partly (R1, DA)?**
- **R0's W3** concerned the overclaim, which is fixed.
- **The round-1 minimum fix** also required "Count constructs, not causes, with an unclassified residual row".
- **Check**: l. 3362-3363 read "The lists below count causes, not constructs". They point to Tables 5.10 and 5.20 and to "2 of the 151 ... have no recorded reason".
- **Resolution: Partly.** The residual is should_fix (F-17).

**V5. REV-14: Addressed (R1) or Partly (R2)?**
- **Check**: l. 1136-1137, "The edges resting on A3 and A4 are not counted".
- **Expertise.** R2 owns soundness here. R2 notes that A4 cannot be counted statically, but A3 can be: the demotion pass already enumerates the code after each site.
- **Resolution: Partly.** Counting A3 is should_fix (F-20). If the count is 0, saying so strengthens the claim (R2).

**V6. REV-22.** R1 and R2 mark only their own sub-parts as addressed, and R0, R3 and DA list the remaining parts. This is not a conflict. **Resolution: Partly**, and the remaining parts form F-09.

**V7. REV-09 severity and the round-1 dispute D1: Major (R2) or Minor (R0)?**
- **R0** lowers it to Minor because the contribution is now reframed as secondary.
- **R2** keeps it Major, with confidence 5, on repository evidence. Rima et al.'s implementation at f33003f follows one call into an injected service whose class name matches `router|navigation`. That rule departs from the specification the thesis cites, and it is how their tool reaches the three airbus pairs.
- **Synthesizer check (repository):**
  - `~/personal/uigraph-work/rima/softscanner_fa` is at f33003f.
  - `logic-utils.ts:229` reads "F1: Bounded Router-service tracing", with the name test at l. 234.
  - `docs/paper/approach.md:199` says "do not follow calls to methods on injected services".
  - Their airbus output (`a1-multigraph.json`) cites `router.service.ts`.
  - I did not re-check R2's further claim that their tool places no service-file navigation on the six corpus applications.
- **Manuscript check**: the text never mentions this rule. The tension was visible in round 1, and R2's evidence turns it into a factual error in the Ch. 7 clause:
  - Table 5.18 (l. 3228) gives their tool 100.0 % on airbus;
  - p. 70 says their tool holds every reference pair by construction;
  - Ch. 7 still credits the step with "the transitions it adds over their rules on their own subjects" (l. 4351-4352).
- **Resolution: severity stays Major**, transported from the domain owner and resting on verified evidence. It is must_fix (F-01). **D1 is now settled**:
  - for Rima et al.'s subjects, the "contradict" reading (R0, R2, DA in round 1) is right;
  - for the corpus, the contribution survives as a generalisation of a name-bounded, one-level rule (R2).
- **Decision impact: bounded.** The fix is about six sentences, and the evidence is in hand. So the item blocks acceptance but does not raise the decision to Major Revision. The author should confirm the cited files before citing them.

**V8. Mutation denominators: inconsistent (R1 N10, DA N8(f)) or acceptably labelled (R0, R3)?**
- **Check**: l. 3610-3614 read "the denominator of the other three operators is 45, with rename excluded ... 45 of 45". The round-1 fix allowed "45/45 labelled 'rename excluded'".
- **Resolution: acceptable as labelled.** R1's separate point stands as a should_fix wording item (F-30): Table 7.1's "shares 46/73 mutants" overstates an overlap that is only of location.

**V9. Section 6.6 Summary: a defect (R0 N7, DA N8(c)) or "fine" (R1)?**
- This is a perspective difference on a two-sentence summary (l. 4178-4181).
- **Resolution: author's choice (consider).** Either summarise the chapter or drop the heading.

**V10. Abstract numbers: drop the width ratios and both precisions (R0 row 7), or keep them (round-1 REV-02 and REV-03 criteria, R1, DA)?**
- R0 suggests dropping 1657, 1.7/18.7 and 72.6/75.2 to reach about 250 words.
- But REV-02 required the width in the abstract's RQ3 sentence, and REV-03 required both precisions in place of "similar".
- **Disagreement type**: direction of remedy.
- **Resolution**: the anti-overclaim criteria outrank density. Keep the width and both precisions. Cut density elsewhere (F-15). R0's suggestion to drop 1657 is compatible with this.

---

## Part 2: New issues introduced by the revision (deduplicated)

**How to read the counts.** "Corroboration" counts the four non-DA seats (R0-R3) that raised the issue, out of 4; "+DA" marks a DA finding. Severity is each seat's own. "Origin" says whether the issue was introduced by the cut, newly made load-bearing, or pre-existing and first raised now. "Checked" marks issues I confirmed against the manuscript.

| ID | Issue | Raised by | Corroboration | Severity (per seat) | Origin | Checked | Resolving item |
|---|---|---|---|---|---|---|---|
| N-01 | "159 edges that always fire" states Claim 3.1 as fact. The cut dropped "125 from one toolbar whose screen set is untested" and the 62 unread destinations from the abstract. | R0 row 10, R1 N2, R2 N1, R3 N4, DA N1 | **4/4 +DA** | Minor (R1, R2 "must-fix", R3); Major (DA) | cut | yes, l. 40 | F-03 |
| N-02 | The abstract's 82.0 % lost the class-join comparator (92.3 %) and the caveat that the reference applies the analysis's own relations and was AI-built. | R0 N4, R1 N1, R3 (REV-06 residual), DA (REV-02) | **3/4 +DA** (R2 silent) | Major (R1); Minor (R0) | cut | yes, l. 47-48 | F-02 |
| N-03 | Author placeholders and to-do notes appear in the rendered text: two on p. 50, the Table 4.1 note and Table 6.1 p. 88. | R0 N1, R1 N3, R2 N4, R3 N1, DA N3 | **4/4 +DA** | Minor, must-fix (R0-R3); Major (DA) | new text | yes, l. 2200, 2202, 2254, 3968 | F-05 |
| N-04 | The abstract leads with the pooled 66.7 %, although 4.1.2 and Table 6.1 declare the per-application median (40.2 %) the primary summary. | R0 N5, R1 N5, R2 N7, R3 N3, DA (REV-16) | **4/4 +DA** | Minor | made visible by the new "primary summary" text | yes, l. 1773, l. 44 | F-08 |
| N-05 | Mis-pointed cross-references after the restructuring. 1.2 cites "(Section 2.6.2)" for the approximations list (all five seats). Others: p. 30 "(Section 5.5)" for the mutation sweep (R0, R1); A2 cites 3.2.3 (R2); 4.2 cites 5.3.6 for the tool comparison (R1). | R0 N6, R1 N11 + N8, R2 N3, R3 N6, DA N8(a) | **4/4 +DA** | Minor | cut | yes, l. 414 | F-11 |
| N-06 | The relation count is inconsistent: three in 3.2, "four" in 3.4, 6.4 and Ch. 7, and five if T counts as an input. | R0 N2, R2 N2, DA N4 | 2/4 +DA | Minor | REV-15 restructure | yes, l. 1271, 1668, 4088, 4348 | F-10 |
| N-07 | The 203 sensitivity figure has no results-chapter source. It is cited to "(Section 5.5)", which does not hold it. | R0 N6, R2 W1 note + N5 | 2/4 | Minor | new text | yes, 203 only at l. 41, 3665, 4207 | F-11 |
| N-08 | Cut damage to the flow (union of reports): | R0 N7, R2 N6, R3 N5 + minor, DA N8(b, c) | 4/4 +DA (the duplicate line alone: 3/4 +DA) | Minor | cut | yes, l. 1306, 2911, 3103, 4131 | F-12 |
| | • a duplicated Oshima-Kishi line (p. 70); | | | | | | |
| | • alfresco's "16 sites and 174 pairs" attached to realworld (p. 66); | | | | | | |
| | • "On it no application is without edges" (p. 31); | | | | | | |
| | • a broken sentence on p. 91; | | | | | | |
| | • a non sequitur on p. 82; | | | | | | |
| | • 6.1's "Two uses" out of order (p. 82); | | | | | | |
| | • 6.6 is two sentences (disputed by R1, see V9). | | | | | | |
| N-09 | The census behind the reframed RQ1 headline counts witness locations, not the construct unit of Tables 5.2 and 5.5. | DA N2 | 0/4 +DA | Major (DA) | pre-existing table, made load-bearing by the revision | yes: Table 5.1 bitwarden guard "Any" = 202 (l. 2397) > bitwarden "All constructs" = 131 (Table 5.5, l. 2555; Table 5.2) | F-04 |
| N-10 | Ch. 7 says "I confirmed 41 of the 41 I re-read", dropping the not-blind caveat that 5.3.8 states. | R1 N4, DA (REV-13) | 1/4 +DA | Minor | kept text, now inconsistent | yes, l. 4362-4363 | F-13 |
| N-11 | RQ1 and 6.1 call the small tier "a matter of definition rather than a defect of the extractor", while RQ5 assigns the same 1631 demotions to "the application". | DA N5 | 0/4 +DA | Minor | revision | yes, l. 3361-3362 | F-17 |
| N-12 | 6.1 attributes the small tier to "this fact" (guards on unfixed state), although all guards passing moves it only 159 → 203. | R2 N5 | 1/4 | Minor | revision | not checked | F-18 |
| N-13 | The may-reason census is the extractor's self-report but now carries the RQ1 explanation ("at most those to must"). | R1 N7 | 1/4 | Minor (conf. 3) | made load-bearing | not checked | F-18 |
| N-14 | 4.2 calls the structural references "references that do not come from the attribution's output alone", which reads as independence. 5.3.4 denies it. | R1 N8, DA N7 | 1/4 +DA | Minor | revision | yes, l. 1989 | F-19 |
| N-15 | In-sample labelling of the Rima subjects is inconsistent. 5.3.6 says "Every figure is in-sample except those for Rima et al.'s subjects", while 5.3.7 says the repaired head-to-head is not out-of-sample. Table 7.1's "close on their seven subjects" is unlabelled. | R1 N9, DA N6 (part) | 1/4 +DA | Minor | revision | yes, l. 3070 | F-19 |
| N-16 | The new chance baseline is applied only after the repairs. Before them, 12/22 was observed at about 1.7 expected by chance (28185/367236 × 22); after them, 19/22 at 9.7. | R3 N2, DA §3 | 1/4 +DA | Minor | new text | yes, l. 3013-3015 (arithmetic) | F-19 |
| N-17 | Ch. 7 leads with post-repair figures (69/73, 19/22) and brackets the frozen-extractor figures (68, 12). | DA N6 | 0/4 +DA | Minor | revision | yes, l. 4359-4360 | F-19 |
| N-18 | The head-to-head precision ranges were generated but are not printed, and the mifos stratum sizes are still missing. | R1 N6, W3 | 1/4 | Minor | residual + repository evidence (`generated-h2h.tex`) | not checked (repository) | F-14 |
| N-19 | Table 7.1 says the final sample "shares 46/73 mutants" with the tuned run, but 4.3.2 says they share only a location. | R1 N10 | 1/4 | Minor | revision | yes, l. 4292 | F-30 |
| N-20 | The abstract lost "under the order of the loss rules". The ranking flips on two applications (5.2). | R0 N3 | 1/4 | Minor | cut | not checked | F-15 |
| N-21 | "Open" names two different things: the 5.5.1 heading and the three-part RQ5 answer. | R0 N8 | 1/4 | Minor | revision | not checked | F-17 |
| N-22 | 6.1 offers CI checking "at no execution cost", while 5.4 limits mutation testing because each mutant needs re-extraction. | R3 N5 | 1/4 | Minor | revision | yes, l. 3645-3646 | F-23 |
| N-23 | The abstract's "adds 2.0 % of the sites" counts guard and effect stand-ins as well as services. | R1 N11 | 1/4 | Minor | revision | not checked | F-30 |
| N-24 | The current AI-use pages contain statements that no longer hold: "drawn by hand" and a "separate block" of unchecked sources (R3); a stale pointer to "demotion rules of Section 5.5" (R0). | R0 row 5, R3 REV-10 note | 2/4 | (within REV-10) | unchanged text, newly wrong | not checked (repository) | F-06 |
| N-25 | The p. 16 positioning sentence ("excludes router-outlet modelling") conflicts with Fig. 3.1 labelling outlet descent as Rima et al.'s. | R0 N9 | 1/4 | Minor (conf. 3; defers to R2) | pre-existing, first raised now | not checked | F-30 |

**Summary.** There are 25 deduplicated new issues. By the seats' own severities, four carry a Major rating (N-01, N-02, N-03 and N-09) and the rest are Minor. Each of the four is rated Major by one seat only (DA for N-01, N-03 and N-09; R1 for N-02). The other seats that raised N-01 to N-03 rate them Minor, and only the DA raised N-09.

---

## Part 3: Devil's Advocate CRITICAL adjudication

`da_critical_adjudications: []`. The round-2 DA report raises no CRITICAL item: its CRITICAL table is empty. So no CRITICAL item blocks Accept on its own, and none was rejected.

**Status of the round-1 CRITICAL items** (both VALIDATED in round 1):

- **C2 (the RQ1 headline is a function of the demotion policy): RESOLVED.**
  - **Corroboration**: DA, R0, R1 and R3 mark REV-01 addressed. R2's Partly concerns the regressions tracked as N-01 and N-07 (V1).
  - **Check**: l. 40-43 and l. 2425-2428 ("largely a matter of definition"; "the census says the application decides, not that the navigation is conditional at run time").
  - **Required author response**: none beyond N-01, N-07 and N-09.
- **C1 (the RQ3 criterion is met by a trivial rival): PARTLY RESOLVED.**
  - **Body**: the monotone rule is gone ("RQ3 is not decided by one rule", p. 46). The width ratio is in the abstract. The reversal (82.0 % against 92.3 %) is in Table 7.1.
  - **Abstract**: it gives 82.0 % with neither the comparator nor the self-reference caveat. Corroborated by R1 N1, R0 N4 and DA REV-02.
  - **Effect**: blocks acceptance until done; the fix is one clause. **Required response**: F-02.

**The DA's new MAJOR items** (adjudicated for visibility; they are not CRITICAL):

- **N1 ("always fire"): VALIDATED.** All four scoring seats corroborate it (N-01). Fix: F-03.
- **N2 (census unit): VALIDATED on manuscript evidence.**
  - No scoring seat raised it.
  - Table 5.1 gives bitwarden 202 constructs with a guard reason. Table 5.5 and Table 5.2 give bitwarden 131 constructs in all. So the "constructs" of the census and of the outcome tables cannot be the same unit.
  - I did not re-derive DA's second check (about 1457 may-only constructs). DA's view that the 98 % share "probably survives a re-count" is unverified.
  - Fix: F-04.
- **N3 (placeholders): VALIDATED.** All four scoring seats corroborate it (N-03). Fix: F-05.

**DA's strongest remaining argument**: "every check that looked external was spent as a repair driver, and Chapter 7 leads with the figures produced after the repairs".
- **Partly corroborated** by R3 N2 (the pre-repair chance baseline).
- **The DA's own limit**: "None of this overturns the conclusion as it now stands".
- **Treatment**: should_fix (F-19). The frozen figures 68/73 and 12/22 are already in the text, so this is about which figures lead, not about missing evidence.

---

## Decision rationale

**The recommendations.** All four scoring seats moved from Major to Minor Revision, each at confidence 4, and the DA's line reads Minor Revision. Under the decision matrix, four Minor Revision recommendations give Minor Revision. No outlier recommendation needs arbitration.

**What the revision fixed.** The round-1 decision rested on the gap between evidence and claim. Each of the six named overclaims is now fixed in the body, and the post hoc Rima label is in place:
- "mostly" → "largely a matter of definition", with the sensitivity figures;
- the RQ3 rule that could not fail is gone;
- the post hoc Rima subgroup is labelled, with "does not rank the tools";
- RQ4 is a sanity check;
- RQ5 is answered in three parts;
- "usable" is gone;
- the contribution is reframed, with the measurement first.

R0 and R1 spot-checked the numbers and found them consistent across the abstract, Ch. 5 and Table 7.1.

**Why not Accept.** Three blockers remain (B1-B3):
- The text is unfinished: placeholders and the AI-use statement.
- One claim is now known to be false of the tool the thesis ran: the Ch. 7 services clause (V7).
- The abstract regressed at four points while it was being shortened.

**Why not Major Revision.** The one item a seat still rates Major after full assessment, R2-W5, is a text fix with the evidence supplied. DA's census-unit item can be closed by relabelling the unit. The remaining residuals do not change the core design or require new data.

**Length.** This is the largest remaining task. It is mechanical, and the supervisor can waive the ≤ about 80-page target.

**What the decision does not lift.** The independence ceiling (X-01 to X-03) remains. As in round 1, it caps how strong the soundness and scope-accuracy claims can be, and the projected grade. It is not a submission condition.

---

## The supervisor's 4 Nov requests (status now)

| Request | Round 1 | Now | Seat evidence | Item |
|---|---|---|---|---|
| Shorten considerably | Not met | **Partly met** (108 → 89 body pp.; total 124 → 117; about 12 pp. relocated, not deleted) | R0 row 1, DA REV-04, R3 REV-04 | F-07 |
| Readability | Partly | Partly. Sentence length and cross-reference density are unchanged (R0 rows 15-16). | R0 | F-15, F-29 |
| One-page abstract | Page met | Page met; readability partly (about 360-377 words, 16 numerals, 4 regressions) | all five seats | F-02, F-03, F-04, F-08, F-15 |
| Precise AI-use statement | Partly | **Not met** (deferred by design) | all five seats | F-06 |
| Abbreviations | Partly | **Met** | R0, R3, DA | — |
| 1.2 aims only | Not met | Text met; Fig. 1.1 still inside 1.2 | R0, R2, DA | F-16 |
| Figure and table fixes | Partly | Partly. Names and float placement are not fixed. | R0, R3, DA | F-09 |

---

## Part 4: Remaining roadmap, by severity

**How this list is built.**
- **Order**: severity is the highest any seat reported for the driving finding. Within a tier, items are ordered by corroboration count.
- **Obligation**: `must_fix` is required before submission; `should_fix` is advised and affects the grade; `consider` is optional.
- **Minimum fix**: the least change that closes the finding, as the seats state it.
- **F-numbers** are transport references, not a work order.

### Major: must_fix

| ID | Issue | Source (severity) | Location | Minimum fix (acceptance criterion) |
|---|---|---|---|---|
| F-01 | The services novelty is contradicted by Rima et al.'s implementation (REV-09; B2) | R2 W5 (Major, conf. 5); R0 row 9 (Minor); R1 W11; R3; DA | 2.4 p. 16; 5.3.6 p. 70 (l. 3087); 5.3.7 pp. 71-72 (l. 3165, 3191); Fig. 3.1 p. 36; Table 7.1 p. 94; Ch. 7 p. 96 (l. 4351-4352); abstract "its one new step" | (1) Delete "and accounts for the transitions it adds over their rules on their own subjects". (2) In 2.4 and 5.3.7, state that their implementation at f33003f follows one call into a service whose class name matches router/navigation (rule F1, contrary to their specification), and that this is how it holds the 3 airbus pairs. (3) Restate "no earlier mechanism can place", "only this thesis adds" and "only it places navigation inside services" as a type-directed, transitive service join that generalises that one-level, name-matched rule. Say on the corpus their tool places none from a service, if the author confirms it. (4) At l. 3191, say "three non-reference pairs" (R2 Part 3). *Accepted when* no sentence credits the service step with transitions over Rima et al.'s tool on their subjects. |
| F-02 | The abstract's RQ3 precision has no comparator or caveat (N-02; REV-02; C1 residual) | R1 N1 (Major); R0 N4; R3; DA | Abstract l. 47-48 | One clause: "against an AI-built reference that applies the analysis's own relations, 82.0 % (the per-class join: 92.3 %)". *Accepted when* the abstract's RQ3 sentence shows the reversal and the self-reference. |
| F-03 | "159 edges that always fire" (N-01) | DA N1 (Major); R1 N2, R2 N1, R3 N4 (Minor); R0 | Abstract l. 40 | Write "159 edges classified as always firing (must), 125 of them from one toolbar whose scope is untested". Optionally add "under stated assumptions". |
| F-04 | The census unit is mislabelled as "constructs" (N-09) | DA N2 (Major) | Abstract l. 42; 5.1 l. 2385; Table 5.1; 5.5.1 l. 3362; Table 7.1 RQ1/RQ5 | Either rename the unit "witness locations" wherever 1631/1657 is quoted, or re-key the census on Table 5.5's construct identity and re-run it on existing data. *Accepted when* no count in the abstract uses a unit other than Table 5.5's construct. |
| F-05 | Author placeholders and to-do notes (N-03; also closes REV-13 and REV-18) | DA N3 (Major); R0 N1, R1 N3, R2 N4, R3 N1 (Minor, must-fix) | l. 2200, 2202 (p. 50); l. 2254 (p. 52); l. 3968 (p. 88) | Give the repository URL, archived release or DOI, and evaluated commit. State Rima et al.'s licence status (R3 reports `PREREGISTRATION.txt:27`: "no licence"). Remove "confirm at the pinned commits". State whether the proposing tool was shown during the 41 re-reads. *Accepted when* a search of the sources for `[author:` and "confirm" finds nothing. |
| F-06 | AI-use statement (REV-10; N-24) | R0 W5 (Major), R3 W10 (Major); all seats note it | pp. 2-3 | The round-1 REV-10 minimum: a table of activity / tool, model, version and dates / chapters affected / human check. Name the "stronger model" (pp. 70, 72, 74). State the extent of prose drafting, and whether third-party source was sent to a hosted model. Also: correct "drawn by hand" and the "separate block" sentence (R3); fix the "Section 5.5" pointer (R0); cover the AI-built alfresco reference (R3). |
| F-07 | Length (REV-04) | Round-1 Major (R0 W1); all seats Partly | Body pp. 8-96 | Either get written supervisor confirmation that 89 body pp. is acceptable, or cut about 9 pp.: Table 7.1 to its Answer column (about 2 pp., R0); Table 6.1's mitigated threats to an appendix or compressed (about 3-5 pp., R0, R3, DA); fix float placement (about 2 pp., R0); delete 6.1's restatement of RQ4 (R0); drop Fig. 5.2 (DA); cut the peripheral Ch. 2 paragraphs (about 1 p., R2); remove the model-only lines of Algorithm 1 (about 1.5 pp., R2; overlaps F-21). |

### Minor: must_fix

| ID | Issue | Source | Location | Minimum fix |
|---|---|---|---|---|
| F-08 | Median first in the abstract (N-04; REV-16) | R0 N5, R1 N5, R2 N7, R3 N3, DA | Abstract l. 44; 5.5.1 | "a median of 40.2 % per application (66.7 % pooled, mostly one application)". Otherwise, drop the "primary summary" wording from 4.1.2 and Table 6.1. |
| F-09 | Figure and table names, and float placement (REV-22; a supervisor request) | R0 row 11, R3 REV-22, DA REV-22 | Fig. 1.1 (l. 392); Fig. 4.2 note; Table 4.4; Table 5.1 "kdash"; Tables 4.1-4.3; Algorithm 1; Table 6.1 header p. 82 | One name per method ("runtime route oracle", "independent route parser") and per application. Place floats near their first reference. No orphaned table header. |
| F-10 | Relation count (N-06) | R0 N2, R2 N2, DA N4 | 3.2 l. 1271; 3.4 l. 1668; 6.4 l. 4088; Ch. 7 l. 4348 | Use the 3.2 wording everywhere: three implemented relations, with D and T as extensions. |
| F-11 | Cross-references, and the 203 source (N-05, N-07) | all five seats (1.2 ref); R0, R2 (203) | l. 414; p. 30; A2 p. 28; 4.2 p. 46; l. 3665 | Point 1.2 to 6.3 and Appendix B, p. 30 to Table A.1, A2 to 3.3, and 4.2 to 5.3.8. Report 203 (44 guarded edges) and 33 in 5.1 beside Table 5.1. |
| F-12 | Cut damage (N-08) | R0 N7, R2 N6, R3 N5, DA N8 | l. 1306, 2911, 3103, 4131; p. 82 | Repair the listed sentences in one read-through. Move "Neither use was tried by a consumer" after both uses. |
| F-13 | "I confirmed 41 of the 41" (N-10) | R1 N4, DA | Ch. 7 l. 4362-4363 | Write "agreed with 41 of the 41 I re-read, with the model's verdict in view". |
| F-14 | Mifos stratum sizes and precision ranges (REV-03 residual; N-18) | R1 W3, N6 (on R1's must-fix list) | 5.3.8; Table 5.18; Table 7.1 | Give the stratum sizes behind 6.5 % and 80.0 %. Print the generated Wilson-end ranges for 72.6 % and 75.2 % and for the 1512/163 estimates. R1 reports the ranges from `generated-h2h.tex`; the author should confirm them. |

### should_fix

| ID | Issue | Source | Minimum fix |
|---|---|---|---|
| F-15 | Abstract density (REV-05; N-20) | R0 row 7, R1 m1, R2 C1, R3, DA | Move towards about 250 words. Drop numbers that carry no claim (e.g. 1657). Keep the width and both precisions (V10). Restore "under the order of the loss rules" (R0 N3). |
| F-16 | Fig. 1.1 inside 1.2 (REV-11) | R0 row 4, DA | Place it after 1.3 or in Ch. 4. |
| F-17 | RQ5 counting and labels (REV-12; N-11; N-21) | R1 W7, DA REV-12 + N5, R0 N8 | Give construct counts per outcome with an unclassified residual row. Rename the 5.5.1 heading "Still not read by the final version". Say the application's share is so "under the definition of must". |
| F-18 | RQ1 explanation wording (N-12, N-13) | R2 N5, R1 N7 | In 6.1 replace "this fact" with "the definition of must". Write "as the extractor records them" and drop "at most" (5.1). |
| F-19 | Independence and in-sample wording; which figures lead (N-14 to N-17) | R1 N8, N9; R3 N2; DA N6, N7, §3 | 4.2: say only the alfresco reference is built without the graph. 5.3.6: drop "except those for Rima et al.'s subjects", or limit it to the first comparison. Label Table 7.1's "close on their seven subjects" in-sample. Give about 1.7 by chance beside 12/22. Lead Ch. 7 with the frozen 68/73 and 12/22. |
| F-20 | A3 uncounted (REV-14) | R2 W2r | Report how many of the 159 must edges have an unresolved call after the site (0 if none). |
| F-21 | Model-only residue in Ch. 3 (REV-15) | R2 W4r, DA | Drop lines 9-14 and the D and T terms from Algorithm 1. Mark the canDeactivate and interceptor rows of Table 3.3 model-only. Fold 3.2.4-3.2.5 into 3.2.7. |
| F-22 | REV-08 residual | R2 W6r, R3 REV-08 | Name the 39.4 % site in the Ch. 7 prose. Add one sentence that both headline costs come from one target policy family. Putting it in the abstract is optional (V2). |
| F-23 | Runtime cost and "at no execution cost" (REV-19; N-22) | R3 W5, N5 | Report wall-clock time and peak memory per application, or replace the phrase with "without running the application". |
| F-24 | Single-source-tree scope (REV-20) | R3 | One sentence in the abstract limits or 6.2: the figures are for single-application source trees, and a library shell is not followed. |
| F-25 | Ethics (REV-25) | R3, DA | One sentence on notifying Rima et al. Qualify 10.2 % as measured on constructs outside their tool's stated design. |
| F-26 | `unknown` wording (REV-26) | R2 W7r | Delete "or a navigation target" from Def. 3.1, or delete the "carries" clause. In 2.6.1 write "inspired by". |
| F-27 | UrlTree redirect edges (REV-27) | R2 W10 | Add one clause to the Ch. 7 open items and the abstract limits. |
| F-28 | Provenance (REV-24) | R1 W10, DA | Record the measured graph's digest, or re-run the oracle. Write "committed before scoring" on p. 45. |
| F-29 | Sentence length and cross-reference density (round-1 minors) | R0 rows 15-16 | Split sentences over 40 words in Ch. 5-6 and cut per-paragraph "Section n" references. R0 names readability as the first grade-limiting factor. |
| F-30 | Small wording items (N-19, N-23, N-25 and nits) | R1 N10, N11; R0 N9, row 6; R3; DA | "at the same location" for 46/73. Say "service, guard or effect" for the 2.0 %. Fix the p. 16 router-outlet sentence (defer to R2). Remove "as change impact analysis requires" from RQ4 (p. 11). Define F1 in Table 2.1. Fix the Fig. 5.2 axis and legend. Move the Availability paragraph to 4.3.3. |

### consider

| ID | Issue | Source | Minimum fix |
|---|---|---|---|
| F-31 | Remaining "consider" items: REV-28 (dependencies), REV-29 (Android sentence), 6.6 Summary (V9) | R2 W9, W8; R0 N7, DA, R1 | State the dependency effect as unmeasured and link it to A3. Narrow the Android sentence to ProMal [45] or re-check [77] and [78]. Make 6.6 summarise the chapter or drop it. |

**Extensions X-01 to X-09 are unchanged and optional.** They are the route to grade 5 (see the grade section). X-08 has in effect been done by R2 in the repository. The author can use that evidence for F-01 after checking it.

---

## Response instructions

Answer F-01 to F-31 in a table with these columns: ID / action (done; declined with reason; not on point) / where it changed (section, page). For a declined must-fix item, give the reason. The panel records a decline as unresolved, not as accepted.

Mark changes to the abstract, 2.4, 5.1, 5.3.6-5.3.8, 6.1, Table 7.1 and Ch. 7. The targeted check should then read those places against F-01 to F-14, together with the rendered PDF pages that hold figures and floats.

## Closing

The revision did the hard part. The claims now match the evidence on every point that drove the round-1 decision, and the thesis states its own limits plainly.

What is left is a finishing pass:
- remove the notes to the author;
- write the AI-use statement;
- narrow one novelty sentence that the rival tool's code contradicts;
- undo four abstract regressions from the cut;
- make the final cut to length, or have the supervisor confirm 89 pages.

None needs new data, and none needs another full panel.

---

## Appendix: seat summaries (round 2)

- **R0 (Journal-Fit / examiner)**: Minor; confidence 4. The six round-1 overclaims are fixed; the revision is "a few days of editing, not another revision cycle". The residuals are 9 pp. over the target, abstract numbers, the Ch. 7 services sentence, figure names and floats, placeholders and the AI statement. Grade signal: about 4 (3-4) after the residuals.
- **R1 (Methodology)**: Minor; confidence 4. The RQ3 rule is gone, RQ4 is a sanity check, the post hoc group is labelled, and blinding and change rates are reported. The cut removed the abstract's caveats on 82.0 % and "always fire". The independence ceiling remains but is stated.
- **R2 (Domain)**: Minor; confidence 4 (5 on W5). The definitional, lower-bound and design-intent framing is fixed. One Major item is left: repository evidence shows Rima et al.'s implementation follows router-named services (F1) and so reaches the airbus pairs. R2 corrects its own round-1 W5(iv) and its W6 attribution of the 6.5 %.
- **R3 (Practical)**: Minor; confidence 4. "Usable" is gone and the tiers are separated for consumers. Open: runtime cost, URL/DOI, the single-source-tree scope, notification, and the pre-repair chance baseline.
- **DA**: Minor (its line). No CRITICAL item; MAJOR items N1 ("always fire"), N2 (census unit) and N3 (placeholders). Round-1 C2 is resolved and C1 is reduced to an abstract clause. Remaining counter-argument: external checks were spent as repair drivers, and Ch. 7 leads with post-repair figures.

## Attachment: Suggested-Reference Check (advisory, #1001)

Not run in this simplified re-review. R3 suggests no new references in round 2 (`suggested-references: []`).

## Attachment: Reviewer Claim Check (advisory, #1002)

Not run. The synthesizer's manuscript checks are recorded inline (V1-V10 and the "Checked" column of Part 2).

## Attachment: Acronym Check (advisory, #849)

Not run in this round. R0 and R3 found no undefined abbreviation in the body, apart from F1 in Table 2.1.
