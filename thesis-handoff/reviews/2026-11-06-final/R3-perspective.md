## Perspective Review Report (Peer Reviewer 3): re-review, verification round

**What I read and checked.** This is a single-call re-review with no sprint contract.
- **Read in full:** the revised `manuscript.txt` (117 pp.), my round-1 report, the editorial roadmap and my approved card.
- **Rendered figures:** six pages of `thesis/thesis.pdf` (printed pp. 11, 50, 52, 60, 62 and 82), to check figures and layout. This PDF dates from 5 Nov 22:47, has 117 pages and matches the text.
- **Checked against the repository:**
  - the root `LICENSE` is MIT;
  - line 27 of `rima/PREREGISTRATION.txt` reads "the repository has no licence";
  - `thesis/references.bib` has no block of unchecked sources;
  - the licence files of the six corpus checkouts match Table 4.1.
- **Opened only for orientation:** `ai-use-draft.tex`, to note what the pending rewrite must cover.
- **Not read:** the other seats' round-2 reports.

Page numbers are the printed ones. Quotes are at most 15 words.

### Reviewer Identity
I am an industrial researcher in test automation and in LLM agents that drive web UIs. I read the thesis as the engineer who is handed this graph to feed a test generator or a UI agent. I am an outsider to formal definitions.

### Overall Recommendation
**Minor Revision**

### Confidence Score
4. This is an uncertainty disclosure only. I am least sure how the supervisor will weigh 89 body pages against "shorten considerably".

### Calibration Status
`NOT_CALIBRATED`

### Summary Assessment
The revision fixes what I cared about most: the gap between what is measured and what is implied.
- **"Usable" is gone.** The abstract now ends "consumer use is not measured".
- **The tiers are told apart.** Chapter 7 separates the may tier, a candidate generator, from the must tier of 25 constructs.
- **The framing has changed.** The title and Section 1.1 now make the measurement the main contribution. They give the service join its true size: 36 sites, 2.0 %.
- **The Rima comparison is labelled.** The abstract marks the "without mifos" group as formed after reading and says the pooled comparison does not rank the tools.
- **RQ4 is demoted** to a sanity check.

The remaining open items in my remit are smaller:
- runtime cost is still unmeasured;
- the repository URL or DOI is still missing;
- no consumer view of the mifos noise;
- the workspace-library limit is in Table 7.1 but not stated as a scope condition;
- the abstract is 366 words, not about 250;
- the body is 89 pages against a target of about 80.

The revision also adds problems:
- four author placeholders are left in the text, among them "[author: confirm ...]" (pp. 50, 52, 88);
- the new chance baseline for the end-to-end check is applied only after the repairs;
- the abstract leads with the pooled 66.7 %, although the thesis names the per-application median as its primary summary;
- the AI-use statement, unchanged as intended, still carries two statements that the repository contradicts.

None of these needs new experiments.

---

## Part 1: Verification of round-1 weaknesses and roadmap items

Each round-1 weakness of mine is mapped to the roadmap item that carries it, so that each unit is counted once.

