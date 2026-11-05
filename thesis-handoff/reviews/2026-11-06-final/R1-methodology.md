## Methodology Review Report (Peer Reviewer 1), round 2 (verification)

Mode: re-review of the revised manuscript (`2026-11-06-final/manuscript.txt`, 117 pp., body pp. 8-96). Page numbers are the printed page numbers of the revised text. Quotes are verbatim and at most 15 words. I compared against my round-1 report and the round-1 manuscript, and I opened two repository files where noted (`thesis/generated-h2h.tex`, `thesis/ch4-evaluation.tex`, `thesis/ch6-discussion.tex`); findings that rest only on them are marked "repository evidence". I did not read any other seat's round-2 report. The AI-use statement is unchanged on purpose. I note once that it still does not name the model behind "a stronger model of the same assistant" (the gate in 5.3.7-5.3.8). That gap belongs to REV-10 and is not counted again below.

### Reviewer Identity
Empirical software engineering methodologist (ESEM/MSR): evaluation of tools against hand-built or LLM-built references, preregistration, threats to validity. Blind spot: Angular routing semantics.

### Overall Recommendation
Minor Revision

### Confidence Score
4. Core expertise on the evaluation design. Lower on whether the route-order and guard semantics are right.

Confidence is an uncertainty/scope disclosure only; it never changes consensus counts, severity, decision bearing, or arbitration.

### Calibration Status
`NOT_CALIBRATED`

