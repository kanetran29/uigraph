## Devil's Advocate: Verification Review (Round 2)

**Manuscript.** "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution", D. K. Tran, Aalto MSc thesis. Revised version dated 5 Nov 2026: 117 pp., body pp. 8-96, Appendices A and B.
**Round-1 inputs.** My report `reviews/2026-11-05-full/DA-devils-advocate.md` (C1, C2, M1-M11, m1-m5) and the roadmap `reviews/2026-11-05-full/editorial-decision.md` (REV-01 to REV-29).
**Calibration status.** `NOT_CALIBRATED`. This is one model family, the same as round 1.

### How this check was made

- I read the revised `manuscript.txt` in full. I compared it with the round-1 text by diff for the abstract, the AI-use statement, Chapter 7 and the relation wording of Chapter 3.
- I looked at rendered pages of `thesis/thesis.pdf` (117 pp., the same build as the text): Fig. 1.1, 3.1, 4.2, 5.1, 5.2 and Table 5.7. The PDF page is the printed page plus 1.
- I opened three repository files: `route-oracle/may-reasons.mjs`, `thesis/generated-may-reasons.tex` and `thesis/ch1-introduction.tex`.
- I did not read any other seat's round-2 report.
- Page numbers are the printed ones. Quotes are at most 15 words.
- **Status rule.**
  - *Addressed*: the roadmap's minimum fix is met at the places it names.
  - *Partly*: the fix is met only in part or only in some places, or a residual keeps part of the round-1 weakness.
  - *Not addressed*: no material change.

### 1. Verification of my round-1 findings and the roadmap items attributed to my seat

The editorial letter folds my findings into 21 roadmap items (REV-06 is listed as "DA M2/M3 related").