| Roadmap item | My round-1 ref | Status | Revised text (page) | What remains |
|---|---|---|---|---|
| REV-01: RQ1 must-tier headline | W4 (part) | **Addressed** | Abstract: "The corpus yields 159 edges that always fire, 33 without an assumed route order" (p. 1). Section 5.1: "The small must tier is therefore largely a matter of definition" (p. 56). Table 7.1: "25 constructs yield 159 must edges, 125 from one toolbar" (p. 93). | The plain gloss "always fire" leaves out assumptions A2-A4 and the 62 unread destinations (see N4). |
| REV-03: Rima headline is a post hoc group | criterion row "scope claims" | **Addressed** | Abstract: "on five applications grouped after reading" and "the pooled comparison does not rank the tools" (p. 1). Section 5.3.8: "an estimated 1512 and 163 are real" (p. 73). Relative recall is defined in the abstract. | The 10.2 % is still not qualified for the tool's design limits (REV-25). |
| REV-04: length | W8 | **Partly** | The body is now pp. 8-96, 89 pages, down from 108. The corrections table is now Appendix A (contents: "A Corrections made to the protocol 105", p. 7). The approximations are now Appendix B. Section 2.8 is down to about two thirds of a page. | Not yet ≤ about 80 pages. Table 6.1 still runs pp. 82-89. Chapter 3 grew from 15 to 16 pages. Headline figures are still restated: "159" 12 times, "2.0 %" 9 times, "162567" 8 times, about the same as round 1. |
| REV-05: abstract density | W9 | **Partly** | The limits sentence is present: "the figures are in-sample; consumer use is not measured." (p. 1). The abstract still fits one page. | About 366 words (was about 445; target about 250). It carries 16 figures, not three findings with one number each. |
| REV-06: contribution order | W3 | **Addressed** | Title: "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution". Section 1.1: "The measurement is the main contribution and scope attribution a modest extension" (p. 10). Abstract: "adds 2.0 % of the sites" (p. 1). | The abstract's 82.0 % has no comparator: the class join reaches 92.3 % and the lower levels 100 %. "No transition the suites take" (p. 70) is still not in the abstract. |
| REV-07: RQ4 demoted | Practical Impact | **Addressed** | Abstract: "Mutation testing only sanity-checks the witness mapping." (p. 1). Section 5.4: "The one denominator used for the headline is the scored mutants, 67/67" (p. 75). | Section 6.1 still works with "45, with rename excluded" (p. 81). That use is labelled as the roadmap allowed. |
| REV-08: one fan-out site drives density and the mifos precision | W2 | **Partly** | Section 4.2 adds a chance baseline: "by chance alone the graphs would hold 13.5 and 9.7 of those pairs" (p. 45). Table 7.1: "yields 39.4 % of all edges" (p. 94). The abstract gives 6.5 % on the largest application. | The abstract does not name the call site. The thesis attributes the 39.4 % (stored edges) to one site and the mifos pairs mostly to the shell (p. 73), so a practitioner cannot tell which one or two sites to suppress. No consumer view and no precision per modality (X-06). The baseline is applied only after the repairs (see N2). |
| REV-09: services novelty (related to my W3) | W3, related | **Partly** | Table 7.1: "Among the published rules of earlier work only it places navigation inside services." (p. 94). In Section 5.3.7 the arithmetic now implies (68 + the locale link = 69) that the three airbus pairs lost in the repair are other pairs, not reference pairs (p. 72). The text does not say so outright. | Chapter 7 keeps "accounts for the transitions it adds over their rules on their own subjects" (p. 96). Against their rules as reimplemented this now holds, through 3 airbus pairs. How their actual tool reaches 100 % on airbus (Table 5.18) is not explained. I defer to R0 and R2. |
| REV-10: AI-use statement | W10 | **Not addressed (deferred by design; counted once)** | Unchanged, as announced. "A stronger model of the same assistant" is still unnamed (pp. 70, 72, 74). | See the note below the table. It is not weighted again in my recommendation. |
| REV-13: traceability of model readings | W10 (traceability) | **Partly** | Abstract: "as an AI model read them" (p. 1). Section 5.3.8: "with the reading's verdict in view, so not blind to it" (p. 74). The Wilson interval and the model's change rates (3/45, 10/114) are given (pp. 72, 74, 88). | A placeholder remains: "[author: state whether the proposing tool was shown]" (p. 88). No list says which results rest on model readings; that belongs to the AI rewrite. |
| REV-17: "usable" and untested consumers | W1 + W4 | **Addressed** | "Usable" no longer appears (search). Abstract: "A declared route table is a starting point but an insufficient basis" (p. 1). Chapter 7: "The may tier is a candidate generator whose edges a consumer must still check" (p. 96). Section 6.1: "Neither use was tried by a consumer: consumer use is not measured." (p. 82). | Optional: the size of what a consumer receives. From Table 5.8, mifos has about 280 expanded edges per screen, and the graph holds 44 % of all possible pairs (pp. 62, 68). |
| REV-18: artifact and licences | W6 | **Partly** | Table 4.1 now has a licence column (p. 52). I checked it against the six checkouts, and it matches. The new Availability paragraph reads "under the MIT licence [author: archive DOI; a repository URL would name the extractor]" (p. 50). | There is no URL, DOI or release tag, so the artifact still cannot be found from the text. The Rima licence status still carries "[author: confirm, ...]" (p. 50), although the repository file settles it. The paragraph sits in 4.3.2 (Corrections) rather than 4.3.3 (Reproducibility). |
| REV-19: runtime cost | W5 | **Partly (hedged, not measured)** | Section 6.1: "The second, not itself measured, is checking in continuous integration at no execution cost." (p. 82). | A search finds no time or memory figure. Section 5.4 implies a real cost: "extracted again once per mutant, so it was run on three of the six applications" (p. 74). "At no execution cost" should go, or be backed by one table. |
| REV-20: workspace-library layouts | W7 | **Partly** | Table 7.1: "A library shell no level reads holds most alfresco pairs." (p. 94). Section 5.3.1: "lives in a workspace library outside the application directory" (p. 63). | Neither the abstract nor 6.2 says the figures hold for single-application source trees. The rule for files outside the application directory is still unclear to a reader. They are read for witnesses: "623 edges in 3 applications have their only witness outside the application directory" (p. 58). They are not read for a library shell. They are left out of the dead-link census (p. 79). The title still says "Single-Page Applications" for an Angular-only study. |
| REV-22: figures, tables and names | W12 (layout) | **Partly** | Figure 5.2 axis and application labels are legible in the rendered PDF (p. 62). The corrections table no longer sits mid-chapter. | Tables 4.1-4.3 still sit at pp. 52-54, against first references from p. 41 on: "Six candidates were retained (Table 4.1)". The oracle still has more than one name: Figure 4.2 says "the runtime route probe" (p. 50) and Figure 1.1 "runtime probe" (p. 11). In the rendered PDF, Table 6.1 begins with only its header and "Internal validity" at the foot of p. 82, leaving about 40 % of the page blank. Table 4.1's narrow Role column wraps to five lines (p. 52). |
| REV-23: abbreviations | W12 (abbrev.) | **Addressed** | The list now has "NgRx Angular state-management library built on RxJS" (p. 4), plus SPIN, ZAP, Ajax and JSP. E2E and LLM no longer appear in the body. | Optional: F1 (Table 2.1) is undefined. |
| REV-25: ethics | W11 | **Partly** | The Rima licence status is now stated, with the placeholder above (p. 50). The dead links stay candidates: "no candidate was navigated to in a running application" (p. 79). | There is no sentence on notifying Rima et al. or the maintainers, and no right of reply (search for notif/inform/maintainer finds none). The 10.2 % in the abstract is not qualified. |
| X-06: consumer view of mifos | W2 (extension) | Not done (optional) | — | See REV-08. |
| X-09: consumer pilot | W1 (extension) | Not done (optional) | — | Acceptable at master's scope, now that the limit is stated. |