### Criterion-Bound Judgements (round 2)
| Dimension / criterion | Criterion source | Judgement (r1 -> r2) | Evidence anchors | Rationale | Uncertainty or scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| Design fits RQ1, RQ2 | review_criteria_framework, methodology | MEETS -> MEETS | `text: p. 28 "a lower bound only relative to four assumptions"` | Measures unchanged. The assumptions behind the must tier are now listed, each with its counterexample class and the number of edges that depend on it. | The census of may reasons is the extractor's own report (N7). | no |
| Design fits RQ3 | methodology | PARTLY_MEETS -> PARTLY_MEETS (improved) | `text: p. 46 "RQ3 is not decided by one rule."` | The monotone acceptance rule is gone. Recovery, width and reference agreement are read together. Scope accuracy still has no reference independent of the analysis's relations. | The abstract's RQ3 sentence lost its self-reference caveat (N1). | yes |
| Design fits RQ4 | methodology | PARTLY_MEETS -> MEETS (as reframed) | `text: p. 75 "RQ4 is therefore a sanity check that witnesses map to source lines"` | RQ4 is reframed as a sanity check of the witness mapping, which this design can answer. | It is no longer a sensitivity measure. That is fine because the thesis no longer claims one. | no |
| Design fits RQ5 | methodology | PARTLY_MEETS -> PARTLY_MEETS | `text: p. 75 "The lists below count causes, not constructs"` | The three-way answer is in place. Constructs are still not counted per outcome. | Single annotator. | no |
| In-sample threat, out-of-sample status of the Rima subjects | validity | PARTLY_MEETS -> PARTLY_MEETS | `text: p. 70 "so on these subjects it is not out-of-sample"` | The first comparison on the Rima subjects is correctly called out-of-sample, and the second correctly is not. One sentence in 5.3.6 still over-generalises (N9). | Disclosure is good. There is still no unfitted test beyond the first Rima comparison. | no |
| Annotator validity (LLM reader, gate, author's 41) | measurement validity | DOES_NOT_MEET -> PARTLY_MEETS | `text: p. 74 "with the reading’s verdict in view, so not blind to it"` | Blinding status, the gate's change rates and a Wilson interval for 41/41 are now reported. No human or second-family reader was added. Whether the author saw the proposing tool is still a placeholder. | Validity is disclosed, not measured. | yes (placeholder) |
| Statistical estimation and reporting | statistical_reporting_standards | PARTLY_MEETS -> PARTLY_MEETS | `text: p. 73 "The intervals treat the sampled pairs as independent, although pairs cluster by site."` | Real-pair counts and the union definition were added, and the post hoc group is labelled. Clustering is disclosed but not handled. The precision ranges were computed but are not printed (N6). The mifos stratum sizes are not given. | No hypothesis tests, so there is no multiplicity issue. | no |
| Reproducibility | reproducibility | MEETS -> MEETS | `text: p. 51 "whose extractor commit was not recorded and whose node total is its only link"` | Generated macros, pinned commits and the historical groups are honestly marked. An Availability paragraph was added. | Its URL/DOI and licence are placeholders (N3). The oracle was not re-run. | no |
| Calibration of abstract, Table 7.1 and Ch. 7 against Ch. 5 | review_criteria_framework, claims | (not rated in r1) -> PARTLY_MEETS | `text: p. 96 "accounts for the transitions it adds over their rules on their own subjects"` | Most claims now match Ch. 5. The length cut removed two abstract caveats (N1, N2). One prohibited Ch. 7 claim survives (REV-09). | All fixes are wording. | yes |

Do not total, weight, average, or mechanically map these judgements to the recommendation.

### Summary Assessment
The revision works through the methodology roadmap seriously and mostly correctly. The changes are concentrated where they matter:
- The RQ3 accept-if rule that could not fail is gone (p. 46). RQ3 is now answered by recovery, scope width and reference agreement read together.
- RQ4 is demoted to a sanity check of the witness mapping everywhere it appears (abstract, pp. 46, 75, 81, Table 7.1).
- The Rima comparison carries "grouped after reading", a definition of relative recall, estimated real-pair counts and "does not rank the tools" in the abstract, 5.3.8 and Table 7.1.
- The author's 41 re-reads are now stated not to be blind to the model's verdict, with a Wilson interval.
- A density-matched chance baseline is given for the e2e hits.
- The must-tier soundness claim is stated relative to four named assumptions A1-A4 with edge counts.

What remains has three parts:
1. The length cut removed two caveats from the abstract. The 82.0 % reference precision now reads as if it were measured against truth (N1). "159 edges that always fire" states Claim 3.1 as established (N2).
2. Ch. 7 keeps the services claim that the editor ruled out (REV-09).
3. Three `[author: ...]` placeholders remain, one of them on the blinding of the author's re-read (N3).

The independence ceiling is unchanged: no blind human judgement of the must tier, no second human or second-family reader, and no scope reference outside the analysis's relations (X-01 to X-05 were not done). The thesis now states this ceiling plainly, so it limits how strong the claims can be. It does not block submission. Every remaining must-fix item is a sentence-level edit or the printing of figures already computed, so I recommend Minor Revision.

---

## Part 1. Verification of round-1 items

Status key: **A** addressed; **P** partly addressed; **N** not addressed. Where the editor gave an acceptance criterion, the status follows it and any residue is listed.

### 1a. My round-1 weaknesses (W1-W11)

| Item | Status | Revised text (p.) | What is done / what remains |
|---|---|---|---|
| W1 RQ3 criterion cannot fail; scope accuracy tested only against self-referential references | P | p. 46 "RQ3 is not decided by one rule."; p. 1 "Its screen sets are 1.7 to 18.7 times narrower than all screens" | **Done:** the accept-if rule is dropped. Width (1.7-18.7x, recomputed from Table 5.12 and correct) and the alfresco precision 82.0 % are in the abstract. Table 7.1 (p. 94) gives the reversal against the class join (92.3 %). **Remains:** (i) no reference outside the analysis's relations (X-03). Section 6.5 still lists it as future work. (ii) The abstract no longer says the reference applies the analysis's own relations, was built by the AI assistant, or falls below the simpler rule (N1). (iii) p. 46 calls the structural references "references that do not come from the attribution’s output alone". That is softer than p. 66, "The reference is not independent of the graph". |
| W2 Relative recall over a union; clustered sampling unit | P | p. 72 "Relative recall is a share of that union, not recall against all real pairs"; p. 73 "of which an estimated 1512 and 163 are real" | **Done:** (a) counts of real pairs per tool. (d) "similar" removed, both precisions given. Union definition in the abstract, text, Table 5.18 note and Table 7.1. **Remains:** (b) no site-level or clustered interval. The clustering is disclosed (p. 73: "The intervals treat the sampled pairs as independent, although pairs cluster by site."). (c) No absolute-recall check against the e2e pairs. The generated precision ranges are not printed (N6). |
| W3 Post hoc subgroup; tiny mifos strata | P | p. 1 "on five applications grouped after reading"; p. 73 "the pooled comparison does not rank the tools" | **Done:** "post hoc" / "after reading" wherever the without-mifos figures appear (abstract, p. 73, Table 5.18 note, Table 7.1). The pooled non-ranking is stated beside them. **Remains:** the mifos stratum sizes are still not given. p. 74 says only "The mifos estimates re-use those samples, restricted to the pairs that remain" (the repository record gave 7, 4 and 5 pairs). The abstract still leads with the post hoc group. No fresh mifos sample was drawn. |
| W4 LLM-as-annotator validity | P | p. 74 "with the reading’s verdict in view, so not blind to it"; p. 72 "one model family throughout, so the figures that rest on them measure consistency" | **Done:** blinding to the verdict stated. Gate change rates 3/45 and 10/114 reported (p. 88). Wilson 95 % interval for 41/41 is 91.4 %-100.0 %, which I recomputed and confirm. "as an AI model read them" in the abstract. **Remains:** whether the author saw the proposing tool is a placeholder (p. 88, N3). There is no blind human reader with kappa and no second model family (X-02). The observed change rate is not propagated into the intervals. The abstract does not mark the alfresco reference (82.0 %) as AI-built. |
| W5 Must tier fitted to panels; check cannot detect the relevant failure | P | p. 28 "The must tier is therefore a lower bound only relative to four assumptions"; p. 78 "nor the mechanical check is an independent proof of Claim 3.1" | **Done:** A1-A4, each with counterexample class and dependent edge counts (126 on A1, 0 on A2, A3/A4 stated as uncounted). 62 unread destinations. The toolbar is reported as one source of 125 edges in Table 7.1 (p. 93: "25 constructs yield 159 must edges, 125 from one toolbar"). Panel origin of the demotion rules stated (p. 81). **Remains:** no judgement by anyone outside the panels and no browser run (X-01). The round-1 abstract's "25 constructs ... one toolbar whose screen set is untested" was cut, and the abstract now says the edges "always fire" (N2). |
| W6 RQ4 close to non-informative, tuned on misses | A | p. 75 "RQ4 is therefore a sanity check that witnesses map to source lines"; p. 1 "Mutation testing only sanity-checks the witness mapping." | Reframed consistently. 272 candidates, 73 sampled, 6 excluded, 67 scored (Table 5.19, p. 74). Construction and harness tuning disclosed (pp. 46, 50, 75). Residue: two denominators are still used, 67/67 (p. 75, Table 7.1) and 45 of 45 (p. 81), although p. 75 says "The one denominator used for the headline is the scored mutants, 67/67" (N10). X-05 not done; that is acceptable now that sensitivity is no longer claimed. |
| W7 RQ5 partly tautological, single annotator | P | p. 75 "RQ5 is answered in three parts, not by one claim"; p. 75 "The lists below count causes, not constructs" | **Done:** three-way answer (tool's, application's, open) in 5.5.1 and Table 7.1. "The loss was the tool's" is limited to the classes found and fixed. The abstract names its unit: "Most causes of loss traced in the source are constructs a static reader can read." (p. 1). **Remains:** no construct count per outcome with an unclassified residual row. No second annotator. "A static reader could read this" was not fixed before the repairs, and that cannot be done retroactively. |
| W8 Pooled corpus figures are mostly mifos | P | p. 59 "Per application the median recovery is 40.2 % (range 14.3 %–100.0 %)"; p. 1 "Scope attribution recovers 66.7 % of the constructs assigned to it" | **Done:** median and range (recomputed from Table 5.7: 40.2 % from 14.3, 22.2, 34.6, 45.8, 93.2 and 100.0 %, correct). Selection not tool-blind (pp. 42, 86). The census share of mifos is given (p. 56: 1289 of 1657). **Remains:** the abstract still leads with the pooled 66.7 %, and 5.5.1 repeats it, although Table 6.1 calls the median "the primary summary" (N5). |
| W9 e2e containment has no chance baseline | A | p. 45 "by chance alone the graphs would hold 13.5 and 9.7 of those pairs" | Null given in 4.2, 5.3.5 (p. 68) and Table 7.1. Table 5.15 splits hits reached only through the shell scope (3 and 2). Optional: the binomial tail under that null is about 0.0015 (realworld, 19/19 at p = 0.71) and about 6e-5 (mifos, at least 19/22 at p = 0.443). So "the hits show coverage more than discrimination" (p. 68) is, if anything, too modest. |
| W10 Provenance gaps | P | p. 51 "whose extractor commit was not recorded and whose node total is its only link"; p. 45 "the public demonstration backend, which is not pinned" | **Done:** unpinned backend stated (pp. 45, 96). The e2e ordering caveat is stated in Table 6.1 (p. 83: "the archive cannot corroborate that order"). **Remains:** oracle not re-run at a9d29df, and no digest of the measured graph. p. 45 still says the rules "were written down before any log was read" without the archive caveat. "Committed before scoring" is not used there. |
| W11 Ablation levels reimplement earlier work | P | p. 66 "Both levels reimplement those mechanisms inside this extractor and are not runs of either tool." | **Done:** the caveat at 5.3.3. The abstract no longer says "Unlike the mechanisms of earlier work". **Remains:** Ch. 7 still generalises from the three airbus pairs, p. 96: "accounts for the transitions it adds over their rules on their own subjects". This is one application and three pairs, and Rima et al.'s own tool holds them (Table 5.18: 100.0 % relative recall on airbus; p. 70: the reference was generated from their tool's output). p. 70 also says "The service join places navigation no earlier mechanism can place." The editor marked the Ch. 7 sentence must-not (REV-09). |

