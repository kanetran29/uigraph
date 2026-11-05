# Peer Review Report: Journal-Fit Reviewer (EIC seat)

## Manuscript Information
- **Title**: Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications (D. K. Tran, Aalto MSc thesis, 5 Nov 2026, 124 pp.)
- **Review date**: 2026-11-05
- **Review round**: 1 (single-call review; the sprint-contract and Phase 1 blind-commitment steps of the role file do not apply, as the dispatcher records)
- **Read**: manuscript.txt in full for the abstract, AI-use statement, Ch. 1, 3-7 (Ch. 2 and Table 4.5 skimmed). Cross-checked against cards.md only. No repository files were opened, so claims about repository content are taken from the text.

## Reviewer Information
- **Role**: Journal-Fit Reviewer. Configured identity: professor of software engineering at a Nordic university, examiner of Aalto CS master's theses, Aalto 1-5 grading.
- **Review focus**: (1) RQ clarity and whether they are answered at master's scope; (2) whether the contribution is the thesis's own; (3) the supervisor's 4 Nov requests; (4) whether abstract and Ch. 7 claims match Ch. 5, and whether 124 pages is justified. Blind spot (declared): estimation and analysis semantics in detail.

## Overall Assessment

### Overall Recommendation
**Major Revision.** The substance reaches master's level and is unusually honest about its limits. As submitted, the text is not examinable at its present length, and several headline claims in the abstract and Ch. 7 are stronger than Ch. 5 supports. All of this is repairable by cutting, restructuring and re-wording, without new experiments. For the Aalto 1-5 scale this is a signal, not a computed grade: on current evidence the work would sit around 3-4 if the repairs are made, and the first grade-limiting factor is readability, not content.

### Confidence Score
4. SE thesis scope, RQ structure and claim-versus-evidence consistency are within my area. Estimation details (Wilson bounds, strata) and dataflow semantics are not, and I make no finding that depends on them.

### Calibration Status
`NOT_CALIBRATED`

### Criterion-Bound Judgements

| Dimension / criterion | Criterion source | Judgement | Evidence anchors | Rationale | Uncertainty / scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| RQ clarity and answerability at master's scope | EIC card focus (1) | PARTLY_MEETS | text: p.10-11 "RQ3. How does scope attribution affect the recovered share and precision" | Five RQs are stated clearly and mapped to measures (Table 4.2). RQ4 is answered by a test that is close to guaranteed by construction (W6). RQ5's headline answer is stronger than its evidence (W3). | RQ2/RQ5 depend on the loss-rule order, which the thesis itself declares part of the measure. | yes: revision of wording of RQ4/RQ5 answers |
| Contribution is the author's own, and correctly scoped | EIC card focus (2) | PARTLY_MEETS | text: p.12 "The measurement, which is the main contribution"; title (W2) | The measurement and instrument design are clearly the author's. The title and abstract foreground scope attribution, which the thesis's own ablation shows adds little over earlier mechanisms on most subjects. | The author's AI-assisted authorship is declared, but not attributed per contribution (W5). | yes |
| Supervisor request: shorten considerably | Supervisor, 4 Nov | DOES_NOT_MEET | absence: whole thesis, body pp.8-115 (W1) | Body is about 108 pages; the same limits and in-sample caveat recur in at least six places. | The page count of the next draft is not known. | yes |
| Supervisor request: abstract one page | Supervisor, 4 Nov | MEETS (page), PARTLY_MEETS (readability) | text: p.1 "Three results stand out." (W7) | Fits on p.1 but is about 445 words and carries 20+ figures and several nested qualifications. | | yes (readability) |
| Supervisor request: AI-use statement precise | Supervisor, 4 Nov | PARTLY_MEETS | absence: pp.2-3, no tool name or version (W5) | Thorough about roles, but never names the tool or model, and the scope of prose assistance is vague. | | yes |
| Supervisor request: abbreviations | Supervisor, 4 Nov | PARTLY_MEETS | table: p.4 abbreviation list (Minor Issues) | List exists. It omits terms used in text (Ajax, NgRx, SPIN). | | no |
| Supervisor request: section 1.2 aims only | Supervisor, 4 Nov | DOES_NOT_MEET | text: p.10 "This section states what each asks and how it is answered." (W4) | 1.2 holds method descriptions, scope limits and a study-overview figure. | | yes |
| Supervisor request: figures and tables fixed | Supervisor, 4 Nov | PARTLY_MEETS | figure: Fig. 4.2 and Fig. 1.1; table: Tables 5.1, 5.7, 7.1 (W8) | Terminology differs between figures and text; float order and naming inconsistent; Table 7.1 mixes denominators. | I reviewed the extracted text, not the rendered layout, so spacing and overflow are unassessed. | partly |
| Claims in abstract and Ch. 7 match Ch. 5 evidence | EIC card focus | PARTLY_MEETS | W3, W4(novelty), W9 | Most numbers match exactly (checked: 66.7 %, 20/48, 43.2 to 90.9 %, 82.0 %, 159/25, 6.5 % vs 80.0 %). Three claims are overstated or internally contradicted. | | yes |