| REV | My R1 finding | Status | Evidence in the revision (page, quote) | What remains |
|---|---|---|---|---|
| REV-01 | C2 | **Addressed** | p. 1 "159 edges that always fire, 33 without an assumed route order and 203". p. 56 "a guard that always lets the navigation through still counts as a guard". Table 7.1 p. 93 "125 from one toolbar", with 62 unread. | The acceptance criterion is met: the definition and the sensitivity figures stand beside every attribution of the small tier (abstract, 5.1, 6.1, Table 7.1). The same abstract sentence now carries two new problems, N1 and N2 (Section 2). |
| REV-02 | C1 | **Partly** | p. 46 "RQ3 is not decided by one rule." p. 64 "the low end of the range is the figure that qualifies RQ3". p. 1 "its precision against a reference read from one application's source is 82.0 %". | The body and Table 7.1 (p. 94, 82.0 % against 92.3 %) are fixed. The abstract gives 82.0 % without the class join's 92.3 %, so a reader cannot see that it is a reversal. The abstract also lost the round-1 caveat that both references apply the analysis's own relations. |
| REV-03 | M1 | **Addressed** | p. 1 "on five applications grouped after reading". p. 72 "Relative recall is a share of that union, not recall against all real pairs". p. 73 "an estimated 1512 and 163 are real"; "the pooled comparison does not rank the tools". | The subset is labelled post hoc everywhere it appears. Mifos's 6.5 % appears beside it, and both precisions replace "similar". The residual is disclosed: the route-identification rule was chosen after their output was read (p. 73). |
| REV-04 | M11 | **Partly** | p. 21 "No pass in this version emits that modality for an effect or a subscription" (Section 2.8 kept). | The body went from 108 to 89 pp. (pp. 8-96), against the ≤ 80 minimum. Of the 19 pp. saved, about 12 moved to Appendices A-B, so the net deletion is about 7 of 124 pp. Table 6.1 still fills pp. 82-89 of the body. Fig. 5.2 (p. 62) repeats Table 5.7. Repetition did not fall: "162567" appears 7 → 8 times, "9.7" 5 → 8 and "consistency" 5 → 8. Caveats are still not stated once. |
| REV-05 | M10 (abstract) | **Partly** | The abstract now glosses must and may ("always fire", "merely possible"). Its limits sentence on p. 1 reads "the figures are in-sample; consumer use is not measured". | The abstract is 465 → 367 words against a target of about 250, and it holds 16 figures, up from 12. It mixes edges, location-"constructs", constructs, sites and pairs within four sentences. It does not keep to one number per finding. The limits sentence omits the non-independent references. |
| REV-06 | M2/M3 (related) | **Addressed** | The title now begins "Measuring ...". p. 10 "The measurement is the main contribution and scope attribution a modest extension". p. 96 "The primary contribution is the measurement". | None. The 36 sites (2.0 %) are stated early (p. 10). |
| REV-07 | M4 | **Addressed** | p. 1 "Mutation testing only sanity-checks the witness mapping." p. 75 "RQ4 is therefore a sanity check that witnesses map to source lines". | The 45/45 entry is gone from the comparison table. Minor residual: p. 81 still reports 45 of 45, while p. 75 names 67/67 as "the one denominator" (N8). |
| REV-09 | M2 | **Partly** | p. 1 "adds 2.0 % of the sites". Table 7.1 p. 94 "Among the published rules of earlier work only it places navigation inside services." | Three parts are not done. (i) The text does not explain how their tool holds the airbus pairs (Table 5.18 p. 73: their recall on airbus is 100.0 %). (ii) The text does not say which three airbus pairs were lost. On p. 71, "The step from outlet to full is 3 pairs, all on airbus" is followed on p. 72 by "loses the three airbus pairs from the sign-in screen, which the source does not hold". The repaired row of Table 5.17 (outlet 66, full 69) implies that the lost pairs are "other pairs", but the reader has to work this out. (iii) Ch. 7 p. 96 keeps, word for word, "accounts for the transitions it adds over their rules on their own subjects", the sentence D1 said must go until shown. Table A.1 p. 111 adds a further complication: the frozen version placed "airbus's router-service call from its dialogs ... on the sign-in screen". |
| REV-10 | m1 | **Not addressed** (intended) | A word-level diff shows that only "Table 4.5" → "A.1" changed. p. 70 still reads "a stronger model of the same assistant re-reading a gated subset", without naming the model. | Known and intended: the author is rewriting the statement from a draft. It is counted once here and not again. |
| REV-11 | M10 (1.2) | **Addressed** | p. 10 "The aim is to measure how far static extraction of a UI transition graph gets". Section 1.2 now holds the aim, five RQs and one scope paragraph. | Fig. 1.1 was not moved. It falls between RQ1 (p. 10) and RQ2 (p. 11) and splits the list. The scope paragraph's cross-reference is wrong (N8). |
| REV-12 | M5 | **Partly** | p. 75 "RQ5 is answered in three parts, not by one claim". Table 7.1 p. 95 "A statement about the classes the author found and fixed". | The fix asked for constructs to be counted, with a residual row. The text instead says on p. 75: "The lists below count causes, not constructs". The abstract keeps a count of causes on p. 1: "Most causes of loss traced in the source are constructs a static reader can read". The granularity of causes is arbitrary. The count also includes the attribution remainder among the readable causes, although p. 76 says "no measurement separates them". |
| REV-13 | M6 | **Partly** | p. 74 "with the reading's verdict in view, so not blind to it", with a Wilson interval of 91.4-100.0 %. The change rates (3/45, 10/114) are on p. 88. | Whether the author saw the proposing tool is left as a placeholder on p. 88: "[author: state whether the proposing tool was shown]". Ch. 7 p. 96 still says "of which I confirmed 41 of the 41 I re-read", although 5.3.8 says consistency is not correctness. The abstract marks the Rima figures as model readings but not the 82.0 %, whose alfresco reference was built by the AI assistant (p. 67). The interval assumes independent draws, but there are three per stratum. |
| REV-15 | M3 | **Partly** | p. 31 "termination and the least-solution property hold for the fixpoint core only". Section 3.2.7 "Extensions not evaluated" (p. 35). Fig. 2.1 has no unknown edge (p. 14). | Section 3.2 is fixed. The summaries now contradict it on the number of relations (N4). Algorithm 1 (p. 40) still contains D, T, leave(r) and the interceptor lines. |
| REV-16 | M8 | **Partly** | p. 59 "Per application the median recovery is 40.2 % (range 14.3 %–100.0 %)". p. 42 "per-application figures are the primary summary where the chapters give them". | The abstract leads with the pooled figure and does not give the median. p. 1 reads "Scope attribution recovers 66.7 % of the constructs assigned to it", which contradicts the thesis's own rule on p. 42. Table 7.1 does lead with the median. The statement that selection was not tool-blind is in place (p. 42). |
| REV-17 | M9 | **Addressed** | p. 1 "consumer use is not measured". p. 96 "The may tier is a candidate generator whose edges a consumer must still check". | None. A dynamic or crawler baseline is still absent, but that was not part of the minimum fix. |
| REV-18 | m5 | **Partly** | A licence column was added to Table 4.1 (p. 52). The Availability paragraph is new on p. 50. | Placeholders are left in the text. p. 50 reads "[author: archive DOI; a repository URL would name the extractor]" and "[author: confirm, per rima/PREREGISTRATION.txt:27]". The Table 4.1 note (p. 52) reads "confirm at the pinned commits". No URL, DOI or archived release is given (N3). |
| REV-21 | M7 | **Addressed** | p. 80 "only 2 of the six are complete in this stronger sense". Table 7.1 p. 93 "2 of six complete against the mounted routes". | None. |
| REV-22 | m3 | **Partly** | The Fig. 3.1 caption has "The levels nest by construction" (p. 36). | Several fixes are not done. The method is named three ways: "runtime probe" (Fig. 1.1, p. 11), "the runtime route probe" (Fig. 4.2 note, p. 50) and "runtime route oracle" everywhere else. Table 5.5 keeps the keys "rw alf gf k8s bw mif" (p. 59), and Table 5.1 uses "kdash" (p. 56). Fig. 5.2 (p. 62) has a y-axis to 40 % for values of at most 7.7 % and a duplicated legend glyph. The Fig. 5.1 legend is misaligned (p. 60). Two mutation denominators remain. |
| REV-23 | m2 | **Addressed** | p. 4 "NgRx Angular state-management library built on RxJS". Ajax, SPIN and ZAP were also added. | Nit: F1 (Table 2.1, p. 24) and the licence acronyms in Table 4.1 are not expanded. |
| REV-24 | m4 | **Partly** | p. 45 "runs against the public demonstration backend, which is not pinned". p. 83: the preregistration and the logs "were committed together". | The oracle was neither re-run nor given a digest. p. 51 still says "whose node total is its only link to the final graph". |
| REV-25 | m5 | **Partly** | p. 79 "The result is a candidate list and not a verdict". | Nothing on notifying Rima et al. The licence status is a placeholder (see REV-18). The 10.2 % in the abstract (p. 1) is not qualified as measured on constructs outside their tool's stated design. p. 72 explains why, but not where the figure is quoted. |

