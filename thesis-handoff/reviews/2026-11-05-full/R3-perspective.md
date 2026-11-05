## Perspective Review Report (Peer Reviewer 3)

Single-call review. The multi-call sprint contract and Phase 1 blind commitment in the role file were not used, as instructed. I read all 124 pages of manuscript.txt. I checked two claims against the repository (see W6) and one by search of the manuscript (W5). I read no other file in the review directory.

### Reviewer Identity
Industrial researcher in test automation and LLM agents that drive web UIs (end-to-end test generation, agentic UI testing). I read the thesis as the engineer who would be handed this graph to feed a test generator or a coding/UI agent. I am an outsider to formal definitions (lattice and soundness details) and do not assess them.

### Overall Recommendation
Major Revision

### Confidence Score
4

Uncertainty and scope disclosure only. I am confident on the practical-usefulness, cost, reproducibility and readability findings. I am less sure how an examiner weighs "usefulness not measured" at master's scope.

### Calibration Status
`NOT_CALIBRATED`

### Criterion-Bound Judgements
| Dimension / criterion | Criterion source | Judgement | Evidence anchors | Rationale | Uncertainty or scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| Usefulness for the named consumers (test generation, coding/UI agents) | Card focus (1) | DOES_NOT_MEET | `text: Ch. 1, p. 10, "Whether a navigation graph helps such tools is not tested here."` | The motivation rests on consumers that are never exercised, even by a small pilot. | A pilot is not required at master's scope, but the claim "usable" is then unsupported. | yes: abstract and ch7 say "usable" |
| Practical cost of over-approximation | Card focus (2) | DOES_NOT_MEET | `table: Table 5.19, mifos row, p. 85`; `text: §5.5.3, p. 91, "39.4 % of all edges (5454) come from one call site in mifos"` | On the one large application, 6.5 % precision means a consumer receives mostly false pairs. The thesis reports this honestly but offers no consumer-side remedy. | Precision on mifos is a stratified estimate. | yes |
| Generality beyond Angular, and across repository layouts | Card focus (3) | PARTLY_MEETS | `text: Table 6.1, p. 99, "Figures are likely optimistic for Angular applications at large."`; `table: Table 6.3, p. 108` | The thesis discloses this, but the shell-in-a-library gap (129 pairs) is a common industrial layout and is not framed as a headline limitation. | The transfer section (§6.4) is argued, not measured. | yes |
| Runtime cost and artifact reproducibility | Card focus (3) | PARTLY_MEETS | `absence: thesis text — expected extraction time, memory, repository URL, licence; checked full manuscript.txt by keyword search`; §4.3.3, p. 62 | Reproduction machinery (pinned commits, generated macros) is strong. Cost is not reported and the artifact is not identified in the text. | Cost and URL may exist in the repository. The thesis text must carry them. | yes |
| Ethics and licensing of running another group's tool and publishing the comparison | Card focus (3) | PARTLY_MEETS | `dataset: thesis-handoff/rima/PREREGISTRATION.txt line 27, "the repository has no licence"`; §5.3.8, p. 84 | The tool was run and its recall is reported as 10.2 %. The thesis does not state the licence status, authors' notification or right of reply. | I cannot see correspondence outside the thesis. | no (Minor) |
| Scope claims stay inside what was measured | Card cares-about | PARTLY_MEETS | `text: Abstract, p. 1, "The figures are in-sample"`; `text: Abstract, "on the largest its precision is 6.5 % against 80.0 %."` | In-sample status is stated in the abstract. The headline comparison (94.1 % vs 10.2 %) is on a post hoc group that excludes the one application where the extractor loses. | Overlaps with the methodology and devil's-advocate seats; I report only the practical reading. | yes |
| Supervisor requests of 4 Nov (length, readability, abstract, AI statement, abbreviations, figures/tables) | Run context | PARTLY_MEETS | See W8, W9, W10 | Abstract fits one page. The text is not shortened enough for a practitioner. The AI statement is long but not precise. | Judged from the PDF text only, not the rendered figures. | yes |