### Summary Assessment
The thesis builds a static extractor for Angular routing and measures, construct by construct, how much navigation it recovers on six pinned open-source applications. It proposes "scope attribution", a dataflow analysis assigning navigation sites to the screens they can fire from. It also compares against Rima et al.'s tool on thirteen applications. Its strongest points are the explicit measurement design, the preregistered out-of-sample comparison, and candid reporting of its own weaknesses (non-independent harness, in-sample corpus, reference completed from tool output). Its main problems for an examiner are non-methodological. First, the document is far longer than its argument needs: the body is about 108 pages, roughly 43,000 words, with Chapter 5 alone at 28 pages and Table 4.5 at 8. Second, section 1.2 is not aims-only. Third, the title and abstract advertise scope attribution, while the thesis's own ablation shows most of its measured gain comes from mechanisms that earlier work already has. Fourth, three headline claims go beyond the evidence: "the loss was the tool's", "no earlier work places navigation inside services", and the 94.1 % versus 10.2 % comparison. Recommend Major Revision, driven by length and claim calibration.

## Strengths

### S1: Exceptional transparency about validity
**Evidence Anchor**: text: p.2 "The extractor built in this thesis and the evaluation harness were written with the help of an AI coding assistant."
The thesis states its in-sample status, the post-hoc nature of several groupings, the non-independence of the mutation harness and of the reference, and lists every protocol correction (Table 4.5). This is above the usual master's standard, and an examiner can trust the figures to mean what the notes say.

### S2: Clear RQ-to-measure mapping
**Evidence Anchor**: table: Table 4.2, p.63, "Reported in" column for each of the 11 measures
Each ratio has one name, numerator, denominator, RQ and section. Ch. 5 follows RQ order. This is a good reading aid and should survive the shortening.

### S3: A genuine out-of-sample, preregistered comparison with a real third-party tool
**Evidence Anchor**: text: p.82 "None of the seven was used to develop the extractor, so this is the thesis's only out-of-sample measurement."
Running the other group's tool (section 5.3.8) and stating that the pooled mifos figure "does not rank the tools" is the most informative part of the evaluation for a reader outside the immediate subfield.

### S4: Scope-honest conclusion statement
**Evidence Anchor**: text: p.115 "a declared route table is a usable starting point for static navigation extraction, but not a sufficient one."
The final sentence of Ch. 7 is calibrated and follows from the evidence. Other claims should be brought to this standard (W3, W4, W9).

## Weaknesses

