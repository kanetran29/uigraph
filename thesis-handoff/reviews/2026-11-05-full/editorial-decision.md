# Editorial Decision and Revision Roadmap

**Manuscript**: "Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications", D. K. Tran. Aalto University MSc thesis (Computer Science, supervisor Prof. Petri Vuorimaa). Draft of 5 Nov 2026: 124 pp., body pp. 8-115.
**Review round**: 1. **Decision date**: 5 Nov 2026. **Mode**: full five-seat panel, single-call seats, no sprint contract.
**Calibration status**: `NOT_CALIBRATED`

## Run notes

- **Checkers not run.** The sprint-contract conformance checker and the panel-synthesis checker were not run. No Schema 6/13 or `revision-roadmap/1.0` machine artifacts were produced, because this run used single-call seats. The letter and roadmap below are prose and tables only.
- **No cross-model decision check.** None was configured, so the decision is single-model.
- **Roadmap order.** The workflow asked for severity order, which departs from the template's source-order rule. The order ranks severity only. It is not a work plan.
- **Verification.** I checked every decision-bearing claim against `manuscript.txt`. Page numbers are the printed ones. Where my check changed or qualified a seat's claim, I say so.

---

## Review panel provenance

There is no typed `review-panel-provenance/1.0` artifact for this run. The values below come from the workflow's description and were not machine-verified. Where the seat reports themselves say otherwise, the report wins.

| Seat | Role | Actor | Context | Peer outputs visible before committing | Model family | Human reviewer |
|---|---|---|---|---|---|---|
| R0 | Journal-Fit / examiner (EIC card) | AI | fresh, single call | no | Claude (Sonnet) | none |
| R1 | Methodology | AI | fresh, single call | no | Claude (Sonnet) | none |
| R2 | Domain (static analysis) | AI | fresh, single call | no | Claude (Sonnet) | none |
| R3 | Cross-disciplinary / practical | AI | fresh, single call | no | Claude (Sonnet) | none |
| DA | Devil's Advocate (fixed) | AI | fresh, single call | no | Claude (Sonnet) | none |
| Synthesizer | Editorial synthesis | AI | separate context; reads all five reports | yes (by design) | Claude (Opus) | none |

| Provenance axis | Status |
|---|---|
| Role-separated | true |
| Context separation within the panel | true (as reported by the workflow) |
| Blind to peer outputs | true (as reported by the workflow) |
| Model-family distinct | **false**: one family (Claude) |
| Provider distinct | false |
| Human-reviewer distinct | false: no human reviewer |

- **Inputs.** Each seat was configured to read only the manuscript and its own card. By their own accounts, R0 and DA read only the manuscript. R1 (W3: the repository deviation record, stratum sizes 7/4/5), R2 (W5: `rima/STUDENT-READING.md`) and R3 (W6: `rima/PREREGISTRATION.txt`) also opened repository files. Findings that rest only on those files are marked "repository evidence, not verified against the manuscript" where they matter.
- **Correlated errors.** All five seats and the synthesizer are models of one family, so their errors may be correlated. Agreement across seats is therefore not independent confirmation. It is a further reason to have one non-author human check the decision-bearing claims (see the grade section).
- **Independence.** No binary independence claim is made.
- **Accountable human.** The author, who approved the five reviewer cards (`cards.md`, 5 Nov 2026).

---

## Decision: **Major Revision**

In thesis terms, the draft should not be submitted for grading as it stands. The required revision is mostly to text and claims, plus a small amount of re-analysis on data already collected. No seat found a fatal flaw. As a minimum, no seat asks for a new experiment: R0 says the repairs need "no new experiments", and R2 says "None needs new large experiments".

## Expected grade band (Aalto 1-5)

This is the synthesizer's projection. It is not computed or calibrated, and the supervisor and examiner set the grade. The only seat asked to give a grade signal, R0, put the work "around 3-4 if the repairs are made" and named readability as "the first grade-limiting factor".

| State | Expected band | Reasons (seat evidence) |
|---|---|---|
| **As submitted** | **3** (range 2-3) | **For:** the substance is at or above master's level. It has an original construct-level loss accounting (R0 Originality), a preregistered out-of-sample comparison that runs a third-party tool (R0 S3, R3 S3), and validity disclosure "above the usual master's standard" (R0 S1, R1 S1, R2 S1-S5, DA strengths). **Against:** the supervisor's main requests are unmet (R0 W1 and W4 DOES_NOT_MEET; DA M10, M11). Five abstract claims say more than Ch. 5 supports (REV-01, 02, 03, 09, 12). At 108 body pages, an examiner must reconcile figures across 6-7 restatements (R0 W1). The low end, 2, applies if the examiner weights presentation and non-compliance heavily. |
| **After all must-fix items** | **4** (range 3-4) | The claims are recalibrated to match Ch. 5. The conclusion is already calibrated (R0 S4, R1 S6). The text is cut to a readable length. The evaluation depth is "closer to a doctoral chapter" (R0 Journal Fit). |
| **What separates 4 from 5** | 5 is not supported by the present evidence | Every check of the headline results passes through the author or the same AI assistant. This covers the must tier (R1 W5), the pair readings (R1 W4, DA M6), and the scope references, one completed from the graph's output (R1 W1, DA C1). Table 6.1 itself records "No blinding, no second annotator". Doing should-fix items X-01 to X-03 on top of a concise text would remove that ceiling. |

## Blocking issues (3)

Every must-fix item in the roadmap is a condition for a positive outcome. The three below are the ones that would stop the thesis from being submitted at all.

| Ref | Blocking issue | Source seats | Evidence anchor | Resolving item |
|---|---|---|---|---|
| B1 | RQ1 headline: "almost no navigation ... mostly because the applications' own guards and branches decide it" rests largely on the definition of must and on demotion policy | DA C2; R0 W10; R2 W1; R1 W5 | text: p. 1 "mostly because the applications' own guards and branches decide it"; p. 66 "a guard that always lets the navigation through still counts as a guard" | REV-01 |
| B2 | RQ3 is answered by a criterion that cannot discriminate scope attribution from a trivial or over-wide assignment, and scope accuracy is tested only against references that apply the analysis's own relations | DA C1; R1 W1 | text: p. 50 "RQ3 is answered positively only if the recovered share and must conversion"; p. 75 "Nothing shows them to be right either" | REV-02 |
| B3 | The supervisor's 4 Nov requests are unmet: length, aims-only 1.2, abstract readability, precise AI-use statement | R0 W1, W4, W5, W7; R3 W8, W9, W10; R2 W4, W11; DA M10, M11, m1 | text: p. 10 "This section states what each asks and how it is answered."; absence: pp. 2-3, no tool, model or version named | REV-04, REV-05, REV-10, REV-11 |