### Summary Assessment
The thesis is unusually candid. It states that its figures are in-sample, lists 60-odd corrections, and tells the reader which queries the graph cannot answer. As a practitioner I find that honesty useful. My concern is the distance between what the thesis measures and what it implies. It motivates the extractor with test generation and LLM agents, then measures only recall and precision against hand-built or suite-derived references, on its own tool and corpus. The deterministic tier that a consumer could trust is 25 constructs, and 125 of its 159 edges come from one toolbar. The usable tier is the over-approximated one. On the only large application its precision is 6.5 %. The thesis does not say what a consumer should do with that, or what a run costs. The proposed contribution, the service join, adds 36 sites (2.0 %) over the nearest earlier level and no transition that the two end-to-end suites take. These are findings a practitioner needs up front, and they are currently spread over ten tables. The thesis is also very long (124 pages, 7 chapters, about 30 tables) for the supervisor's request to shorten considerably. A cheaper path to a stronger thesis is to cut process history, move the practical caveats forward, and either run one small consumer pilot or drop the word "usable".

### Strengths
1. **S1 Honest scope statements.** The thesis separates in-sample from out-of-sample, labels hand-compiled tables, and lists what the graph cannot answer. This lets a practitioner decide which queries to trust. Evidence Anchor: `text: §1.2, p. 11, "every figure on it is in-sample and is not an estimate for other applications"`.
2. **S2 Consumer-readable list of declared approximations.** Table 6.2 states, per construct, the tier and what is missing. This is the artifact a tool integrator needs. Evidence Anchor: `table: Table 6.2, pp. 102-107`.
3. **S3 Head-to-head with a real third-party tool, preregistered, on seven subjects not used in development.** Running Rima et al.'s tool rather than reimplementing it is the practical comparison an industrial reader wants, and the thesis reports where it loses (mifos precision). Evidence Anchor: `text: §5.3.7, p. 82, "None of the seven was used to develop the extractor"`.
4. **S4 Anchored edge storage with a measured saving.** The compact representation (13.7 times smaller on mifos) is directly relevant to anyone serialising the graph. Evidence Anchor: `table: Table 5.8, p. 72`.
5. **S5 Dead-link candidates as a developer-facing output.** The census gives concrete, checkable defects (a missing `/accounting` prefix) that need no running system. Evidence Anchor: `text: §5.6, p. 92, "The result is a candidate list and not a verdict"`.
6. **S6 Reproduction machinery.** Pinned commits, generated macros, determinism and no-accumulated-state checks. Evidence Anchor: `text: §4.3.3, p. 62, "Every figure is generated by scripts at one commit of the extractor"`.

### Weaknesses
1. **W1 The consumers named in the motivation are never exercised, and the graph is not shaped for them.** The thesis says the graph serves test generation and coding/UI agents, then measures neither. It also never reports the size of what such a consumer would receive. By my arithmetic from Table 5.8, mifos has 170011 expanded edges over 606 screens, about 280 outgoing edges per screen, where a rendered screen shows a handful of links. An LLM agent or a test generator given that slice would be flooded.
   - **Problem**: "usable" in the abstract and conclusion is unsupported by any consumer-side evidence, even a toy one.
   - **Why it matters**: the practical value claim is the reason to build the tool. The honest wording is "recall measured, usability untested".
   - **Suggestion**: (a) Replace "usable" with "recovers X of Y and is untested for consumers". (b) Add one small pilot, for example feed the realworld and alfresco graphs as a route list to a test generator and count screens reached, or report tokens and edges per screen slice. (c) Move the sentence quoted in the anchor into the abstract.
   - **Severity**: Major | **Evidence Anchor**: `text: §1.1, p. 10, "Whether a navigation graph helps such tools is not tested here."` | **Confidence**: 4 — core expertise: LLM agents driving web UIs

2. **W2 Over-approximation cost is reported but not made actionable, and it is concentrated in a few call sites.** On mifos the extractor holds 161363 pairs at 6.5 % precision. 39.4 % of all edges come from one navigateByUrl with an empty static prefix, and only 7.0 % of cited locations are clean. A consumer can neither trust nor cheaply filter these edges.
   - **Problem**: the thesis treats this as a measurement result. A practitioner would first ask how much of the harm is one call site, and what precision the graph has if wide-fan-out sites are suppressed or downgraded to unknown.
   - **Why it matters**: the headline recall of the may tier is bought with the very edges that make the output unusable on the largest application. This is the application closest to an industrial one.
   - **Suggestion**: report a "consumer view" for mifos: precision and size with fan-out above a threshold treated as unknown, or with the single dominant site removed. Report precision per modality (the thesis only gives it for the whole graph). State plainly in the abstract that the may tier is not precise on large applications.
   - **Severity**: Major | **Evidence Anchor**: `table: Table 5.19, mifos row, p. 85`; `text: §5.5.3, p. 91, "39.4 % of all edges (5454) come from one call site in mifos"` | **Confidence**: 4 — core expertise: practical cost of noisy test targets