### W1: Length and repetition do not fit a master's thesis; the supervisor's main request is unmet
**Problem**: The body runs pp.8-115 (about 108 pages; roughly 43,000 words in the .tex chapters, of which Ch. 5 is about 11,700 and Ch. 4 about 7,900). The same material recurs. The in-sample caveat and the "partly completed reference" caveat appear in the abstract, 1.2, 4.1.2, the intro of Ch. 5, 5.3.6, Table 6.1 and Ch. 7 (twice). Oshima and Kishi / Rima et al. are described in 1.1, 2.4, 5.3.3, 5.3.6 and 5.3.7. Table 4.5 alone takes pp.54-62, and the protocol-correction history (4.3.2) is a methods-record that belongs in an appendix or the repository. Table 6.1 and Table 7.1 restate Ch. 5.
**Evidence Anchor**: text: p.54-55 "Table 4.5 lists every correction, one row each, in the order the chapters record them"
**Why it matters**: A reader cannot find the argument, and an examiner has to reconcile figures across 6-7 restatements. This is the supervisor's first and most important request.
**Suggestion**: Target about 70-75 body pages. Concretely: (a) move Table 4.5 and 4.3.2 to an appendix, keeping three lines in the body; (b) cut Ch. 2 to the related work that Table 2.1 and section 2.4 actually use, and fold the reactive-programming and mutation-testing background (2.8, 2.9) into one page each; (c) say each caveat once in 6.2 and refer to it elsewhere; (d) make Ch. 5 report each RQ in 2-3 pages with the tables, and move the per-construct audit prose (5.3.4 bullet lists, 5.3.7-5.3.8 reading procedure) to an appendix; (e) delete Table 7.1's "Key figures" and "Main limit" columns, which duplicate Ch. 5/6.
**Severity**: Major
**Confidence**: 5 - core expertise: thesis examination

### W2: Title, abstract and chapter order foreground an analysis that the thesis's own evidence shows to be a modest, partly-prior contribution
**Problem**: The title and abstract present scope attribution as the thesis's proposal. Section 1.3 says the analysis is "proposed as a modest extension" and the measurement "is the main contribution". The ablation (Table 5.13/5.14/5.16) shows the shell rule (rooted) and outlet descent, which earlier work has, produce most of the recovery. On realworld rooted holds 94.7 % of reference pairs against 100 % for full, and on mifos the outlet level holds 19 end-to-end pairs, as many as full. The step the thesis adds (service join) is 36 sites, 2.0 % of the corpus total, and the analysis is implemented over three of four input relations. Ch. 7 then lists four equal contributions with the extractor first.
**Evidence Anchor**: text: p.12 "The measurement, which is the main contribution, is set up in Chapter 4"
**Why it matters**: An examiner will grade against what the title promises. Mismatch between stated contribution and title is a common reason for a lower grade, even when the work is sound.
**Suggestion**: Either retitle toward the measurement (for example a measurement of static navigation extraction for Angular, with scope attribution as the proposed analysis), or reorder Ch. 1, the abstract and Ch. 7 so that one contribution is stated as primary, and consistently. State once, early, that most of the recovery comes from existing mechanisms and that the new part is the service join plus a precise formulation.
**Severity**: Major
**Confidence**: 4 - core expertise: thesis/contribution assessment

### W3: Abstract and Ch. 7 headline for RQ5 ("the loss was the tool's") exceeds what Ch. 5 supports
**Problem**: The abstract says almost every traced cause "is a construct a static reader can read, so the loss was the tool's". Ch. 5 shows (a) attribution, the largest loss category, still has 151 of 454 constructs unrecovered, and that remainder "mixes tool gaps with components no screen may render, and no measurement separates them"; (b) the opposite conclusion holds for the must tier, where 1631 of 1657 may-only constructs "sit behind" application decisions (Table 5.1), so there the loss is the application's; (c) Ch. 7 itself limits the RQ5 answer to "a statement about classes, not every lost construct". The abstract carries none of these limits.
**Evidence Anchor**: text: p.88 "no measurement separates them."
**Why it matters**: The abstract is what most readers see. RQ5 asks a binary question (application or tool) and the abstract gives one answer where the thesis gives two, depending on the tier.
**Suggestion**: Reword the abstract and Ch. 7 RQ5 row to the two-sided finding: for the node and class losses the tool was at fault and the final version reads them; for the deterministic tier the applications' own guards and branches decide; for the attribution remainder the question is open.
**Severity**: Major
**Confidence**: 4 - claim-versus-evidence consistency is within my remit