**Tally (17 roadmap units, X-items excluded):** 6 addressed, 10 partly addressed, 1 not addressed. The one is the AI-use statement, deferred by design. The two optional extensions, X-06 and X-09, were not done.

**By round-1 weakness:** W1, W3 and W4 are addressed. W2, W5, W6, W7, W8, W9, W11 and W12 are partly addressed. W10 is not addressed (deferred).

**Note on the deferred AI-use statement.** I counted this once and do not penalise it again. But the current pages 2-3 should not reach an examiner even as a placeholder, because two of their statements no longer hold:
- **Figures.** p. 2 says "The diagrams in Chapters 1 to 4 were drawn by hand." The figures are TikZ sources, and the author's own draft says they were drafted with the assistant.
- **Bibliography.** p. 3 says unchecked sources "are kept in a separate block in the bibliography file". `references.bib` contains no such block.

The rewrite should also cover:
- the alfresco structural reference: "The alfresco reference was built without the graph, by an AI assistant" (p. 67);
- the models behind "a stronger model of the same assistant" (p. 70);
- whether third-party application source was sent to a hosted model (my round-1 W10).

---

## Part 2: New issues introduced by the revision

### N1: Author placeholders left in the submission text
- **Problem.** Four bracketed notes to the author are visible in the rendered PDF:
  - p. 50: "[author: archive DOI; a repository URL would name the extractor]";
  - p. 50: "[author: confirm, per rima/PREREGISTRATION.txt:27]";
  - p. 52: "(confirm at the pinned commits)";
  - p. 88: "[author: state whether the proposing tool was shown]".