3. **W3 The proposed contribution adds little that a consumer could see, and the thesis says so only in the body.** Against the nearest earlier level, the full analysis adds 36 sites, adds no transition that the two end-to-end suites take, and lowers precision on alfresco (100.0 % to 82.0 %). The abstract reports the favourable ratios (66.7 %, 20 of 48, 43.2 % to 90.9 %) first.
   - **Problem**: a reader of the abstract concludes that scope attribution is the main practical gain. The measurements say the shell rule and outlet descent, which are earlier work, produce most of it.
   - **Why it matters**: the title names the contribution. The practical value is smaller than the framing suggests.
   - **Suggestion**: state in the abstract and conclusion that the incremental gain of the service join is 36 sites (2.0 %), zero extra suite transitions, and a precision cost on alfresco. Frame the thesis's main contribution as the measurement, as section 1.3 already says ("the main contribution").
   - **Severity**: Major | **Evidence Anchor**: `text: §5.3.3, p. 76, "adds the full step alone: 36 sites, 2.0 % of the corpus total"`; `text: §5.3.6, p. 81, "the step above outlet adds no transition the suites take"` | **Confidence**: 4 — adjacent field: reading ablation tables as a practitioner

4. **W4 The deterministic tier is tiny and mostly one toolbar, yet the conclusion calls the table "usable".** 25 constructs yield 159 must edges; 125 come from one toolbar, 62 have an unreadable destination, and 126 rest on an unread route-order assumption. Must conversion is 1.4 % on the largest application.
   - **Problem**: for a test-generation consumer the trustworthy part is effectively 25 constructs on four applications. "A declared route table is a usable starting point" is not supported for the deterministic use.
   - **Why it matters**: a practitioner choosing whether to adopt the extractor needs the size of the trustworthy part, not the claim that it is a starting point.
   - **Suggestion**: put the 25 constructs, 1.4 % and the single-toolbar concentration in the conclusion's last paragraph. Distinguish "usable as a candidate generator (may tier)" from "usable as ground truth (must tier)".
   - **Severity**: Major | **Evidence Anchor**: `text: Abstract, p. 1, "A declared route table is a usable but insufficient basis"`; `table: Table 7.1 RQ1 row, p. 112` | **Confidence**: 3 — adjacent field: depends on how "usable" is read

5. **W5 Runtime cost is not reported although cheap, per-commit recomputation is a stated advantage.** Section 6.1 says the graph "is recomputed from source on each commit, deterministically". Section 1.1 makes the same point against crawlers. I found no extraction time, memory, or incremental-update figure anywhere in the manuscript. The mutation harness re-extracts once per mutant, so the figures exist.
   - **Problem**: an advantage over dynamic tools is asserted with no cost evidence.
   - **Why it matters**: CI adoption turns on minutes, not on determinism alone. A mifos graph with 13830 edges and 170011 expanded pairs may be slow or heavy.
   - **Suggestion**: add one table: wall-clock and peak memory per application on a stated machine, with and without attribution, plus the cost of one re-extraction. If the numbers are unfavourable, say so.
   - **Severity**: Major | **Evidence Anchor**: `absence: whole thesis — expected extraction time and memory per application; checked keyword search for seconds, minutes, memory, performance, wall`; `text: §6.1, p. 95, "recomputed from source on each commit, deterministically"` | **Confidence**: 4 — core expertise: CI cost of analysis tools