### W4: Section 1.2 is not "aims only"
**Problem**: Section 1.2 (pp.10-13) states the RQs, then explains how each is measured and the classification rule for defect classes, then lists five scope limits (several containing figures-level detail such as "one comparison, on seven applications"), and includes Figure 1.1 with a full method-to-RQ mapping. The supervisor asked for aims only.
**Evidence Anchor**: text: p.10 "This section states what each asks and how it is answered."
**Why it matters**: Direct non-compliance with a stated request; the detail repeats Ch. 4.
**Suggestion**: Keep 1.2 to a short aim statement plus the five RQs as one-sentence questions. Move the "how answered" paragraphs to Ch. 4 (they are already there as 4.2), the scope limits to a short 1.3, and Figure 1.1 to Ch. 4 where it can sit with Figure 4.1 (the two overlap).
**Severity**: Major
**Confidence**: 5 - directly checkable against the supervisor's request

### W5: The AI-use statement does not identify the tool and is imprecise about prose assistance
**Problem**: The statement never names the assistant, model family or version, even though it relies on "a stronger model of the same assistant" and on "two runs of one model". "Used to draft and edit prose, which I then revised" does not say which chapters, or how much. The statement also mixes a declaration with evaluation-method content (three roles, the files `results-must/review.json`, the red-team panels), which belongs in Ch. 4. It is about 1.3 pages.
**Evidence Anchor**: absence: pp.2-3 AI-use statement — expected the name and version of the assistant and which chapters it drafted; checked pp.2-3, Section 4.3.2, Section 5.3.7-5.3.8
**Why it matters**: The supervisor asked for precision. An unnamed tool and unspecified prose share are exactly what a reader cannot verify, and the thesis also uses the assistant as an annotator (reading 263 pairs, the alfresco reference, the must-tier reading) so identity matters for replication.
**Suggestion**: Reformat as a table with the columns: activity (code, harness, evaluation reading, literature search, prose), tool and version, chapters or artefacts affected, human check applied. State the share and nature of prose assistance. Move the evaluation-role description to 4.3 and refer to it.
**Severity**: Major
**Confidence**: 4 - requirement is explicit; Aalto policy wording not checked

### W6: RQ4 is answered by a test that cannot fail, so the RQ adds little
**Problem**: The thesis itself states that the mutation operators are scored "only at constructs the graph already represents in the simplest form the extractor reads", that rename detection is "close to guaranteed by construction", and that the harness was corrected after misses were read. Result: 100 % detection (67/67, or 45/45 without rename). The conclusion is "the graph responded to every scored change in the constructs it represents".
**Evidence Anchor**: text: p.87 "its detection is close to guaranteed by construction"
**Why it matters**: A full RQ with its own measure (Table 4.2), a section, a figure and two tables, answered by a result the author concedes is close to tautological, is poor use of 8+ pages in a thesis already too long.
**Suggestion**: Demote RQ4 to a sanity check inside Ch. 4/5 (one paragraph, one table), or reformulate it to ask something the test can refute (for example detection rate for mutants chosen without conditioning on graph content, with the exclusion count as the result).
**Severity**: Major
**Confidence**: 4 - RQ/measure fit is in scope; mutation-testing internals are the methodologist's seat

### W7: Abstract is a result table in prose and is hard to read
**Problem**: The abstract is about 445 words and carries over 20 figures and nested qualifications (for example "most of them on one application and almost all as possible rather than certain transitions"; "Both references apply the analysis's own relations, and the first was partly completed from the graph's output and guided two repairs"). It meets the one-page limit only through density. It also leaves terms undefined for a reader who has not read the thesis (loss rules, must/may, "off the shell").
**Evidence Anchor**: text: p.1 "Three results stand out. First, almost no navigation can be extracted as a deterministic transition"
**Why it matters**: The supervisor asked for a one-page abstract and improved readability; an abstract should be skimmable.
**Suggestion**: Cut to about 250 words: problem, method, three findings with at most one number each (66.7 % attribution recovery; 159 must edges from 25 constructs; the Rima comparison with the without-mifos qualifier), one sentence on limitations (in-sample, non-independent references). Put the detailed caveats in Ch. 6.
**Severity**: Minor
**Confidence**: 5 - checkable against the supervisor's request