- **Why it matters.** They sit exactly where REV-18 and REV-13 were to be closed, and they hide two facts a reader needs: where the artifact is, and whether the author's 41 re-reads were blind to the proposing tool.
- **Suggestion.** Resolve all four. The repository already settles the Rima licence: line 27 of the preregistration says "no licence". It also settles the corpus licences, which I checked against the six checkouts.
- **Severity**: Minor (must be resolved before submission) | **Evidence Anchor**: `text: §4.3.2, p. 50, "the MIT licence [author: archive DOI; a repository URL would name the extractor]"` | **Confidence**: 5 (seen in the rendered PDF)

### N2: The chance baseline for the end-to-end check is applied only after the repairs
- **Problem.** The revision adds a useful density baseline: 9.7 of 22 mifos pairs would be held by chance (p. 68). But the "12 → 19" improvement is reported without the same baseline for the graph before the repairs (p. 69; Table 7.1, p. 94: "against 12 before the repairs the check exposed"). By the thesis's own rule (graph pairs over possible pairs, times 22):
  - **Before the repairs:** the graph held 28185 of 367236 possible pairs (p. 68), so about 1.7 hits are expected by chance. Observed 12, about 10 above chance.
  - **After the repairs:** about 9.7 expected, 19 observed, about 9 above chance.