### 1b. My round-1 minor issues

| Item | Status | Revised text (p.) | Note |
|---|---|---|---|
| m1 Abstract a full page, units mixed | P | p. 1, about 360 words (was about 455) | The unit is now named at most figures (edges, constructs, sites, screens, "real transitions"). The 82.0 % carries no unit ((site, screen) pairs). Still above the about 250 words REV-05 asked for. |
| m2 Table 4.5 to an appendix | A | p. 50 "Appendix A lists every correction, one row each, in Table A.1." | Done. |
| m3 Table 5.4 "Methods" count rule | A | p. 58 "the methods column counts only those" | Rule stated in the note. |
| m4 Compress Section 6.2 | N | Table 6.1 still runs pp. 82-88 | About 6.5 pages. Its content repeats Ch. 4-5 caveats. |
| m5 "similar precision" | A | p. 1 "at precision 72.6 % against 75.2 %" | Word removed, both numbers given. See N6 for their intervals. |
| m6 Define in-sample once | A | p. 1 "The tool was developed on this corpus, so the figures are in-sample" | Done. "Fitted" is used where the repair history justifies it (pp. 42, 83, 96). |
| m7 Table 5.18 note: repaired row post hoc, only misses re-read | A | p. 71 "only missed pairs were read, so it can only rise" | Done (now Table 5.17 note). |