---

## Reviewer summary

| Seat | Recommendation | Confidence (self-reported scope, not a weight) | Key point |
|---|---|---|---|
| R0 Journal-Fit / examiner | Major Revision | 4 | Sound and honest work, but not examinable at its length, and three abstract and Ch. 7 claims exceed Ch. 5 |
| R1 Methodology | Major Revision | 4 | Headline claims rest on instruments that cannot fail or are not independent of the author, the tool or the assistant |
| R2 Domain | Major Revision | 4 | Must/may readings partly follow from definitions. The formal analysis is not the evaluated one. The services novelty is thinly evidenced. |
| R3 Practical | Major Revision | 4 | The named consumers are untested. Over-approximation cost, runtime cost and artifact availability are not made actionable. |
| DA | Findings only (its own line reads "major revision") | per-finding | 2 CRITICAL, 11 MAJOR, 5 MINOR. Strongest counter-argument: a "well-documented engineering log of one tool" in which "the answer key moves with the tool" |

Under the decision matrix, four Major Revision recommendations give **Major Revision**. No seat recommends Accept, Minor Revision or Reject.

### Shared strengths (for the author to keep through the cut)

- Exceptional disclosure: the correction ledger, in-sample status and failed predictions are all reported. All five seats note this: R0 S1, R1 S1/S3, R2 S1/S5, R3 S1, DA strengths.
- The independent runtime route oracle (R1 S2, R2 S4, DA).
- Running Rima et al.'s actual tool on 13 applications (R0 S3, R3 S3).
- The calibrated closing sentence, p. 115 (R0 S4, R1 S6).
- Generated tables and pinned commits (R1 S5, R3 S6).
- RQ-to-measure mapping in Table 4.2 (R0 S2).
- Separating true, computed and reference scope (R2 S2).

---

## Consensus analysis

The denominator is the four non-DA seats. "Silent" means the seat did not address the point. It is neither agreement nor opposition. DA findings are listed separately and do not count toward consensus.

| # | Sub-claim | R0 | R1 | R2 | R3 | Agree /4 | DA | Disposition | Item |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Length and repetition do not meet "shorten considerably" | W1 | minor (Tab. 4.5, 6.2) | W4, W11 | W8 | 4 | M11 | CONSENSUS-4 (cut target disputed, D3) | REV-04 |
| 2 | Abstract is too dense, mixes units, leaves terms undefined | W7 | minor | comment | W9 | 4 | M10 | CONSENSUS-4 (severity differs, D4) | REV-05 |
| 3 | The Rima headline (94.1 % vs 10.2 %) is a post hoc subgroup and is not labelled as one in the abstract or Ch. 7 | W8 | W3 | comment 5.3.8 | criterion row "scope claims" | 4 | M1 | CONSENSUS-4 | REV-03 |
| 4 | Figure and table naming, denominators and placement | W11 | minor (Tab. 5.4, 5.18) | comment (Fig. 3.1) | W12 | 4 | m3 | CONSENSUS-4 | REV-22 |
| 5 | RQ1 must-tier headline needs qualification (definitional, fitted, small, one toolbar) | W10 | W5 | W1 | W4 | 4 | C2 | CONSENSUS-4 on existence; remedy depth differs (D5) | REV-01 |
| 6 | Title and abstract foreground scope attribution, while most recovery comes from earlier mechanisms | W2 | silent | summary (c) | W3 | 3 | M2/M3 related | CONSENSUS-3 (R1 silent) | REV-06 |
| 7 | RQ4 mutation result cannot fail | W6 | W6 | silent | Practical Impact | 3 | M4 | CONSENSUS-3 (R2 silent) | REV-07 |
| 8 | One fan-out policy drives 39.4 % of edges, mifos precision and e2e density | silent | W2 (one site) | W6 | W2 | 3 | - | CONSENSUS-3 (R0 silent) | REV-08 |
| 9 | "No earlier work places navigation inside services" conflicts with the airbus evidence | W9 | W11 (reads airbus as support) | W5 | silent | 2 vs 1 | M2 | **SPLIT** (D1) | REV-09 |
| 10 | RQ5 "the loss was the tool's" overclaims | W3 | W7 | silent | silent | 2 | M5 | corroborated | REV-12 |
| 11 | The AI-use statement names no tool or version and is imprecise | W5 | silent | silent | W10 | 2 | m1 | corroborated (severity differs, D4) | REV-10 |
| 12 | Section 1.2 is not aims-only | W4 | silent | comment | silent | 2 | M10 | corroborated | REV-11 |
| 13 | LLM-as-annotator validity (validity: R1; traceability of model readings: R0, R3) | W5 (identity) | W4 | silent | W10 (which results) | 1 validity + 2 traceability | M6 | single-reviewer on validity, corroborated on traceability | REV-13 |
| 14 | Must "lower bound" and may "upper bound" are stated more strongly than the rules deliver | silent | W5 (check cannot detect) | W2, W3 | silent | 2 | - | corroborated | REV-14 |
| 15 | e2e containment has no chance baseline | silent | W9 | W6 | silent | 2 | - | corroborated | REV-08 |
| 16 | Artifact availability, licences and provenance gaps | silent | W10 | silent | W6 | 2 | m4, m5 | corroborated | REV-18, REV-24 |
| 17 | "Usable" claim and untested consumers | S4 (calibrated) | S6 (calibrated) | silent | W1, W4 | 1 vs 2 | M9 | **SPLIT** (D2) | REV-17 |
| 18 | RQ3 criterion does not discriminate; scope accuracy untested | silent | W1 | silent | silent | 1 | C1 | single-reviewer + DA CRITICAL (validated) | REV-02 |
| 19 | Formal least-fixpoint model is not the evaluated pass | silent | silent | W4 | silent | 1 | M3 | single-reviewer + DA | REV-15 |
| 20 | Pooled figures are mostly mifos | silent | W8 | silent | silent | 1 | M8 | single-reviewer + DA | REV-16 |
| 21 | Relative recall over a union; clustered sampling unit | silent | W2 | silent | silent | 1 | M1 | single-reviewer + DA | REV-03 |
| 22 | Runtime cost not reported | silent | silent | silent | W5 | 1 | - | single-reviewer | REV-19 |
| 23 | Workspace-library layouts not a headline limit | silent | silent | silent | W7 | 1 | - | single-reviewer | REV-20 |
| 24 | Abbreviations incomplete | minor | silent | silent | W12 | 2 | m2 | corroborated | REV-23 |
| 25 | Ethics: licence, notification, right of reply | silent | silent | silent | W11 | 1 | m5 | single-reviewer + DA | REV-25 |
| 26 | Node "complete" only against the static readers | silent | silent | silent | silent | 0 | M7 | DA only | REV-21 |
| 27 | MTS order and the `unknown` modality; UrlTree redirects; dependencies not installed; Android literature | silent | silent | W7, W10, W9, W8 | silent | 1 each | - | single-reviewer | REV-26 to REV-29 |