6. **W6 The artifact is not identified in the thesis text, and the comparison depends on a third-party repository with no licence.** The text says the extractor "is available as open source" but gives no URL, DOI, licence or release tag. Table 4.1 lists no licence for any corpus application. The Rima et al. comparison needs a checkout of a repository that, per the preregistration, has no licence, and their ground-truth files are not redistributed.
   - **Problem**: a reader cannot find the artifact from the thesis alone. Reproduction of Tables 5.18-5.19 requires obtaining unlicensed third-party material. The thesis does not say so.
   - **Why it matters**: reproducibility is a claimed contribution ("the third is the apparatus that makes it checkable"). The licence of the extractor itself decides whether industry can use it.
   - **Suggestion**: add a short "Availability" paragraph in §4.3.3: repository URL, archived release (Zenodo DOI), licence, tag of the evaluated commit a9d29df, and the exact steps and licence status of the Rima checkout. Add a licence column to Table 4.1.
   - **Severity**: Major | **Evidence Anchor**: `dataset: thesis-handoff/rima/PREREGISTRATION.txt line 27, "the repository has no licence"`; `text: §3.3, p. 40, "is available as open source"` | **Confidence**: 4 — verified against the repository file

7. **W7 Industrial repository layouts are under-represented, and the most practical gap is a minor line in the limitations.** Table 6.3 shows 129 of 133 missing alfresco reference pairs come from a shell that a library outside the application directory provides. bitwarden's four unpredicted links have the same cause. Table 6.1 notes that figures are "likely optimistic". Monorepos with workspace libraries and configuration-driven routes are the norm in industry. The one candidate rejected for this reason (spartacus) is also the most industrial-looking one.
   - **Problem**: the practical limit "does not follow into workspace libraries and configuration" is presented as a per-application detail, not as a headline limit on external validity.
   - **Why it matters**: a practitioner will first run this on a monorepo and see the shell missing.
   - **Suggestion**: report, per corpus application, the share of navigation sites that live outside the application directory. State in the abstract that the figures are for single-application source trees. If cheap, extend the scope to workspace libraries on alfresco and re-report.
   - **Severity**: Major | **Evidence Anchor**: `table: Table 6.3, p. 108, "Shell from a library (alfresco)" 129 pairs`; `text: Table 6.1, p. 99, "Figures are likely optimistic for Angular applications at large."` | **Confidence**: 3 — adjacent field: industrial monorepo experience

8. **W8 Length and readability: the thesis is not yet shortened "considerably" and repeats its key numbers.** The same headline figures (66.7 %, 94.1 % vs 10.2 %, 6.5 %, 159 edges) recur in the abstract, §5.3.6, Table 5.17, §6.1, Table 6.1 and Table 7.1. Process history takes a large share of the body: Table 4.5 runs pp. 55-61, Table 6.1 pp. 95-101, Table 6.2 pp. 102-107. Chapter 2 spends about three pages on reactive-programming debugging studies (§2.8) for a feature the extractor does not implement ("No pass in this version emits that modality").
   - **Problem**: a practitioner cannot find the answer to "does it work on my app" without reading 80 pages.
   - **Why it matters**: this is the supervisor's first request.
   - **Suggestion**: (a) Move Table 4.5 and the §4.3.2 narrative to an appendix, keeping a ten-row summary in the body. (b) Cut §2.8 and most of §2.5.3 and §2.9.2 to a paragraph each. (c) Keep each headline number in one results table plus the abstract; elsewhere refer to it. (d) Fold Table 5.16 and Table 5.17 into one. (e) Split Table 6.1 so that only open threats stay in the body. A target of about 80-90 pages is realistic.
   - **Severity**: Major | **Evidence Anchor**: `table: Table 4.5, pp. 55-61`; `table: Table 7.1, pp. 112-114` | **Confidence**: 4 — page counts from the manuscript

9. **W9 The abstract fits one page but is dense for a non-specialist and mixes denominators.** It uses undefined terms ("loss rules", "scope attribution", "mutation testing harness"), names mifos and Rima et al. without introduction, and puts four comparisons with different denominators (66.7 % of constructs, 20 of 48, 43.2 % to 90.9 %, 94.1 % vs 10.2 % on a post hoc group) in a single paragraph.
   - **Problem**: a reader cannot tell which figure is in-sample, which is post hoc, and which transfers.
   - **Why it matters**: supervisor request (one-page abstract). The abstract is also what an industrial reader reads.
   - **Suggestion**: rewrite in about 250 words: problem, method, three results with one number each, one sentence on limits (in-sample, Angular only, 6.5 % precision on the largest application). Move the sentence on harness correction to the body.
   - **Severity**: Minor | **Evidence Anchor**: `text: Abstract, p. 1, "Three results stand out."` | **Confidence**: 4 — reader perspective