- **Why it matters.** For a consumer, the repairs bought 7 more suite hits at the cost of a mifos graph 5.8 times denser, and the hits above chance did not rise. The chance model assumes uniformly random pairs, so this is indicative only. Still, it is the thesis's own yardstick, and it changes how "19/22" reads.
- **Suggestion.** Give the pre-repair chance figure (about 1.7) beside 12/22 wherever 12 → 19 is stated (5.3.5, Table 7.1). State plainly that the repairs raised containment and density together.
- **Severity**: Minor | **Evidence Anchor**: `text: §5.3.5, p. 68, "it holds 28185 → 162567/367236 possible pairs, before → after the repairs"` | **Confidence**: 4 (arithmetic on the thesis's own figures and its own chance rule)

### N3: The abstract's lead figure contradicts the thesis's own choice of primary summary
- **Problem.** Two places name the per-application figure as primary:
  - Section 4.1.2: "per-application figures are the primary summary where the chapters give them" (p. 42);
  - Table 6.1: "the per-application median, 40.2 %, is the primary summary" (p. 86).

  The abstract instead leads with the pooled "recovers 66.7 %" and gives 38.6 % without mifos, but never the median. Table 7.1 is consistent with the stated policy; the abstract is not.
- **Why it matters.** A practitioner wants the typical application, which is about 40 %, with 4 of 6 applications under half.
- **Suggestion.** In the abstract write "a median of 40.2 % per application (66.7 % pooled, mostly one application)".
- **Severity**: Minor | **Evidence Anchor**: `text: Abstract, p. 1, "Scope attribution recovers 66.7 % of the constructs assigned to it"` | **Confidence**: 4

### N4: "159 edges that always fire" reads as 159 verified oracles
- **Problem.** The plain gloss REV-01 asked for is now in the abstract. But it states as fact what Claim 3.1 makes conditional. The claim holds under A1-A4, and A3 and A4 were never checked against a run. 62 of the 159 destinations are unread, and 125 of the edges come from one toolbar. Of these qualifications, only the route-order assumption ("33 without ...") appears in the abstract.
- **Why it matters.** A test engineer would take these edges as ready-made assertions.
- **Suggestion.** Write "159 edges classed as always firing (25 constructs, 125 edges from one toolbar)". Or add "under stated assumptions".
- **Severity**: Minor | **Evidence Anchor**: `text: Abstract, p. 1, "The corpus yields 159 edges that always fire, 33 without an assumed route order"` | **Confidence**: 3 (wording judgement)

### N5: Section 6.1 "Two uses" lost its order in the cut and conflicts with Section 5.4 on cost
- **Problem.** The order is broken: "Neither use was tried by a consumer" (p. 82) comes before the second use is introduced. The second use is then offered "at no execution cost", while Section 5.4 limits mutation testing to three applications because each mutant needs a re-extraction (p. 74).
- **Suggestion.** Introduce both uses, then the consumer-use limit. Replace "at no execution cost" with "without running the application", or report the extraction time (REV-19).
- **Severity**: Minor | **Evidence Anchor**: `text: §6.1, p. 82, "The second, not itself measured, is checking in continuous integration at no execution cost."` | **Confidence**: 4

### N6: Cross-reference to the list of approximations points at the literature section
- **Problem.** Section 1.2 says the thesis "lists what it approximates (Section 2.6.2)" (p. 11). Section 2.6.2 is the soundiness literature. The list is Section 6.3 and Appendix B (Table B.1).
- **Severity**: Minor | **Evidence Anchor**: `text: §1.2, p. 11, "lists what it approximates (Section 2.6.2)"` | **Confidence**: 5

### Caveats kept through the cuts (checked)
I looked for practitioner-relevant caveats that the cut might have dropped. All are still present:
- the in-sample figures (abstract, p. 1; p. 55);
- dependencies not installed (p. 55; Table 6.1);
- "likely optimistic" (pp. 55, 86);
- dead links as candidates only (p. 79);
- the unpinned realworld backend (pp. 45, 96);
- the clustered intervals (p. 73);
- "No blinding of the experimenter" (p. 87).

I found no lost caveat in my remit.

---

## Part 3: Recommendation and reasons

**Minor Revision.** Reasons:
1. **The overclaims in my remit are fixed in the text.** These were the round-1 findings that bore on the decision: "usable", contribution order, the post hoc label, RQ4, and the consumer-use limit. The fix appears in the abstract, Section 1.1, Section 6.1, Table 7.1 and Chapter 7. W1, W3 and W4 are resolved, and the editor's arbitration D2 is met.
2. **Every open item is text, housekeeping or one small measurement.** None needs new experiments or re-analysis of the conclusions:
   - **text:** N1-N6; the REV-20 sentence; the REV-25 sentence;
   - **housekeeping:** URL/DOI and placeholders; float placement; the stranded Table 6.1 header;
   - **one small measurement:** extraction time and peak memory per application (REV-19), or drop "at no execution cost".
3. **Two items are outside the author's narrow control and are not weighted again here.** One is the AI-use rewrite: known, but its current text must not be submitted, as noted above. The other is the final length target, 89 body pages against about 80. That target should be confirmed with the supervisor. If he holds to about 80, the cheapest cut is to move Table 6.1's mitigated threats to an appendix (7 pages down to about 2) and to state each headline figure once outside the abstract and Table 7.1.
4. **What is still not measured is now honestly limited.** Consumer benefit, a consumer view of mifos and runtime cost remain unmeasured. These no longer block, because the text no longer claims them. Adding X-06 (precision of mifos with the dominant site(s) downgraded to unknown) would be the single most useful addition for a practitioner, but it is optional.

---

## Criterion-Bound Judgements (updated)

| Dimension / criterion | Criterion source | Judgement (round 1 → now) | Evidence anchors | Rationale | Uncertainty or scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| Usefulness for the named consumers | Card focus (1) | DOES_NOT_MEET → **PARTLY_MEETS** | `text: Abstract, p. 1, "consumer use is not measured"`; `text: Ch. 7, p. 96, "The may tier is a candidate generator"` | The claim now matches the evidence. The benefit itself is still untested, which is acceptable at master's scope. | No pilot was run. | no longer |
| Practical cost of over-approximation | Card focus (2) | DOES_NOT_MEET → **PARTLY_MEETS** | `text: Abstract, p. 1, "precision is 6.5 %"`; `table: Table 7.1 RQ3, p. 94` | The cost is visible in the abstract and Chapter 7. It is still not actionable, because there is no consumer view and the two dominant sites are reported in different units (edges vs pairs). | Precision on mifos is a stratified estimate. | no |
| Generality: beyond Angular and repository layouts | Card focus (3) | PARTLY_MEETS → **PARTLY_MEETS** | `table: Table 7.1 RQ3, p. 94, "A library shell no level reads"` | The library-shell gap is now in Chapter 7. There is still no single-source-tree scope statement, and the title says "Single-Page Applications". | Section 6.4 is argued, not measured. | no |
| Runtime cost and artifact reproducibility | Card focus (3) | PARTLY_MEETS → **PARTLY_MEETS** | `text: §4.3.2, p. 50, "[author: archive DOI ...]"`; `absence: whole manuscript — expected time and memory per application; checked search for second, minute, memory, wall-clock` | The licence is stated (MIT, verified). The URL and DOI are missing, and cost is still unreported. | — | yes, until the URL is filled |
| Ethics and licensing | Card focus (3) | PARTLY_MEETS → **PARTLY_MEETS** | `text: §4.3.2, p. 50, "it carried no licence when checked"` | The licence status is now stated. Notification and right of reply are not. | I cannot see correspondence outside the thesis. | no |
| Scope claims stay inside what was measured | Card cares-about | PARTLY_MEETS → **MEETS (with N3, N4)** | `text: Abstract, p. 1, "on five applications grouped after reading"` | The post hoc grouping, the in-sample status and consumer use are labelled. Two wording residuals remain: the lead figure (N3) and "always fire" (N4). | — | no |
| Supervisor's 4 Nov requests | Run context | PARTLY_MEETS → **PARTLY_MEETS** | `table: Table 6.1, pp. 82-89` | Abbreviations: met. Abstract: one page, but dense. Length: 89 body pages, target about 80. AI statement: pending. | The length target is to be confirmed with the supervisor. | yes (length, AI statement) |

## Strengths (kept or new)
1. **Practitioner framing in the conclusion (new).** The conclusion now separates a candidate generator from the transitions that hold under Claim 3.1. This is exactly the guidance a tool integrator needs. Evidence Anchor: `text: Ch. 7, p. 96, "only the must tier (25 constructs) is offered as transitions that hold"`.
2. **A chance baseline for containment (new).** It makes 19/22 interpretable. Evidence Anchor: `text: §4.2, p. 45, "by chance alone the graphs would hold 13.5 and 9.7 of those pairs"`.
3. **Honest scope statements survived the cut.** Evidence Anchor: `text: Abstract, p. 1, "the figures are in-sample; consumer use is not measured."`.
4. **Declared approximations stay available to consumers**, now in Appendix B. Evidence Anchor: `table: Table B.1, pp. 112-116`.
5. **Licences are now tabulated for the corpus** and verified against the checkouts. Evidence Anchor: `table: Table 4.1, p. 52`.

## Questions for the author
1. What is the repository URL, and is there an archived release (DOI) of commit a9d29df?
2. What are the wall-clock time and peak memory of one extraction of mifos, and how long did one mutant take?
3. What share of mifos's 161363 compared pairs comes from the notifications tray, and what share from `view-transaction.component.ts:135`?
4. Were your 41 re-reads blind to which tool proposed each pair?

## Minor Issues
- p. 70: "Oshima and Kishi's restrictions admit 0 of the 6 corpus applications." repeats the bullet just above it; delete one of the two.
- p. 62: Figure 5.2's y-axis runs to 40 for values of 7.7 or less, and its legend shows doubled boxes.
- p. 50: move the Availability paragraph from 4.3.2 (Corrections) to 4.3.3 (Reproducibility).
- Table 2.1: F1 is not defined.

### Cross-Disciplinary Reading Recommendations
No new recommendations in this round.

~~~yaml suggested-references
[]
~~~

Recommendation: Minor Revision