**Tally over the 21 roadmap items: 8 addressed, 12 partly addressed, 1 not addressed.** The one not addressed is REV-10, which is intended.
**Tally over my 18 round-1 findings: 6 addressed, 11 partly addressed, 1 not addressed.**
- Addressed: C2, M1, M4, M7, M9, m2.
- Partly addressed: C1, M2, M3, M5, M6, M8, M10, M11, m3, m4, m5.
- Not addressed: m1.

Both round-1 CRITICAL items are defused in the body. C2 is addressed by its acceptance criterion. C1 survives only as a missing comparator and a missing caveat in the abstract.

### 2. New issues introduced by the revision

There are no new CRITICAL issues, three MAJOR and five MINOR. Several Majors overlap partial items above; where they do, the fix is the same and should be made once.

- **N1** is new text: an abstract rewrite that dropped a round-1 caveat.
- **N2** rests on a table that existed in round 1. Every seat missed it, mine included. The revision made it load-bearing by moving the figure into the abstract and into the RQ5 answer.
- **N3** is new text.

#### CRITICAL
| # | Issue | Evidence Anchor | Confidence |
|---|---|---|---|

#### MAJOR
| # | Issue | Evidence Anchor | Confidence | Field-norm boundary / crossing rationale |
|---|---|---|---|---|
| N1 | **The abstract now asserts as a fact the property that the thesis says is not verified, and the length cut removed the toolbar caveat.** "159 edges that always fire" states Claim 3.1 as established. Yet the thesis says its "stronger half" is "not independently verified" (p. 30). 62 of the 159 destinations are unread. 125 come from one k8s toolbar whose scope is untested (Table 7.1, p. 93). The edges that rest on A3 and A4 are not counted (p. 28). The round-1 abstract carried "Most of them come from one toolbar whose screen set is untested"; the revision deleted it. Fix: write "159 edges classified as always firing", and restore the toolbar and unread clause. | text: p. 1 "The corpus yields 159 edges that always fire" | 5 (direct text comparison of both versions) | n/a: internal consistency with p. 30 and Table 7.1 |
| N2 | **The census behind the reframed RQ1 headline counts a different unit from every other "construct" in the thesis.** The abstract (p. 1), 5.1 (p. 55), 5.5.1 (p. 75) and Table 7.1 (p. 93) say that 1631 of 1657 *constructs* sit behind an application decision. The census script counts witness locations instead: file:line:col, with every merged witness counted and locations outside the application directory included. Two checks show the difference. First, bitwarden has 210 may-only "constructs" (`generated-may-reasons.tex`) and 202 with a guard reason (Table 5.1, p. 56), but only 131 constructs in total (Table 5.5, p. 59). Second, the corpus has at most about 1482 recovered (83.5 % of 1775) − 25 must ≈ 1457 may-only constructs (Table 5.20, p. 77), not 1657. The 98 % share probably survives a re-count, but the abstract sentence now mixes edges, location-"constructs" and constructs. A reader who reconciles it with Tables 5.5 and 5.20 will find the numbers inconsistent. Fix: re-key the census on the construct identity used by Table 5.5, or rename the unit "witness locations" wherever it is quoted. | dataset: `route-oracle/may-reasons.mjs:6` "a construct being a witness location (file:line:col) in one application" | 4 (script read; how the script handles out-of-directory sites inferred from Table 5.13's note) | n/a: unit consistency within the thesis (Table 4.2 defines the construct) |
| N3 | **The submission text contains unresolved author notes and an internal file path.** p. 50 has "[author: archive DOI; ...]" and "[author: confirm, per rima/PREREGISTRATION.txt:27]". Table 4.1's note (p. 52) reads "confirm at the pinned commits". Table 6.1 (p. 88) reads "[author: state whether the proposing tool was shown]". Taken together, the artefact still cannot be identified from the text (no URL, DOI or release), Rima et al.'s licence status is unconfirmed, and one REV-13 disclosure is missing. These notes are rendered in the PDF (p. 50 checked). | text: p. 50 "[author: archive DOI; a repository URL would name the extractor]" | 5 | n/a: completeness of the manuscript; these notes are also why REV-13, REV-18 and REV-25 are only partly addressed |

#### MINOR
| # | Issue | Evidence Anchor | Confidence |
|---|---|---|---|
| N4 | **The relation count of scope attribution now disagrees across chapters.** The REV-15 rewrite turned T from a derived relation into an "input relation" (3.2.7, p. 35: "Two further input relations"), so the model now has five input relations. The summaries still say four. On p. 39, "least fixpoint over four input relations. The prototype implements three of them". p. 90 has "the four input relations of Section 3.2", and p. 96 "implemented over three of its four input relations". p. 96 also says "the guard relation is replaced by a stand-in" while calling dispatch merely unimplemented, but Section 3.3 gives stand-ins for both D and T. | text: p. 30 "Scope attribution is specified here over three input relations." | 5 |
| N5 | **RQ1 and RQ5 now give two different owners for the same demotions.** RQ1/6.1 call the small tier "a matter of definition rather than a defect of the extractor" (p. 82). RQ5 counts the same 1631 demoted "constructs" as the application's loss (p. 75; Table 7.1, p. 95, "The application's: constructs the must tier demotes"). If the demotions follow from a definition the author chose, they are the definition's, not the application's. The census limit on p. 56 (an always-passing guard still counts) makes the RQ5 attribution weaker still. | text: p. 82 "a matter of definition rather than a defect of the extractor" | 4 |
| N6 | **Chapter 7 leads with figures produced after the repairs, although the frozen-extractor figures are the evidence.** p. 96 cites 69/73 and puts the out-of-sample 68 in brackets. Table 7.1 (p. 94) leads with 19/22 on mifos, and 12/22 appears only as "against 12 before the repairs". Table 7.1 also says "close on their seven subjects" without noting that 5.3.8 ran the repaired extractor, which 5.3.7 (p. 70) calls not out-of-sample on those subjects. | text: p. 96 "it holds 69 of the 73 reference pairs, after four defects found there were repaired" | 4 |
| N7 | **Section 4.2 describes the structural references in terms that read as independence.** Section 5.3.4 denies that independence. | text: p. 46 "references that do not come from the attribution's output alone" | 4 |
| N8 | **Flow and editing artefacts left by the cuts.** (a) The 1.2 cross-reference "lists what it approximates (Section 2.6.2)" (p. 11; `ch1-introduction.tex:122-123` `\ref{sec:soundiness}`) points at background, not at 6.3 or Appendix B. (b) "Oshima and Kishi's restrictions admit 0 of the 6" is stated twice on p. 70. (c) The 6.6 Summary (p. 92) is two sentences that summarise only 6.4-6.5. (d) Fig. 1.1 splits the RQ list. (e) Fig. 5.2 (p. 62) wastes most of its axis and repeats Table 5.7. (f) There are two mutation denominators: 67/67 on p. 75 and 45 of 45 on p. 81. | text: p. 11 "lists what it approximates (Section 2.6.2)" | 5 |

### 3. Strongest counter-argument (round 2)

The revision has conceded most of my round-1 counter-argument and now states much of it itself:
- the measurement is the primary contribution;
- scope attribution is "a modest extension";
- RQ4 is a sanity check;
- the Rima subset was formed after reading;
- the small must tier is "largely a matter of definition".

What a sceptic can still say is narrower, and it has three parts.

**Every check that looked external was spent as a repair driver, and Chapter 7 leads with the figures produced after the repairs.**
- The structural reference prompted two repairs.
- The mifos suites prompted three. After them the graph holds 162567 instead of 28185 of the 367236 possible pairs, so the number of the 22 pairs expected by chance rose from about 1.7 to 9.7.
- Rima's subjects prompted four, moving the result from 68 to 69 of 73.

The figures an extractor produced before it met each check are the evidence: 12/22 on mifos at 7.7 % density, and 68/73 on Rima's subjects. The figures 19/22 and 69/73 are fitted. Ironically, the pre-repair 12/22 is the more convincing result at about seven times chance, yet the thesis does not give its chance level.

**The one mechanism the thesis adds has a single out-of-sample datum.** It is 3 airbus pairs. The rival tool also holds them: its recall on airbus is 100 %. On the same application, the frozen version placed the service's navigation on the sign-in screen through a fallback join (Table A.1). Chapter 7 still credits the step with "the transitions it adds over their rules".

**The reframed RQ1 explanation counts witness locations, not constructs.** The headline sentence therefore mixes three units.

None of this overturns the conclusion as it now stands: "a starting point but an insufficient basis". That conclusion was narrowed to what the evidence carries. The honest reading is a careful in-sample measurement of one tool, and the thesis now mostly says so itself. What remains are the places where the abstract and Chapter 7 still say slightly more than that: N1, N2, N6 and REV-09.

### 4. Recommendation: **Minor Revision**

1. **The core argument now survives its strongest rival.** Both validated round-1 CRITICAL items are resolved in the body:
   - the RQ1 headline carries the definition and the 33/159/203 sensitivity wherever it appears;
   - RQ3 no longer rests a positive answer on a criterion that cannot fail.

   The post hoc Rima subset is labelled everywhere. The RQ4 overclaim and the "usable" claim are gone.
2. **Nothing new is critical, and every remaining item is local.**
   - N1: one phrase and one clause.
   - N2: re-key or rename a census unit, which is a script change and needs no new data.
   - N3: fill in placeholders.
   - REV-09: delete one sentence in Ch. 7, or explain the airbus pairs.
   - REV-02 and REV-16: add a comparator and the median to the abstract.

   None needs a new experiment. The supervisor can check all of them against this list without another full panel round.
3. **Length is the largest remaining task and is mechanical.** The body is 89 pp. against the ≤ 80 minimum, and most of the saving so far is relocation. Moving Table 6.1 (about 7 pp.) to an appendix, dropping Fig. 5.2 and folding Section 2.8 into 2.7.3 would reach the target. If the supervisor holds to ≤ 80 pp. and this is not done, REV-04 alone keeps the supervisor's first request unmet.
4. **Before submission, at a minimum:**
   - remove the author placeholders (N3);
   - rewrite the abstract's RQ1 sentence (N1, N2) and bring the abstract to about 250 words (REV-05), with the RQ3 comparator (REV-02) and the median (REV-16);
   - delete or justify the Ch. 7 sentence on "transitions it adds over their rules" (REV-09);
   - answer the blindness-to-tool question (REV-13);
   - cut to length (REV-04);
   - complete the AI-use statement, which is known to be in progress.

The AI-use statement is unchanged on purpose. It is counted once above as REV-10 (not addressed) and is not weighted again in this recommendation.