---

## Points of disagreement and arbitration

**D1. Do the three airbus pairs support or contradict "only it places navigation inside services"?** (row 9)
- **R0 W9, R2 W5, DA M2: contradict.** The 3 pairs separating outlet from full are on airbus, "where the navigation runs inside an injected router service". Rima et al.'s reference "was generated from their tool's output, so their tool holds every pair by construction" (p. 82), so their tool already produces those pairs.
- **R1 W11: support, in one application.** R1 reads the airbus step as evidence for the claim, while warning against generalising from it.
- **Disagreement type**: existence.
- **Manuscript evidence**:
  - Table 5.18 (p. 83): airbus has 3 reference pairs, held only at full.
  - Table 5.19 (p. 85): Rima et al.'s tool has 100.0 % relative recall on airbus.
  - p. 82: the reference is their tool's output.
  - The thesis does not explain how their tool reaches those pairs. It may do so by another mechanism, since reference pairs are workflow start and terminal pairs. So the run does not demonstrate support, and it does not prove contradiction either.
  - R2 adds that the repaired graph "loses the three airbus pairs from the sign-in screen" (p. 83). The arithmetic does not clearly support this: held pairs go 68 to 69/73 with one named gain (Table 4.5; p. 83), which is hard to square with losing three held reference pairs. DA M2 flags the same ambiguity. The text does not settle which three pairs were lost.
- **Editor's resolution: unresolved on the manuscript.** R1's "supports" reading is not established. The R0, R2 and DA concern stands as a required explanation.
- **Required (REV-09)**: state the novelty claim relative to the published specification as read; explain how their tool holds the airbus pairs; state which pairs the repair removed. Ch. 7 must not say the service join "accounts for the transitions it adds over their rules" (p. 114) until this is shown.

**D2. Is "a declared route table is a usable ... basis" supported?** (row 17)
- **R0 S4 and R1 S6: calibrated.** R1 calls it "narrower than the numbers could be made to support".
- **R3 W1 and W4, DA M9: unsupported.** No consumer is exercised, and the trustworthy tier is 25 constructs.
- **Disagreement type**: perspective.
- **Manuscript evidence**: the sentence is about a basis "for static navigation extraction" (p. 1; p. 115 "usable starting point"), not about consumer usefulness. Ch. 7 states that consumer benefit "is not measured here" (p. 115), and 1.2 says the same (p. 11). The abstract does not.
- **Editor's resolution**: R0 and R1 are right that the claim, read literally, is calibrated. R3 is right that the abstract omits the limit a practitioner needs.
- **Required (REV-17)**, sentence-level: add the "consumer use not measured" limit to the abstract, and separate the may tier as a candidate generator from the must tier in Ch. 7. A consumer pilot is optional (consider). R3 concedes it is "not required at master's scope".

**D3. How short?** (row 1)
- **R0 W1**: about 70-75 body pages. **R3 W8**: 80-90. **R2**: names about 8-10 pages of Ch. 2 and Ch. 3 cuts. **DA**: no number.
- **Disagreement type**: severity of target (all agree the request is unmet).
- **Evidence**: the blocks the seats name add up to roughly 25-30 pages:
  - Table 4.5 and 4.3.2, pp. 54-62
  - Ch. 2 sections 2.5.3, 2.7.4, 2.8, 2.9
  - Ch. 3 model-only material
  - most of Table 6.1, pp. 95-101
  - the reading procedures of 5.3.4-5.3.8
  - the duplicate columns of Table 7.1
  - repeated caveats

  Removing these from 108 pages gives about 80. R0's 70-75 also needs R0 W1(d): compress Ch. 5 to 2-3 pages per RQ.
- **Editor's resolution**: the minimum acceptance is body ≤ about 80 pages, with each caveat stated once. 70-75 is the stretch target. Since the supervisor gave no number, confirm the target with the supervisor.

**D4. Severity of the abstract and the AI-use statement** (rows 2, 11)
- Abstract: Minor (R0 W7, R3 W9) vs Major (DA M10). AI statement: Major (R0 W5, R3 W10) vs Minor (DA m1).
- **Disagreement type**: severity.
- **Editor's resolution**: severities are kept as reported. Both items are must-fix, because both are explicit supervisor requests. The abstract is also where the corrections in REV-01, 02, 03, 09 and 12 must land.

**D5. Depth of remedy: wording versus new evidence** (rows 5, 13, 18)
- **R1 W1, W4, W5** ask for new evidence: a blind human judgement of the 25 must constructs or a browser run; a blind second human reader of at least 60 pairs with kappa; one scope reference that does not pass through the analysis's relations.
- **R0 W10, R2 W1 and DA C2** ask for re-wording and sensitivity figures.
- **Disagreement type**: direction of remedy (not existence).
- **Editor's resolution**: these are layers, not conflicts. The minimum fix in each item makes the claim match the evidence that exists, which removes the overclaim. R1's new evidence is recorded as should-fix (X-01 to X-03). Without it, the gap remains and is the ceiling noted in the grade section. This is author autonomy within a stated consequence, not a dismissal of R1's point.