### W8: The headline comparison with Rima et al. is presented without its post hoc status
**Problem**: The abstract and Table 7.1 give "94.1 % ... against 10.2 %" for "five corpus applications". Table 5.19's note says the row without mifos was added after reading and that the corpus-level figure, which mifos decides, "does not rank the tools". The abstract does not say why mifos is excluded or that the group was formed post hoc, and it gives 6.5 % precision on the largest application in the same sentence without connecting them.
**Evidence Anchor**: text: p.85 "the row without mifos was added after reading"
**Why it matters**: The card's concern: a favourable subgroup chosen after reading, then used as the lead figure. The thesis is honest in Ch. 5, but the abstract's wording invites the reader to take 94.1 % versus 10.2 % as the result.
**Suggestion**: In the abstract and Ch. 7, state that the five-application figure is a post-hoc subgroup that excludes mifos, give the mifos result next to it as the opposing case, and say the comparison does not rank the tools.
**Severity**: Major
**Confidence**: 4 - claims-versus-evidence; sampling validity is Reviewer 1's remit

### W9: The novelty claim "no earlier work places navigation inside services" conflicts with the thesis's own airbus evidence
**Problem**: The abstract and Table 7.1 say scope attribution, unlike earlier mechanisms, places navigation inside services ("Only it places navigation inside services"). In 5.3.7 the 3 pairs by which full beats outlet are all on airbus and arise from navigation inside an injected router service. The same section says Rima et al.'s reference pairs were generated from their tool's output, so "their tool holds every pair by construction". If so, their tool did produce those service-based pairs. The thesis also says in 2.4 that the published chapter of Rima et al. "was not available to this review and may differ", so the claim rests on a specification and an anonymised manuscript.
**Evidence Anchor**: text: p.83 "all on airbus, where the navigation runs inside an injected router service" and p.82 "their tool holds every pair by construction"
**Why it matters**: A novelty claim contradicted by the thesis's own data, or at least unexplained, weakens the one claim that distinguishes the proposed analysis from earlier mechanisms.
**Suggestion**: Reconcile explicitly: state how Rima et al.'s tool reaches the airbus pairs (for example via a different mechanism, or via the first callback rule), then restate the claim narrowly (for example "the specification of Rima et al. does not describe following calls into services") or drop "Only it". Mention in the abstract that the claim is based on their specification.
**Severity**: Major
**Confidence**: 3 - static-analysis literature positioning is adjacent to my area; the Domain reviewer is better placed

### W10: The deterministic-tier result is largely fixed by the author's demotion policy
**Problem**: Ch. 5.1 concludes that the small must tier is "mostly a property of how these applications navigate, not of the extractor". But Table 3.2 shows the tier is defined by a conservative policy, set by the author with AI-panel input: any guard, `await`, branch, callback, or possibly-cancelling later navigation demotes an edge, and navigating to the current URL is "held at may as a matter of policy, the safe side". Table 5.1 then counts a guard that always lets navigation through as a guard. A finding of "1.4 % must conversion" is therefore partly a restatement of the definition of must.
**Evidence Anchor**: text: p.33 "held at may as a matter of policy, the safe side" and p.66 "mostly a property of how these applications navigate, not of the extractor"
**Why it matters**: RQ1's answer is the thesis's first result. The reader needs to know how much of the answer is empirical and how much definitional.
**Suggestion**: Add one sensitivity line next to the RQ1 answer: the must count under the weakest defensible policy. The thesis already has one such figure (all guards assumed to pass raises the tier 159 to 203 edges, p.95); report an equivalent at the construct level and state in the abstract that "almost none" is relative to a deliberately strict definition. Estimation details I leave to Reviewer 1.
**Severity**: Major
**Confidence**: 3 - I assess how the claim is worded, not the policy's analytical validity