10. **W10 The AI-use statement is long but not precise.** It says "An AI coding assistant was used" without naming product, model, version or dates. It also refers to "a stronger model of the same assistant" (§5.3.7, p. 84) without naming either. It mixes four reproducibility caveats into the declaration, and does not say what share of code, prose and annotation was machine-produced. It also does not say that third-party source code was sent to a hosted model, or whether corpus licences allow that.
   - **Problem**: the supervisor asked for a precise statement. A reader cannot tell which results depend on a model's judgement (the 263 pair readings, the alfresco reference, the tier reading).
   - **Why it matters**: several evaluation results are model readings. The statement is the one place that must tie each to a task and a human check.
   - **Suggestion**: replace the prose with a table: task | tool and model, version, dates | what the human checked | where reported. Cover code, harness, prose, literature search, source readings (rows for 5.3.4, 5.3.7, 5.3.8, 5.5.3) and red-team panels. Move the "four kinds of figure cannot be reproduced" list to §4.3.3.
   - **Severity**: Major | **Evidence Anchor**: `text: Use of AI tools, p. 2, "An AI coding assistant was used in this work in the ways set out below"` | **Confidence**: 4 — supervisor request plus reader perspective

11. **W11 Ethics: the comparison and the dead-link list name third parties without stated courtesy or disclosure.** Rima et al.'s tool is reported at 10.2 % recall on the corpus, partly because it records constant paths as text and does not prefix lazy modules (§5.3.8). Those cases lie outside what its specification claims to handle. The thesis does not say whether the authors were told or invited to respond. The 29 dead-link candidates name concrete applications and files, and the thesis does not say whether maintainers were informed.
   - **Problem**: unstated, and easy to fix.
   - **Why it matters**: the 10.2 % figure is the single most quotable number in the abstract. It reflects a research prototype run on inputs outside its design, which a practitioner may read as a defect of the tool.
   - **Suggestion**: add one sentence on notification and right of reply. In the abstract, qualify the 10.2 % as "on applications using constructs the tool does not support". Report the dead-link candidates to maintainers, or at least navigate the 29 URLs once in a running instance (a Playwright script is enough) before calling them dead links.
   - **Severity**: Minor | **Evidence Anchor**: `text: §5.6, p. 92, "no candidate was navigated to in a running application"`; `text: Abstract, p. 1, "against 10.2 %"` | **Confidence**: 3 — adjacent field: research-software etiquette

12. **W12 Abbreviations and figure/table layout.** The list (p. 4) omits abbreviations used in the text: SPIN (p. 17), ZAP (Table 2.1, p. 29), NgRx (defined inline on p. 35 only), E2E (once), and the notation u_ sink / o_ origin. Tables are out of order: Table 4.5 (p. 55) precedes Tables 4.2 and 4.3 (pp. 63-64), although §4.2 (p. 47) says "Table 4.2 lists every ratio". Table 4.4 and Table 6.1 break across pages with narrow columns, and the figures in the text layer (Fig. 5.2) lose their labels, so I could not confirm the figure fixes.
   - **Problem**: navigation cost for the reader.
   - **Suggestion**: add the missing abbreviations (SPIN, ZAP, NgRx, E2E, LLM); use `[t]` placement or `\FloatBarrier` so each table sits near its first reference; widen narrow columns or turn Table 6.1 into a list; check Figure 5.2 axis labels.
   - **Severity**: Minor | **Evidence Anchor**: `text: Abbreviations, p. 4, list ends at "URL Uniform Resource Locator"`; `table: Table 4.2, p. 63` | **Confidence**: 4 — direct check of manuscript text

### Detailed Comments