---

## Devil's Advocate CRITICAL adjudication

`da_critical_adjudications: [C1=VALIDATED, C2=VALIDATED]`

**C1. RQ3's criterion is met by a trivial rival, and the discriminating evidence is thin. VALIDATED (with two qualifications).**
- **DA's argument.** The criterion, that the recovered share rises and nothing falls, is satisfied by assigning every site to every screen. The only discriminating evidence is two self-referential references, an alfresco precision reversal and wide scopes (59 % of k8sdash).
- **Corroboration.** R1 W1 makes the same claim independently: the first three conditions are "guaranteed", and precision is read for 97 of 159 must edges only.
- **Check.**
  - p. 50: the criterion is read "as no detected failure".
  - p. 81: "A scope that is too large still yields edges whose witnesses agree", so the witness check cannot fail the over-wide rival.
  - p. 75: "Nothing shows them to be right either."
  - Table 5.14: full is 82.0 % precise against the class join's 92.3 % on alfresco.
  - Abstract: "the first was partly completed from the graph's output".
- **Qualifications.** (a) The thesis does confront the trivial baseline in 5.3.2, with the 1.7-18.7x width ratio. The defect is that neither the RQ3 criterion nor the abstract uses that ratio. (b) DA's "rooted/outlet equal to full on mifos (19/22)" is wrong for rooted, which is 16/22 in Table 5.16. Outlet equal to full is right (p. 81).
- **Effect.** Blocks acceptance. **Required response**: REV-02.

**C2. The RQ1 headline is a function of demotion policy, not of the applications. VALIDATED in substance, one sub-point rejected.**
- **DA's argument.** Must-tier size depends on the guard and route-order policy (33 / 159 / 203 edges, and 1024 to 20 to 159 across versions). The census counts always-passing guards. The abstract still attributes the small tier "mostly" to the applications.
- **Corroboration.** R0 W10 ("partly a restatement of the definition of must"), R2 W1 ("largely a consequence of how modality and guard are defined"), R1 W5 (the tier was fitted to red-team panels).
- **Check.**
  - p. 66: "a guard that always lets the navigation through still counts as a guard, so the census says the application decides, not that the navigation is conditional at run time".
  - p. 33: "without it the must tier holds 33 of its 159 edges".
  - p. 95: guards passing gives 203.
  - p. 95 says the small tier is "**in part**" this fact. The abstract (p. 1) and Table 7.1 (p. 112) say "mostly". The headline is stronger than the thesis's own discussion.
- **Rejected sub-point.** The 1024 to 20 drop is not evidence of a policy dial. Table 4.5 records it as a reading defect corrected after 26 witness failures (a guard wrapper was not read), not as a policy setting. The 20 to 159 change and the 33/159/203 sensitivity remain valid evidence.
- **Effect.** Blocks acceptance. **Required response**: REV-01.

**DA MAJOR items** are all folded into roadmap items: M1 into REV-03, M2 into REV-09, M3 into REV-15, M4 into REV-07, M5 into REV-12, M6 into REV-13, M7 into REV-21, M8 into REV-16, M9 into REV-17, M10 into REV-05 and REV-11, M11 into REV-04. **DA MINOR items**: m1 into REV-10, m2 into REV-23, m3 into REV-22, m4 into REV-24, m5 into REV-18 and REV-25.

---

## Decision rationale

All four scoring seats recommend Major Revision, with confidence 4 each, and both DA CRITICAL items are validated against the manuscript. Either fact alone rules out Accept and Minor Revision. A lone outlier is not driving the decision: the two most decision-bearing problems, the RQ1 must-tier headline and the Rima comparison headline, are each raised by all four scoring seats (rows 3 and 5).

The panel separates evidence from presentation. The evidence is unusually well documented, and no seat calls the work unsound. What fails is the bridge from evidence to claim:
- the abstract says "mostly" where the discussion says "in part" (C2);
- RQ3 is "answered positively" by a test a trivial assignment would pass (C1);
- the most quotable comparison is a post hoc subgroup without its label (row 3);
- the service novelty is unexplained against the rival tool's own output (D1);
- "the loss was the tool's" holds for classes, not constructs (row 10);
- RQ4 cannot fail (row 7).

Each is fixable by re-wording, re-ordering or re-analysing data already collected, so the decision is not Reject.

The decision is Major rather than Minor for three reasons. The fixes touch the abstract, the RQ3 and RQ4 answers, the contribution statement and the title (R0 W2), which is core framing. The supervisor's requests require structural surgery: about 25-30 pages moved or cut, and 1.2 rebuilt. And the revised text needs another full read, ideally by one human outside the author-and-assistant loop, given the single-model panel. R1's requests for new independent evidence are recorded as should-fix. Leaving them undone does not block submission, but it caps the strength of the soundness and scope-accuracy claims and, in the synthesizer's projection, the grade.

---

## The supervisor's 4 Nov requests

| Request | Status | Seat evidence | Item |
|---|---|---|---|
| Shorten considerably | **Not met** | R0 W1 (DOES_NOT_MEET), R3 W8, R2 W4/W11, DA M11 | REV-04 |
| Readability | Partly met | R0 Minor Issues (long sentences, heavy cross-references), R3 W8, R2 comment | REV-04, REV-05, REV-22 |
| One-page abstract | One page met; readability not | R0 W7 (about 445 words, 20+ figures), R3 W9, R1 minor | REV-05 |
| Precise AI-use statement | Partly met | R0 W5, R3 W10, DA m1 (no tool, model or version; prose share unstated) | REV-10 |
| Abbreviations | Partly met | R0 minor, R3 W12, DA m2 | REV-23 |
| Section 1.2 aims only | **Not met** | R0 W4 (DOES_NOT_MEET), DA M10, R2 comment | REV-11 |
| Figure and table fixes | Partly met; rendered layout unchecked by every seat | R0 W11, R3 W12, DA m3, R1 minor | REV-22 |

---

# Part 2: Revision Roadmap

Items are ordered by severity: Critical, then Major, then Minor. Within a tier they are ordered by how many seats raised them, with supervisor requests first among ties. Severity is the highest the seats reported, with each seat's own rating in brackets where they differ.

**Obligation classes**:
- `must_fix`: required before submission.
- `should_fix`: strongly advised. It changes what the thesis can claim or how it is graded.
- `consider`: optional.