### W11: Figures and tables are inconsistent in naming and mixed in denominator
**Problem**: (a) The fifth method is "runtime route oracle" in Ch. 4 and 5 but "runtime probe" in Figure 1.1 and Figure 4.2's note; "test sources" and "test-source cross-check" also differ. (b) Applications are named `k8s dashboard`, `k8sdash`, `kdash`, `openMF/web-app` and `mifos` in different tables. (c) Table 7.1 quotes "45/45 detected" (rename excluded, 14+20+11) next to "Of 51 mutants both graphs can score" (all operators), while Table 5.20/5.21 give 67/67; Table 5.17 repeats "45/45" unlabelled. (d) Tables 4.2 and 4.3 are placed after the chapter summary and after Table 4.5; Table 6.1's first row is orphaned at a page bottom. (e) Table 5.7 has a two-level header that is hard to parse; Table 5.5 uses unexplained abbreviations in column heads (rw, alf, gf).
**Evidence Anchor**: figure: Figure 4.2 note p.52 "The fifth method, the runtime route probe, is not drawn"
**Why it matters**: The supervisor asked for figure and table fixes; consistent denominators matter because a reader will cross-check 45 against 67.
**Suggestion**: Fix one name for each method and application; define the 45/45 denominator wherever it appears or use 67/67 with the rename row marked; reorder floats; widen Table 5.7 or split it. I could not check the rendered layout, only the extracted text.
**Severity**: Minor
**Confidence**: 4 - consistency checked against text; layout unverified

## Detailed Comments

### Journal Fit (venue: Aalto master's thesis, CS)
The topic, program analysis for web UI testing, fits the programme and the supervisor's field. The scope (one framework, six applications, five methods) is ample for a master's thesis; the problem is volume, not scope. For a reader with only the abstract, the contribution is not clear (W2). The depth of evaluation is closer to a doctoral chapter than to a master's thesis, which supports a substantial cut.

### Originality
Original elements: the construct-by-construct loss accounting, the preregistered comparison on Rima et al.'s subjects with a run of their tool, the anchored-edge representation (Claim 3.2), and the service join. The scope-attribution dataflow formulation is a re-statement of mechanisms the thesis itself shows to be mostly present in earlier work. Positioning is careful (2.4), but see W9.

### Significance
Useful to people building test generation and agent tools for Angular, but the thesis itself says that consumer benefit is not measured, and mifos shows over-approximation at 6.5 % precision. Significance is moderate and honestly stated; the abstract should keep that tone.

### Structural Coherence
RQ order, Table 4.2 and Ch. 5 sections line up well. Weak links: 1.2 mixes aims with method (W4); Ch. 6 re-explains Ch. 5; Ch. 7 reproduces Ch. 5's figures in Table 7.1. RQ2 and RQ5 are both answered from the loss classification and could be one RQ.

### Title & Abstract
Title does not match the stated primary contribution (W2). Abstract: one page but too dense (W7), omits limits on RQ5 (W3) and on the Rima comparison (W8). Numbers I spot-checked against Ch. 5 all match.

### Conclusion
Ch. 7 is complete and honest about open work. Contributions list is fair, but ordering contradicts 1.3. "What remains open" is a good paragraph, though long. Table 7.1 is the right idea, with too much content per cell.

## Questions for Authors
1. Which contribution is primary: the measurement or scope attribution? Would you accept a title that says so?
2. How does Rima et al.'s tool produce the three airbus pairs that you attribute to the service join, if the tool's specification does not follow calls into services?
3. What is the must-tier size under the weakest defensible demotion policy, expressed as a construct-level conversion rate?
4. Can Table 4.5 and sections 5.3.4-5.3.8 reading procedures move to an appendix without losing any claim made in the body?
5. Which tool and version did you use, and which chapters did it draft?

## Minor Issues
- **Abbreviations (p.4)**: the list includes MVC, JSX, JSP and ICU, each used once or twice, but omits Ajax, NgRx, SPIN, and SWE-bench; "LLM" appears only in titles and in the prose "large language model". Either drop single-use items or add the missing ones.
- **Language**: sentences such as "The categories also interact, in both directions" and "A surprising figure is checked against its inputs before it is written down" are clear, but many sections use six-clause sentences with several parenthetical section references; split them.
- **Cross-references**: section references are heavy (several per paragraph in Ch. 5). Cut references that only point to the next paragraph.
- **Chapter 1 summary text (1.3)** calls scope attribution a "modest extension", whereas the abstract uses stronger language; align (see W2).
- **Table 2.1** splits across pages; consider a single page or a trimmed version.

## Recommendation (one line)
Major Revision: cut the body to roughly 70-75 pages, restore an aims-only 1.2, name the AI tool precisely, and bring the abstract and Ch. 7 claims on RQ5, the Rima et al. comparison and the service-join novelty into line with Ch. 5.