#### Assumption Audit
- **Explicit assumptions**: The thesis states its assumptions well: route order, the execution model of Claim 3.1, one navigation per primary activation, development configuration for the oracle. I have no reason to challenge them from a practical side except the route-order assumption, which carries 126 of 159 must edges and is not read from the application.
- **Implicit assumptions**: (i) Per-commit recomputation is cheap (W5). (ii) A higher recall on a hand- or tool-generated reference means a more useful graph for a consumer (W1). (iii) The application directory is the unit of analysis, although industrial front ends are built from workspace libraries (W7). (iv) A test or agent consumer wants the whole screen graph, rather than a per-task slice.
- **Paradigmatic assumptions**: The thesis treats navigation as a property of route tables and templates. For agents that act on a rendered UI, much behaviour sits in overlays, dialogs, data-dependent routes and login state, which the thesis lists as outside its scope. This is honest, but it narrows the practical reach.

#### Cross-Disciplinary Connections
- **Parallel research**: Work on model-based and crawler-based web testing and on agentic UI testing has reported how much a prior navigation model helps exploration. The thesis cites several such works only as motivation, never as a baseline. [UNVERIFIED] search leads: benchmarks for web agents on multi-page applications; studies of page-object or route-list inputs to test generators.
- **Borrowing opportunities**: Industrial test selection reports precision/recall per consumer query ("which tests to run for this change"), not per graph. The change-impact motivation (RQ4) could borrow that framing.
- **Methodological borrowing**: A cheap downstream proxy: given a graph, count the share of true screens that a simple crawler reaches in a fixed budget with and without the graph as a seed list.

#### Practical Impact
- **Real-world application**: For change impact analysis the evidence is the 45/45 mutants detected, which the thesis itself calls "close to guaranteed by construction". For CI assertions ("a screen still has an inbound deterministic transition") the usable tier is tiny. For test generation the may tier is large but noisy.
- **Implementation feasibility**: Barriers I expect in practice: unpublished libraries and monorepos (W7), unknown cost (W5), no packaged CLI or format description in the text (W6), graph size for agent context windows (W1).
- **Stakeholders**: Maintainers of the analysed applications and of Rima et al.'s tool (W11). Developers who would receive 280 candidate edges per screen on a large app.

#### Broader Implications
- **Ethical dimensions**: AI use is declared. The open issues are the licence of the third-party tool and corpus (W6), notification (W11), and sending third-party source to a hosted model.
- **Social impact**: Minimal.
- **Future directions**: The order I would choose: (1) a small consumer pilot, (2) a consumer view with fan-out limits, (3) workspace-library scope, (4) the signed-in runtime tier that the thesis already names.

### Cross-Disciplinary Reading Recommendations
- [UNVERIFIED] search lead: benchmarks and studies of LLM web-agents on multi-page applications (how navigation priors change success rates).
- [UNVERIFIED] search lead: industrial reports on test selection precision in CI for front-end applications.

~~~yaml suggested-references
[]
~~~

### Questions for Authors
1. What are the wall-clock time and peak memory of one extraction per corpus application, and of one re-extraction after a one-line change?
2. On mifos, what are the precision and size of the graph if the one navigateByUrl with an empty static prefix (5454 edges) is downgraded to unknown?
3. Which of the thesis's results would change if the 36 service-join sites were removed? Is the service join the main contribution, or is the measurement?
4. What is the licence of the extractor, and where is the archived release? How can a reader obtain Rima et al.'s ground truth, given that their repository has no licence?
5. Did you inform the authors of the compared tool, and the maintainers of the applications with dead-link candidates?
6. Which model, which version, and when? Which result tables depend on its readings?
7. What share of the navigation sites in each corpus application lies outside the application directory?

### Minor Issues
- p. 1: "Three results stand out" is followed by a paragraph that holds about ten numbers. Reduce to three.
- p. 10: the sentence about the SWE-bench issues needing "coordinated edits" is a motivation without a link to what the graph would contribute. Either connect it or cut it.
- p. 55-61: the table of corrections has a "Found by" column in free prose ("Figure: a construct count that tripled"). A short label set would be easier to scan.
- p. 84: "a stronger model of the same assistant" needs a name and version (W10).
- Tables 4.2 and 4.3 sit at the end of Chapter 4, after the prose that uses them (W12).
- The terms "may" and "must" are borrowed from modal transition systems. A one-line plain-language gloss in the abstract would help practitioners ("certain" and "possible").

Recommendation: Major Revision