**Minimum fix** is the least change that resolves the finding. Larger seat suggestions appear under "Should-fix extensions" (X-items).

### Critical

| ID | Obligation | Issue | Raised by | Location | Minimum fix (acceptance criterion) |
|---|---|---|---|---|---|
| REV-01 | must_fix | The RQ1 headline ("almost no navigation ... mostly because the applications' own guards and branches decide it") is partly definitional and policy-dependent | DA C2 (Crit); R0 W10, R1 W5, R2 W1, R3 W4 (all Maj) | Abstract p. 1; 5.1 p. 66; 6.1 pp. 94-95; Table 7.1 RQ1 p. 112 | (a) Define must in plain words in the abstract and in RQ1: fires on every execution, with no template, code or router condition. (b) Report the tier with its sensitivity: 33 edges without the route-order assumption, 159, and 203 with all guards passing. (c) Replace "mostly because..." with the census's own limit: the application decides, not that the navigation is conditional at run time. Make abstract, 5.1, 6.1 and Table 7.1 say the same thing. (d) Report the 125 toolbar edges as one construct and the 62 unread destinations. *Accepted when* no sentence attributes the small tier to the applications without the definition and the sensitivity figures beside it. |
| REV-02 | must_fix | RQ3's acceptance criterion cannot fail. Scope accuracy is untested beyond two references that apply the analysis's own relations. | DA C1 (Crit); R1 W1 (Maj) | 4.2 p. 50; 5.3.2 p. 75; 5.3.6 pp. 80-81; abstract "Third..."; Table 7.1 RQ3 p. 113 | Drop the "answered positively only if" rule. Answer RQ3 in two parts: (A) recovery, descriptive; (B) scope accuracy, stated as tested only against the two self-referential references. Next to the 66.7 % figure in the abstract and Ch. 7, give the width ratio (1.7-18.7x narrower than all screens; 59 % of k8sdash) and the alfresco precision reversal (82.0 % vs the class join's 92.3 %). *Accepted when* the abstract's RQ3 sentence carries width and reversal, and no "positive answer" rests on the monotone criterion. |

### Major

| ID | Obligation | Issue | Raised by | Location | Minimum fix (acceptance criterion) |
|---|---|---|---|---|---|
| REV-03 | must_fix | The Rima comparison headline (94.1 % vs 10.2 %, "similar precision") is a post hoc subgroup. Its relative recall is a share of a union that one tool inflates. | R0 W8, R1 W3 + W2, R3 (scope-claims row), R2 (comment 5.3.8), DA M1 | Abstract last sentence; 5.3.8 pp. 84-86; Table 5.19 p. 85; Table 7.1 RQ3 | Label "without mifos" as formed after reading, wherever it appears. Put the mifos result beside it and say the pooled comparison "does not rank the tools". Give the estimated count of real pairs per tool, not only shares (the tools propose 217 vs 2084 pairs), and both precisions (72.6 % / 75.2 %) instead of "similar". Define relative recall as a share of the union. Give mifos stratum sizes. *Accepted when* the abstract cannot be read as reporting absolute recall or a preregistered result. |
| REV-04 | must_fix | Length and repetition: the supervisor's first request | R0 W1, R1 minor, R2 W4 + W11, R3 W8, DA M11 | Body pp. 8-115; Table 4.5 + 4.3.2 pp. 54-62; Ch. 2 sections 2.5.3, 2.7.4, 2.8, 2.9; Ch. 3 model-only parts; Table 6.1 pp. 95-101; 5.3.4-5.3.8 procedures; Table 7.1 | Move Table 4.5 and the 4.3.2 narrative to an appendix, leaving a one-page summary. Cut the Ch. 2 peripheral sections to one paragraph each. Fold Ch. 3's model-only material into REV-15. State each caveat once (6.2) and refer to it elsewhere. Remove Table 7.1's duplicate "Key figures" and "Main limit" content. *Accepted when* the body is ≤ about 80 pages (stretch 70-75; D3) and the target is confirmed with the supervisor. |
| REV-05 | must_fix | The abstract fits one page only by density: about 445 words, 20+ figures, mixed units, undefined terms | R0 W7 (Min), R3 W9 (Min), R1 minor, R2 comment, DA M10 (Maj) | p. 1 | About 250 words: problem, method, three findings with one number each and its unit (construct, edge or pair), and one limits sentence (in-sample; Angular only; non-independent references; consumer use not measured; 6.5 % precision on the largest application). Gloss must/may in plain words. Carry the corrected claims of REV-01, 02, 03, 09 and 12. |
| REV-06 | must_fix | The title and contribution order foreground scope attribution, yet 1.3 calls the measurement "the main contribution" and the ablation shows most recovery comes from earlier mechanisms | R0 W2, R2 summary (c) + W5 (iv), R3 W3, DA M2/M3 related | Title; abstract; 1.3 p. 12; Ch. 7 Contributions p. 114 | Choose one primary contribution and state it the same way in the title, abstract, 1.3 and Ch. 7. State once, early, that the shell rule and outlet descent (earlier work) give most of the recovery, and that the new step, the service join, adds 36 sites (2.0 %) over outlet. |
| REV-07 | must_fix | RQ4 is answered by a test that is "close to guaranteed by construction" and was tuned on its misses | R0 W6, R1 W6, R3 (Practical Impact), DA M4 | 1.2 RQ4; 5.4 pp. 86-88; Tables 5.17, 5.20, 5.21; Table 7.1 RQ4 | Demote RQ4 to a sanity check of witness mapping (one paragraph, one table), or reformulate it so it can fail (see X-05). Do not present it as change-impact evidence. Use one stated denominator: 67/67, or 45/45 labelled "rename excluded". Remove "45/45" as a result from Table 5.17. |
| REV-08 | must_fix | One empty-prefix fan-out site yields 39.4 % of edges and drives mifos precision (6.5 %) and e2e density. e2e hits have no chance baseline. | R2 W6, R3 W2, R1 W2 + W9 | 5.5.3 p. 91; 5.3.5; Table 5.16; Table 5.19 mifos row; Table 6.2 p. 105 | In the abstract and Ch. 7, say that one call site accounts for 39.4 % of edges and for the 6.5 % precision. Beside 19/19 and 19/22, give the density-matched expected hits (R1's estimates are about 13.5 and 9.7; the graph holds 44 % of possible mifos pairs). |
| REV-09 | must_fix | The services novelty claim ("Unlike the mechanisms of earlier work"; "Only it places navigation inside services"; "accounts for the transitions it adds over their rules") is unexplained against Rima et al.'s actual output | R0 W9, R2 W5, DA M2; disputed by R1 W11; R3 W3 related | Abstract; Table 7.1 RQ3 p. 113; Ch. 7 p. 114; 5.3.7 pp. 82-83; 2.4 | Per D1: state the claim relative to the published specification as read. Explain how their tool holds the 3 airbus reference pairs (p. 82, Table 5.19). State which "three airbus pairs from the sign-in screen" the repair removed, given 68 to 69/73. Give the evidence size: 36 sites (2.0 %), 20/48 constructs, 7 sites over the class join, one hand-read application. Write "the levels as I read them" for rooted and outlet (R1 W11). |
| REV-10 | must_fix | The AI-use statement does not name the tool, model or version, and the extent of prose drafting is vague | R0 W5 (Maj), R3 W10 (Maj), DA m1 (Min) | pp. 2-3; "a stronger model of the same assistant" p. 84 | Use a table: activity (code, harness, source readings, red-team panels, literature search, prose) / tool, model, version, dates / chapters or artefacts affected / human check applied. Name the "stronger model". State the nature and extent of prose drafting per chapter, and whether third-party source code was sent to a hosted model (R3). Move the evaluation-role description and the list of non-reproducible figures to Ch. 4. |
| REV-11 | must_fix | Section 1.2 is not aims-only | R0 W4, R2 comment, DA M10 | pp. 10-12; Fig. 1.1 | Keep an aim statement and the five RQs as questions. Move the "how answered" paragraphs to 4.2, the scope limits to a short paragraph, and Fig. 1.1 to Ch. 4, merged with Fig. 4.1. |
| REV-12 | must_fix | RQ5's "the loss was the tool's" holds for the classes the author found and fixed, not for constructs | R0 W3, R1 W7, DA M5 | Abstract; 1.2 p. 11; 5.5 pp. 88-91; Table 7.1 RQ5 p. 114 | Give a three-way answer: the tool's (node and class losses, which the final version reads); the application's (must-tier demotions); open (the 151-construct attribution remainder and dynamic destinations). Count constructs, not causes, with an unclassified residual row. |
| REV-13 | must_fix | The validity of AI-assistant readings is not established. One model family; the author's 41/41 check is not stated as blind. | R1 W4; R0 W5 and R3 W10 (traceability); DA M6 | 5.3.7 p. 84; 5.3.8 p. 86; AI statement p. 2; Table 6.1 "Experimenter bias"; Ch. 7 p. 115 | State whether the author's 41 re-reads were blind to the model's verdict and to the proposing tool. The model reader was blind to the proposing tool (p. 84), and Table 6.1 records "No blinding" for the experimenter. Report the model's change rates (10/114; 3/45) and an interval for 41/41. Mark in the abstract which figures are model readings ("consistency, not correctness"). |
| REV-14 | must_fix | Must "lower bound" and may "upper bound" are stated as properties, but they hold only under unread assumptions and some rules under-approximate | R2 W2 + W3, R1 W5 | 3.1 pp. 33-35; 6.1 p. 94; Table 6.2 p. 105; Ch. 7 | List the assumptions A1-An, each with its counterexample class and the number of dependent edges: route order (126 edges); ambiguous selector joins; the unresolved-call rule; the execution model; may-tier rules for first route, one segment, catch-all order, dispatch and dialogs. Write "lower bound relative to A1-A4". Replace "upper bound" with "design intent" plus the list of rules that do not over-approximate. |
| REV-15 | must_fix | The specified least-fixpoint analysis is not the evaluated pass (three of four relations, stand-ins, a non-monotone fallback) | R2 W4 (conf. 5), DA M3 | 3.2-3.3 pp. 35-43; Algorithm 1; Fig. 2.1; Table 3.3; abstract "a dataflow analysis" | Present the implemented analysis as the thesis's analysis: three relations, two stand-ins, fallbacks as a labelled post-pass. Restrict termination and least-solution claims to the fixpoint core. Move the four-relation model to a one-page "extensions" section. Remove the unimplemented `unknown`-for-effects edge from Fig. 2.1. (This also cuts about 3-4 pages for REV-04.) |
| REV-16 | must_fix | Pooled percentages are mostly mifos (1343 of 1818 constructs). The corpus was selected with the tool in view. | R1 W8 (Min), DA M8 (Maj) | Abstract 66.7 %; Table 7.1; 4.1 p. 45 | Give the per-application median and range as the primary summary, then the pooled figure with the application count named (e.g. 38.6 % without mifos; 4 of 6 below half). State that selection was not tool-blind (spartacus rejected after screening began). |
| REV-17 | must_fix | The "usable" basis claim versus untested consumers | R3 W1 + W4, DA M9; disputed by R0 S4, R1 S6 | Abstract p. 1; Ch. 7 p. 115; 1.1 p. 10 | Per D2: add "consumer use not measured" to the abstract. In Ch. 7, separate "candidate generator (may tier)" from "trustworthy transitions (must tier: 25 constructs)". |
| REV-18 | must_fix | The artifact is not identifiable from the text, and licences are not stated (extractor, corpus, Rima checkout) | R3 W6 (Maj), DA m5, R1 W10 related | 3.3 p. 40 "available as open source"; 4.3.3 p. 62; Table 4.1 | Add an "Availability" paragraph: repository URL, archived release or DOI, licence, evaluated commit, and how a reader obtains the Rima et al. checkout, with its licence status. R3's "no licence" rests on a repository file and must be checked by the author. Add a licence column to Table 4.1. |
| REV-19 | should_fix | Runtime cost is not reported, although per-commit recomputation is claimed as an advantage | R3 W5 (Maj) | 6.1 p. 95; 1.1 | Report wall-clock time and peak memory per application on a stated machine (the mutation harness already re-extracts). Otherwise, drop the cost-based advantage claim. |
| REV-20 | should_fix | Workspace-library and monorepo layouts are not a headline external-validity limit | R3 W7 (Maj) | Table 6.3 p. 108 (129 alfresco pairs); Table 6.1 p. 99 | State in the abstract or 6.2 that the figures are for single-application source trees and that a library-provided shell is not followed. |
| REV-21 | consider | "Node extraction is complete" holds against the static readers, not the runtime router (892/1146) | DA M7 (Maj) | 5.1 pp. 66-67; Table 7.1 RQ1 | Adjudicated as largely met: the thesis puts 892/1146 next to the claim (p. 66) and in Table 7.1. Keep the reader named at every use of "complete". |

### Minor

| ID | Obligation | Issue | Raised by | Location | Minimum fix |
|---|---|---|---|---|---|
| REV-22 | must_fix | Figure and table inconsistencies: method and application names, 45 vs 67 denominators, float order, dense headers | R0 W11, R1 minor (Tab. 5.4, 5.18 notes), R2 comment (Fig. 3.1 caption), R3 W12, DA m3 | Fig. 1.1, Fig. 4.2 note p. 52; Tables 4.2/4.3 pp. 63-64; 5.5, 5.7, 5.17, 6.1, 7.1; Fig. 5.2 | Use one name per method ("runtime route oracle") and per application. Use one mutation denominator. Place floats near their first reference. Split Table 5.7's header and spell out Table 5.5's keys. Note in Fig. 3.1's caption that nesting is enforced by the experiment design. Check rendered figures, which no seat could see. |
| REV-23 | must_fix | The abbreviation list is incomplete | R0 minor, R3 W12, DA m2 | p. 4 | Add terms used in the text (NgRx, SPIN, ZAP, E2E, LLM, Ajax, SWE-bench as used). Drop single-use entries or keep the list consistent. |
| REV-24 | should_fix | Provenance gaps: oracle commit unrecorded, unpinned realworld backend, preregistration and logs committed together | R1 W10, DA m4 | 4.3.3 p. 62 | Re-run the oracle at the final commit, or record the measured graph's digest. Pin or mock the backend, or state the risk. Write "committed before scoring" where timestamps cannot show order. |
| REV-25 | should_fix | Ethics: no stated licence check, notification or right of reply for Rima et al.; named dead-link candidates | R3 W11, DA m5 | 5.3.8; 5.6 p. 92; abstract "10.2 %" | One sentence on licence status and notification. Qualify 10.2 % as measured on constructs outside their tool's stated design. Keep dead links as "candidates". |
| REV-26 | should_fix | The `unknown` modality and the order `unknown < may < must` conflict with the cited MTS | R2 W7 | Def. 3.1 pp. 30-31 | Call it a confidence label inspired by MTS. Resolve "never denotes a target" against its coincidence with the sink. |
| REV-27 | should_fix | Guard (UrlTree) redirect edges are absent from every measured graph | R2 W10 | 3.2.4 p. 39; Ch. 7 open items | State their absence in Ch. 7's open items and the abstract's limits. |
| REV-28 | consider | The effect of not installing dependencies on type-directed resolution is unmeasured | R2 W9 | Table 6.1 p. 96 | State it as unmeasured (see X-07). |
| REV-29 | consider | The Android comparison generalises from one paper; inter-component target-resolution work is absent | R2 W8 (conf. 2, field norm unverified) | 2.10 p. 27 | Re-check [77] and [78] and fix the sentence, or say that the line of work was not reviewed. |

### Should-fix extensions (new evidence beyond the minimum)

These change what the thesis can claim, and the grade section explains why. None is required for submission.

| ID | Extension | Raised by | Effect if done |
|---|---|---|---|
| X-01 | A non-author human, blind to the extractor's rationale, judges all 25 must constructs; or run them in a browser against a signed-in, seeded backend | R1 W5 | Gives Claim 3.1 a test outside the author-and-panel loop (REV-01, REV-14) |
| X-02 | A blind second human reader of at least 60 sampled pairs, with Cohen's kappa and a confusion matrix; optionally a second model family | R1 W4 | Turns "consistency" into a measured error rate for Tables 5.18 and 5.19 (REV-13) |
| X-03 | One scope reference that does not pass through the analysis's relations: a signed-in rendered reading of a stratified screen sample, or blinded annotation of sampled sites | R1 W1; thesis 6.5 | Answers RQ3 part B (REV-02) |
| X-04 | Site-level or clustered intervals for Table 5.19; absolute recall against the e2e pairs; a fresh, larger mifos sample under a fixed rule | R1 W2, W3 | Makes the comparison a ranking where it can be one (REV-03) |
| X-05 | Mutants from all syntactic sites in scope, with the 272 candidates in the denominator | R1 W6 | Makes RQ4 refutable (REV-07) |
| X-06 | A "consumer view" for mifos (zero-prefix fan-out treated as unknown or capped), re-scored; precision per modality | R2 W6, R3 W2 | Separates the policy from the extractor (REV-08) |
| X-07 | Install dependencies on realworld and one mid-size application; report the change in resolved calls and in the must tier | R2 W9 | Bounds the no-dependency threat (REV-28) |
| X-08 | Inspect Rima et al.'s output (f33003f) for service-hosted navigation | R2 W5 (i) | Settles D1 directly (REV-09) |
| X-09 | A small consumer pilot (route list to a test generator or agent; edges and tokens per screen) | R3 W1 | Supports any consumer-facing claim (REV-17); optional at master's scope |

---

## Response instructions

Answer every REV item in a response table with these columns: ID, action (done / declined with reason / not on point), and where it changed (section, page). For declined must-fix items, state the reason. The panel records a decline as unresolved, not as accepted. Track changes for the abstract, 1.2, the RQ answers in Ch. 5 and Table 7.1. A re-review should check REV-01 to REV-18 and REV-22/23 against the revised PDF, including the rendered figures, which no seat in this round could see.

## Closing

The panel found a sound, unusually transparent measurement study whose abstract and conclusions claim more than its chapters show, inside a text about a third longer than its argument needs. Calibrate the claims to the evidence already in Ch. 5 and Ch. 6, and cut to the argument. The revised thesis should then be read once more before it goes to grading.

---

## Appendix: seat summaries

- **R0 (Journal-Fit / examiner)**: Major Revision; confidence 4. The thesis is not examinable at 108 body pages. 1.2 is not aims-only. The AI tool is not named. RQ5, the Rima comparison and the services novelty are overclaimed in the abstract and Ch. 7. Grade signal 3-4 after repairs.
- **R1 (Methodology)**: Major Revision; confidence 4. RQ3 and RQ4 cannot fail. The references and readings are not independent of the author, the tool or the assistant. The comparison uses relative recall over a union, clustered 12-pair samples and a post hoc subgroup.
- **R2 (Domain)**: Major Revision; confidence 4. "Almost nothing is deterministic" and "may is an upper bound" are partly artefacts of definitions. The formal analysis is not the evaluated pass. The services novelty contradicts the thesis's own airbus data and rests on 36 sites. One fan-out policy drives 39.4 % of edges.
- **R3 (Practical)**: Major Revision; confidence 4. The named consumers are never exercised. 6.5 % precision on mifos is not made actionable. Runtime cost, artifact URL and licences are missing. Monorepo layouts are not a headline limit. The text is too long.
- **DA**: findings only. C1 (RQ3 trivial rival) and C2 (RQ1 policy dial) were both validated, C2 minus the 1024-edge sub-point. Strongest counter-argument: "the answer key moves with the tool". Required changes are folded into REV-01 to REV-25.


## Attachment: Suggested-Reference Check (advisory, #1001)

The suggested-reference check did not run: the script needs PyYAML, which is not installed in the available Python, and nothing was installed for this review. Reviewer 3 suggests references in its report; check them before citing.

## Attachment: Reviewer Claim Check (advisory, #1002)

The reviewer claim check did not run in this review (single-call panel, budget).

## Attachment: Acronym Check (advisory, #849)

### Acronym check (advisory; no reply needed)
Coverage: body (partial)
Not in this input: English abstract, Chinese abstract.
Not checked:
- Body, line 29: UI (the initials before its parentheses do not spell it)
- Body, line 215: RQ1 (the initials before its parentheses do not spell it)
- Body, line 216: RQ2 (the initials before its parentheses do not spell it)
- Body, line 217: RQ3 (the initials before its parentheses do not spell it)
- Body, line 229: RQ4 (the initials before its parentheses do not spell it)
- Body, line 230: RQ5 (the initials before its parentheses do not spell it)
- Body, line 496: SPA (the initials before its parentheses do not spell it)
- Body, line 582: HTML (the initials before its parentheses do not spell it)
- Body, line 971: RxJS (the initials before its parentheses do not spell it)
- Body, line 1175: JSP (the initials before its parentheses do not spell it)
- Body, line 1797: TOKEN (the initials before its parentheses do not spell it)
- Body, line 5345: REBLS (the initials before its parentheses do not spell it)
- Body, line 5363: OOPSLA (the initials before its parentheses do not spell it)
- Body, line 5562: ICST (the initials before its parentheses do not spell it)
- Body, line 5594: ICSTW (the initials before its parentheses do not spell it)
- Body, line 5612: LIPIc (the initials before its parentheses do not spell it)
- Body, line 5651: FSE (the initials before its parentheses do not spell it)
- Body, line 5673: ASWEC (the initials before its parentheses do not spell it)

| Scope | Line | Rule | Acronym | Uses |
|---|---|---|---|---|
| Body | 68 | Defined after first use | AI | 17 |
| Body | 109 | Not defined | DBLP | 1 |
| Body | 125 | Defined after first use | API | 6 |
| Body | 126 | Defined after first use | DOM | 13 |
| Body | 127 | Defined after first use | GUI | 6 |
| Body | 129 | Not defined | HTTP | 4 |
| Body | 130 | Defined after first use | ICU | 3 |
| Body | 131 | Not defined | JSON | 4 |
| Body | 133 | Not defined | JSX | 3 |
| Body | 133 | Not defined | XML | 3 |
| Body | 134 | Defined after first use | MVC | 3 |
| Body | 135 | Defined after first use | RQ | 6 |
| Body | 349 | Not defined | SWE | 3 |
| Body | 557 | Not defined | CTX | 3 |
| Body | 622 | Not defined | SPIN | 1 |
| Body | 697 | Not defined | SPOON | 2 |
| Body | 1185 | Not defined | ZAP | 1 |
| Body | 1468 | Not defined | NgRx | 7 |
| Body | 1693 | Not defined | EX | 1 |
| Body | 1947 | Not defined | SAP | 2 |
| Body | 4615 | Defined again | AI | 17 |
| Body | 4886 | Not defined | ROUTES | 1 |
| Body | 5344 | Not defined | ACM | 41 |
| Body | 5348 | Not defined | DIKU | 2 |
| Body | 5359 | Not defined | IEEE | 25 |
| Body | 5386 | Not defined | ECOOP | 2 |
| Body | 5396 | Not defined | CA | 1 |
| Body | 5406 | Defined again | ICSE | 11 |
| Body | 5416 | Not defined | SIGACT | 2 |
| Body | 5450 | Not defined | IDE | 1 |
| Body | 5452 | Defined again | ICSE | 11 |
| Body | 5457 | Defined again | ICSE | 11 |
| Body | 5468 | Not defined | SAS | 1 |
| Body | 5488 | Defined again | MSR | 3 |
| Body | 5497 | Defined again | POPL | 2 |
| Body | 5504 | Defined again | ASE | 3 |
| Body | 5511 | Defined again | ICSE | 11 |
| Body | 5517 | Not defined | ERCIM | 1 |
| Body | 5517 | Not defined | EVOL | 1 |
| Body | 5517 | Not defined | IWPSE | 1 |
| Body | 5528 | Defined again | ICSE | 11 |
| Body | 5532 | Not defined | LLM | 2 |
| Body | 5535 | Defined again | ICSE | 11 |
| Body | 5545 | Not defined | ESEC | 1 |
| Body | 5575 | Defined again | ICSE | 11 |
| Body | 5581 | Not defined | KSI | 1 |
| Body | 5607 | Defined again | ICSE | 11 |
| Body | 5615 | Not defined | E2E | 1 |
| Body | 5627 | Defined again | ICSE | 11 |
| Body | 5689 | Defined again | ICSE | 11 |
| Body | 5694 | Defined again | ASE | 3 |
| Body | 5706 | Defined again | MSR | 3 |