### 1c. Roadmap items attributed to the methodology seat

| ID | Status | Revised text (p.) | Against the editor's minimum fix / acceptance criterion |
|---|---|---|---|
| REV-01 RQ1 headline | A (residue) | p. 56 "The small must tier is therefore largely a matter of definition"; p. 1 "33 without an assumed route order and 203 if every guard admits the user" | Acceptance met: the abstract, 5.1, 6.1 (p. 82) and Table 7.1 (p. 93) put the definition and the 33/159/203 sensitivity beside the small tier. (d) is met in Table 7.1 and 5.5.3. Residue: RQ1 in 1.2 (p. 10) carries no plain gloss of must. The abstract dropped the toolbar and 25-construct facts and says "always fire" (N2). The census limit (an always-passing guard still counts) appears only in 5.1. |
| REV-02 RQ3 cannot fail | P | p. 46 "RQ3 is not decided by one rule."; p. 1 "Its screen sets are 1.7 to 18.7 times narrower than all screens" | No positive answer rests on the monotone rule, and width is in the abstract. The reversal is only half there: the abstract gives 82.0 % without the class join's 92.3 % and without saying the reference applies the analysis's own relations (N1). Acceptance therefore not fully met. 59 % of k8s dashboard is in 5.3.2 (p. 64), not in the abstract or Table 7.1. |
| REV-03 Rima headline | A (residue) | p. 73 "a grouping formed after the results were read" | Acceptance met: the abstract cannot be read as absolute recall or a preregistered result. Residue: no mifos stratum sizes (W3). |
| REV-04 Length (R1 part: Table 4.5, 6.2) | P | Body pp. 8-96, about 89 pp. (47,700 words, was 51,406) | Table 4.5 moved to Appendix A. Table 6.1 not compressed. The ≤ about 80-page criterion is not met. This is primarily R0's remit. |
| REV-05 Abstract | P | p. 1 | About 360 words, not about 250. The limits sentence has in-sample and consumer use. It no longer has "non-independent references" (N1). |
| REV-07 RQ4 | A | p. 46 "not evidence of change-impact detection" | Demoted throughout. 45/45 was removed from the mutation table. Residue: 45 of 45 is still used in 6.1 (N10). |
| REV-08 One site and e2e baseline | A | p. 94 (Table 7.1) "yields 39.4 % of all edges"; p. 68 "would hold 9.7 of the 22 pairs by chance" | Done in Ch. 7 and 5.3.5. The revision correctly separates the edge-count driver (view-transaction.component.ts:135) from the pair-density driver (the shell's notifications tray). The roadmap had conflated them, and the abstract attributes the 6.5 % to the shell, which matches 5.3.8. |
| REV-09 Services claim (R1 W11 sub-fix) | P | p. 66 "are not runs of either tool"; p. 96 "accounts for the transitions it adds over their rules" | Reimplementation caveat present. The Ch. 7 clause the editor prohibited is retained, and the airbus pairs are not explained against their tool's output (see W11). |
| REV-12 RQ5 | P | p. 75 "RQ5 is answered in three parts, not by one claim" | Three-way answer done. Count constructs with an unclassified residual row: not done. |
| REV-13 AI-reader validity | P | p. 74 "with the reading’s verdict in view, so not blind to it"; p. 88 "[author: state whether the proposing tool was shown]" | Verdict-blindness, change rates and the 41/41 interval are done. Tool-blindness is a placeholder. The abstract marks the Rima figures as model readings but not the alfresco reference. |
| REV-14 Lower/upper bound | A | p. 28 "a lower bound only relative to four assumptions"; p. 30 "This is a design intent and not a property that holds." | A1-A4 with counterexample classes and counts. May tier as design intent, with the rules that under-approximate listed (p. 30, p. 90). Residue: "always fire" in the abstract (N2). |
| REV-16 Pooled is mifos | P | p. 59 median and range; p. 42 "per-application figures are the primary summary where the chapters give them" | Median and range in 5.3 and Table 7.1. Selection not tool-blind is stated. The abstract and 5.5.1 still lead with the pooled figure (N5). |
| REV-18 Availability | P | p. 50 "[author: archive DOI; a repository URL would name the extractor]" | Paragraph and licence column added. URL/DOI and the Rima licence status are placeholders (N3). |
| REV-22 Table notes (R1 part) | A (R1 parts) | p. 58 Table 5.4 note; p. 71 Table 5.17 note | My two notes are fixed. Residue outside my part: "runtime probe" (Fig. 1.1, p. 11) and "runtime route probe" (Fig. 4.2 note, p. 50) against "runtime route oracle" elsewhere. |
| REV-24 Provenance (should-fix) | P | p. 51; p. 83 "the archive cannot corroborate that order" | Risk stated. No oracle re-run, no digest. "Preregistered" kept on p. 45 without the caveat. |

### 1d. Should-fix extensions raised by this seat

| ID | Status | Note |
|---|---|---|
| X-01 Blind human or browser judgement of the 25 must constructs | N | Table 6.1, p. 88: "No human second reader checked it." |
| X-02 Blind second human reader of at least 60 pairs, kappa | N | Only the author's non-blind 41. |
| X-03 Scope reference outside the analysis's relations | N | Listed as future work, p. 91. |
| X-04 Clustered intervals, absolute recall, fresh mifos sample | N | Clustering disclosed only (p. 73). |
| X-05 Mutants from all syntactic sites | N | Not needed after the RQ4 reframing. |

These were optional. Leaving them undone keeps the ceiling the editor described: the soundness and scope-accuracy claims can be stated only as consistency with the author's and assistant's own readings. The revised body now says so in most places.

---

## Part 2. New issues introduced by the revision

### N1: The abstract's RQ3 precision lost its self-reference caveat in the cut
- **Problem**: The round-1 abstract said both references "apply the analysis's own relations" and that the first was completed from the graph's output. The revised abstract keeps only the alfresco precision. It omits that this reference applies the analysis's own relations, that the AI assistant built it, and that 82.0 % is below the class join's 92.3 %. A reader takes 82.0 % as precision against what the application does.
- **Why it matters**: This is the abstract sentence where REV-02's acceptance criterion had to land (blocking issue B2). The body (pp. 46, 66-67, 70, 96) carries the caveat, so the abstract now says more than Ch. 5.
- **Fix**: One clause, e.g. "against an AI-built reference that applies the analysis's own relations, 82.0 % (the per-class rule: 92.3 %)".
- **Severity**: Major (decision impact: it reopens a blocking item; the fix is small) | **Evidence Anchor**: `text: p. 1 "but its precision against a reference read from one application’s source is 82.0 %"` | **Confidence**: 5, direct comparison of round-1 and round-2 text.

### N2: "159 edges that always fire" states Claim 3.1 as established
- **Problem**: The thesis tests only a necessary condition of Claim 3.1 (p. 28). It holds only relative to A1-A4. 62 destinations are unread, and the reading of the tier is not independent (p. 78). The cut also removed the round-1 abstract's "25 constructs ... one toolbar whose screen set is untested".
- **Fix**: "159 edges classified as always firing (must), 125 of them from one toolbar".
- **Severity**: Minor (the 33/203 sensitivity sits beside it) | **Evidence Anchor**: `text: p. 1 "The corpus yields 159 edges that always fire"` | **Confidence**: 4, soundness-claim reporting.

### N3: Three author placeholders remain in the text
- **Problem**: p. 50 (twice, Availability) and p. 88 (Table 6.1). The p. 88 placeholder decides how much the 41/41 check can mean: if the author saw which tool proposed a pair, the check was not blind on either axis.
- **Fix**: Resolve all three before submission. The repository source is `thesis/ch6-discussion.tex:283` and `thesis/ch4-evaluation.tex:441` (repository evidence).
- **Severity**: Minor (must-fix for submission) | **Evidence Anchor**: `text: p. 88 "[author: state whether the proposing tool was shown]"` | **Confidence**: 5.

### N4: Ch. 7 drops the blinding caveat on the author's re-read
- **Problem**: 5.3.8 and Table 6.1 say the re-read was not blind and measures consistency. The conclusion calls it confirmation.
- **Fix**: "agreed with 41 of the 41 I re-read, with the model's verdict in view".
- **Severity**: Minor | **Evidence Anchor**: `text: p. 96 "of which I confirmed 41 of the 41 I re-read"` | **Confidence**: 5.

### N5: The primary summary is declared but not used
- **Problem**: Table 6.1 (p. 86) and 4.1.2 (p. 42) make the per-application median the primary summary. The abstract (p. 1) and 5.5.1 lead with the pooled 66.7 %, and the median appears only in 5.3 and Table 7.1.
- **Fix**: Give "median 40.2 % (14.3-100 %) per application" first in the abstract, then the pooled figure with its application count.
- **Severity**: Minor | **Evidence Anchor**: `text: p. 76 "Attribution: 66.7 % of its constructs are recovered."` | **Confidence**: 4.

### N6: Precision intervals for the head-to-head were computed but not printed
- **Problem**: The abstract and Table 7.1 give 72.6 % against 75.2 % as bare point estimates. The generated macros hold their Wilson-end ranges: 44.9 %-89.2 % (this extractor) and 48.8 %-89.1 % (theirs) on the five applications. They also hold ranges for the other rows (repository evidence: `thesis/generated-h2h.tex`, lines 6-49). The ranges overlap almost entirely and are about 45 points wide. Without "similar", two precise-looking numbers still invite a reading of equality.
- **Fix**: Print the ranges in 5.3.8 and Table 7.1. The estimated real-pair counts (1512 and 163) have equally wide ranges, so print those too.
- **Severity**: Minor | **Evidence Anchor**: `absence: Section 5.3.8, Table 5.18 and Table 7.1 — expected Wilson-end ranges for the precisions 72.6 % and 75.2 %; checked pp. 1, 72-74, 94 and thesis/generated-h2h.tex` | **Confidence**: 4, repository evidence for the unprinted values.

### N7: The may-reason census is the extractor's self-report but is used as an explanation
- **Problem**: Table 5.1 records the reasons the extractor itself assigns at each may witness. Nothing checks them per construct, and guard handling was itself a defect class. The abstract now explains the small tier by this census. 5.1 states "so a better reader could lift at most those to must". 6.1 calls the small tier "a matter of definition rather than a defect of the extractor" (p. 82). The "at most" was already in round 1, but the revision makes the census carry the RQ1 headline.
- **Fix**: Add "as the extractor records them" and drop "at most".
- **Severity**: Minor | **Evidence Anchor**: `text: pp. 55-56 "so a better reader could lift at most those to must"` | **Confidence**: 3, adjacent to the routing semantics I do not judge.

### N8: Section 4.2 softens what the structural references are and mis-cites the tool comparison
- **Problem**: p. 46 lists the two structural references among "references that do not come from the attribution’s output alone". That is accurate for alfresco only. p. 66 says the realworld reference "is not independent of the graph". The same sentence cites Section 5.3.6 for the comparison with Rima et al.'s tool, which is in 5.3.8.
- **Severity**: Minor | **Evidence Anchor**: `text: p. 46 "references that do not come from the attribution’s output alone"` | **Confidence**: 4.

### N9: In-sample labelling of the Rima subjects is inconsistent
- **Problem**: 5.3.7 (p. 70) correctly says the head-to-head on the Rima subjects runs the repaired extractor and "is not out-of-sample". 5.3.6 says every figure for Rima's subjects is out-of-sample, and the "Their seven subjects" row of Table 5.18 carries no in-sample label.
- **Severity**: Minor | **Evidence Anchor**: `text: p. 69 "Every figure is in-sample except those for Rima et al.’s subjects"` | **Confidence**: 5.

### N10: Two mutation denominators and an overstatement of the sample overlap
- **Problem**: p. 75 names 67/67 as "the one denominator", but 6.1 reports 45 of 45 (p. 81). Table 7.1 says the final sample "shares 46/73 mutants" with the tuned run. 4.3.2 says these share only a location (operator, file, line), and their destinations may differ (p. 50).
- **Severity**: Minor | **Evidence Anchor**: `text: p. 95 "the final sample shares 46/73 mutants with that run"` | **Confidence**: 5.

### N11: Small cross-reference and naming slips from the cut
- **Problem**: 1.2 says the thesis "lists what it approximates (Section 2.6.2)", but the list is in 6.3 and Appendix B (p. 11). 3.1 cites Section 5.5 for the demotion-rule mutation sweep, which is reported in Table A.1 (p. 30). The abstract's "placing navigation inside services, adds 2.0 % of the sites" counts 36 sites that p. 66 places "in a service, guard or effect", so the guard and effect stand-ins are included. The method is also named "runtime probe" and "runtime route probe" as well as "runtime route oracle" (pp. 11, 50).
- **Severity**: Minor | **Evidence Anchor**: `text: p. 11 "lists what it approximates (Section 2.6.2)"` | **Confidence**: 5.

No new issue was found in the generated tables: every cross-table figure I recomputed is consistent. I checked the 159 = 97 read and passed + 62 unread, 142 must edges added, the 1.7-18.7 width ratios, the 40.2 % median, 38.6 %, 36/1802 = 2.0 %, the Wilson interval for 41/41, the e2e chance expectations, 73 - 22 = 51 scored without attribution, and 14 + 20 + 11 = 45. The cut did not break the flow of Ch. 5. Ch. 6.6 is now two sentences, which is fine.

---

## Part 3. Recommendation

**Minor Revision.** Reasons:
1. The decision-bearing methodological defects from round 1 are corrected in the body:
   - the RQ3 rule that could not fail is gone;
   - RQ4 is a sanity check throughout;
   - the post hoc subgroup is labelled wherever it appears;
   - relative recall is defined as a share of a union, with real-pair counts;
   - the blinding of the author's re-read and the gate's change rates are reported;
   - the e2e hits have a chance baseline;
   - the must tier is a lower bound only relative to A1-A4, with counts.
2. What remains is text and the printing of figures already computed:
   - N1 and N2 (abstract caveats lost in the cut);
   - the Ch. 7 services clause (REV-09);
   - three placeholders (N3);
   - the median-first summary (N5);
   - the mifos stratum sizes and the precision ranges (W3, N6).
   None needs new analysis or a new experiment, and I do not need to see the full manuscript again. A check of the abstract, 4.2, 5.3.8, 6.1 and Ch. 7 against this list is enough.
3. The independence ceiling (X-01 to X-03) remains. Every check of the must tier, the scope references and the pair readings still passes through the author or one model family. The revised text now states this in 5.3.4, 5.5.3, Table 6.1 and Ch. 7, so the claims are calibrated to that evidence and not beyond it. It caps how strong the soundness and scope-accuracy claims can be. It is not a reason to withhold submission.

### Must fix before submission (all sentence-level)
1. Restore the self-reference / AI-built caveat and the class-join comparator next to 82.0 % in the abstract (N1, REV-02).
2. Delete or qualify "accounts for the transitions it adds over their rules on their own subjects" (p. 96), and "no earlier mechanism can place" (p. 70) (REV-09, W11).
3. Resolve the three `[author: ...]` placeholders (N3, REV-13, REV-18).
4. "always fire" -> "classified as always firing", and restore "125 from one toolbar" in the abstract (N2, REV-01).
5. "I confirmed" -> "agreed, with the model's verdict in view" (N4).
6. Give the mifos stratum sizes behind 6.5 % / 80.0 % (W3, REV-03), and print the generated precision ranges (N6).
7. Put the median first in the abstract, or drop the claim that it is the primary summary (N5, REV-16).
8. Use one mutation denominator or label both in the same place. Write "at the same location" in Table 7.1 (N10).

### Strengths retained through the cut
- The correction ledger is intact as Appendix A (Table A.1, pp. 105-111), including the corrections that made figures worse.
- Negative results stay visible: A2 failed (p. 67); two of four and two of three Rima predictions failed (pp. 71, 73); and 6.5 % on mifos is in the abstract.
- Figures remain generated. I found no inconsistency between the abstract, Ch. 5 tables and Table 7.1 in the numbers themselves, only in their caveats.
- The closing claim stays calibrated, p. 96: "a declared route table is a starting point ... but not a sufficient one".

### Questions for the author
1. In your 41 re-reads, was the proposing tool visible (p. 88 placeholder)?
2. What are the stratum sizes behind the mifos precision of 6.5 % and 80.0 %?
3. How does Rima et al.'s tool hold the three airbus reference pairs that only your service join reaches (Table 5.18, airbus recall 100.0 %)?

### Item counts (round-1 weaknesses, minor issues, roadmap items and should-fix extensions of this seat)
| Group | Addressed | Partly | Not |
|---|---|---|---|
| Round-1 weaknesses W1-W11 (11) | 2 | 9 | 0 |
| Round-1 minor issues (7) | 5 | 1 | 1 |
| Roadmap items attributed to R1 (15) | 6 | 9 | 0 |
| Should-fix extensions X-01 to X-05 (5, optional) | 0 | 0 | 5 |
| **Total (38)** | **13** | **19** | **6** |

The groups overlap by design: each W-item maps to one or more REV-items. Of the 6 "not addressed", 5 are the optional X-extensions. The one non-optional item is the compression of Section 6.2.

Recommendation: Minor Revision
