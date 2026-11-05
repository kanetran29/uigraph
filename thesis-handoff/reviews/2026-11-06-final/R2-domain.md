# Peer Review Report: Verification Round

## Manuscript Information
- **Title (revised)**: Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution (D. K. Tran, Aalto MSc thesis). Revised draft: 117 pp., body pp. 8-96, appendices A and B.
- **Review round**: 2 (verification of the revision against round 1 of 5 Nov 2026)
- **Review date**: 2026-11-05 (files in `reviews/2026-11-06-final/`)
- **Dispatch note**: single-call seat. No sprint contract. I did not read any other seat's round-2 report.

## Reviewer Information
- **Role**: Peer Reviewer 2 (Domain). Static analysis for JavaScript and web frameworks, GUI-model extraction (WTG/GATOR, StoryDroid, GoalExplorer) and dynamic crawling (Crawljax, FRAGGEN). Statistical estimation is outside my expertise and was not assessed.
- **Inputs read**:
  - my round-1 report (`2026-11-05-full/R2-domain.md`);
  - the editorial roadmap (`2026-11-05-full/editorial-decision.md`);
  - the revised `manuscript.txt`, compared with the round-1 `manuscript.txt`;
  - the LaTeX sources in `thesis/`.
- **Repository evidence read** (read-only):
  - in `thesis-handoff/rima/`: `results.json`, `results-RimaRep.json`, `spurious-causes.json`, `STUDENT-READING.md`, `head2head/results-v3/{score,reading}.json`;
  - `thesis-handoff/HANDOFF.md`;
  - `thesis-handoff/thesis/appendix.tex` and `generated-guard-only.tex`;
  - Rima et al.'s output and source at the commit the thesis ran (f33003f), in `~/personal/uigraph-work/rima/theirs/` and `~/personal/uigraph-work/rima/softscanner_fa/`.
- **Page numbers** are the printed ones in the revised manuscript. Every quotation is at most 15 words.
- **Not counted**: the AI-use chapter (pp. 2-3) is unchanged on purpose and still names no tool, model or version. I note this here and do not count it below.

## Overall Assessment

### Recommendation
**Minor Revision.** One Major item is left (R2-W5). It needs text changes only, and the evidence it needs is in the repository (given below).

### Confidence
4. My one decisive new finding (R2-W5) rests on the tool output and the tool's source code, which I read directly. Confidence for that finding is 5.

### Summary
The revision fixes most of what decided my round-1 recommendation:
- **RQ1 headline (W1).** The small must tier is now called "largely a matter of definition", and its sensitivity (33/159/203) is given.
- **Must lower bound (W2).** It is now stated relative to four numbered assumptions.
- **May tier (W3).** It is now a "design intent", with the rules that under-approximate listed.
- **Formal model versus evaluated pass (W4).** Chapter 3 now opens by separating them, and the least-solution claim is limited to the fixpoint core.
- **Title and contribution order.** Both now match the evidence.

One problem was not fixed, and the repository now settles it against the thesis: the novelty claim for the service join. The thesis ran Rima et al.'s tool at f33003f. That implementation follows one call into an injected service whose class name matches `router|navigation` (its rule "F1: Bounded Router-service tracing"). This is exactly how it reaches the three airbus pairs that the thesis presents as the step "only this thesis adds". Chapter 7 still says the service join "accounts for the transitions it adds over their rules on their own subjects". That sentence should have been removed (REV-09).

On the corpus the picture differs. Their tool places no navigation from a service file in any of the six applications, while the thesis's join places 36 sites there. So the contribution survives, but it must be restated as a generalisation of a name-bounded, one-level rule, and not as a mechanism no earlier work has.

The other remaining items are Minor:
- assumption A3 is not counted;
- the relation count is now inconsistent across Chapters 3, 6 and 7;
- the abstract says "always fire";
- UrlTree redirect edges are absent from the Chapter 7 limits;
- the Android sentence is unchanged;
- author placeholders are left in the body.

### Item count
| Status | Count | Items |
|---|---|---|
| Addressed | 6 | W3, C2, C3, C4, C5, REV-06 |
| Partly addressed | 8 | W1, W2, W4, W5, W6, W7, W11, C1 |
| Not addressed | 3 | W8, W9, W10 |

That is 17 items: my 11 round-1 weaknesses, 5 detailed comments, and REV-06. Roadmap items attributed to my seat are folded into the weakness they came from: REV-01, 04, 08, 09, 14, 15 and 26-29. REV-03, 05, 11 and 22 are folded into comments C5, C1, C2 and C4.

---

## Part 1. Verification of round-1 items

| # | Round-1 item (roadmap) | Status | Revised text (page) | What remains |
|---|---|---|---|---|
| W1 | "Almost nothing is deterministic" is definitional (REV-01) | **Partly** | "The small must tier is therefore largely a matter of definition" (p. 56); "159 edges that always fire, 33 without an assumed route order" (p. 1) | See note W1 |
| W2 | Must tier "lower bound" stronger than Claim 3.1 (REV-14, must part) | **Partly** | "The must tier is therefore a lower bound only relative to four assumptions" (p. 28); "The edges resting on A3 and A4 are not counted" (p. 28) | A3, a call with no body in the application starts no navigation, is uncounted. It is the assumption most exposed by not installing dependencies (1111 unresolved calls, Table B.1, p. 115). The count is a query over what the demotion pass already enumerates. |
| W3 | May tier "upper bound" (REV-14, may part) | **Addressed** (roadmap minimum) | "This is a design intent and not a property that holds." (p. 30); "not a proved upper bound: some rules do not over-approximate" (p. 90) | Optional, not required: per-rule counterexample classes, and turning "first matching route" into a fan-out. |
| W4 | Specified analysis is not the evaluated analysis (REV-15; Ch. 3 part of REV-04) | **Partly** | "termination and the least-solution property hold for the fixpoint core only" (p. 31); "Scope attribution is specified here over three input relations." (p. 30) | See note W4 |
| W5 | Services novelty against Rima et al. (REV-09; D1; X-08) | **Partly**: the qualifier and evidence size were added, but the decisive parts were not done, and the repository contradicts the claim | "Among the published rules of earlier work only it places navigation inside services." (p. 94); "accounts for the transitions it adds over their rules on their own subjects" (p. 96) | See R2-W5 below |
| W6 | One fan-out policy dominates edges, density and the 6.5 % (REV-08; X-06) | **Partly** | "by chance alone the graphs would hold 13.5 and 9.7 of those pairs" (p. 45); "most of whose pairs only the shell reaches, precision is 6.5 %" (p. 1) | Chance baselines were added (pp. 45, 68, 94). The policy is unchanged: "An empty prefix connects the site to every declared route except the root." (p. 114). The 39.4 % share appears only in 5.5.3 and Table 7.1, not in the abstract or the Ch. 7 prose. Part 3 corrects my own round-1 attribution of the 6.5 %. |
| W7 | `unknown` modality and MTS order (REV-26) | **Partly** | "whose elements are confidence labels" (p. 25) | Def. 3.1 still says a modality "never denotes a screen, a route or a navigation target" (p. 25). The next page says `unknown` "carries the destinations the analysis cannot name" (p. 26). Section 2.6.1 still says the model "adopts this distinction and adds a third label, unknown" (p. 18) rather than "inspired by". |
| W8 | Android comparison from one paper; IC3/Intent line absent (REV-29) | **Not addressed** | Unchanged: "and the Android work handles them with dynamic evidence" (p. 23) | [77] and [78] were not re-checked. Constant-propagation target resolution on Android is neither discussed nor declared out of scope. |
| W9 | Effect of not installing dependencies unmeasured (REV-28, consider; X-07) | **Not addressed** (acceptable at "consider") | Unchanged: "The figures are properties of that configuration only." (p. 83) | The table does not say in words that the effect is unmeasured. The text does not link it to A3 (see W2). |
| W10 | UrlTree guard-redirect edges absent from measured graphs (REV-27) | **Not addressed** | "The prototype does not implement this edge class." (p. 34; already in round 1) | The Ch. 7 open items name only "the guard relation is replaced by a stand-in" (p. 96), which concerns guard scope, not redirect edges. The abstract is silent. The only mention outside Ch. 3 is in future work (p. 92). |
| W11 | Ch. 2 material no result uses (REV-04, Ch. 2 part) | **Partly** | Cut to "its use and anti-patterns have been detected statically in Java" (p. 20); Ch. 2 went from 16 to 12 pages | Kept: "found comprehension better in reactive code in an experiment with 127 subjects" (p. 21), the debugger and operator-usage studies (p. 21), and "Both Flow and TypeScript detected only about 15% of fixed bugs" (p. 17). None of these supports a design decision. |
| C1 | Abstract density (REV-05, my comment) | **Partly** | "relative recall (share of real transitions either finds, as an AI model read them)" (p. 1) | About 377 words, down from about 445, still with about 25 figures. The roadmap target was about 250. R0 decides this item. Within my scope, see N1. |
| C2 | Section 1.2 scope list mixes limits and claims (REV-11, my comment) | **Addressed** | "It does not measure the graph's effect on any consumer, it evaluates Angular only" (p. 11) | One cross-reference in the same paragraph is wrong (N3). Fig. 1.1 placement is R0's part. |
| C3 | 3.2.2 named elements are a storage device | **Addressed** | "These names are a representation device for anchoring edges, not a restriction of the domain" (p. 32) | None |
| C4 | Fig. 3.1 nesting enforced by design (REV-22, my part) | **Addressed** | "The levels nest by construction: each withholds every mechanism above it" (p. 36) | The same caption keeps "Orange: what only this thesis adds" (p. 36); see R2-W5 |
| C5 | "Corpus without mifos" is post hoc (REV-03, my comment) | **Addressed** | "the row without mifos was added after reading (both post hoc)" (p. 73); "on five applications grouped after reading" (p. 1) | None in my scope |
| REV-06 | Title and contribution order (my summary (c)) | **Addressed** | Title: "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution"; "The measurement is the main contribution and scope attribution a modest extension" (p. 10) | Consistent in the abstract, 1.1 and the Ch. 7 contributions. The service-join wording inside them is R2-W5. |

**Note W1.** The REV-01 acceptance criterion is mostly met. The abstract (p. 1), 5.1 (p. 56), 6.1 (p. 82) and Table 7.1 (p. 93) all carry the definitional reading and the 33/159/203 sensitivity. Three gaps remain:
- **Gloss (N1).** The abstract's plain-word gloss, "edges that always fire", drops "whenever their code runs" and the assumptions A1-A4.
- **Missing toolbar caveat.** The 125-edge toolbar and the 62 unread destinations (REV-01 (d)) appear in Table 7.1 but have left the abstract.
- **Orphan 203.** The figure is cited to "(Section 5.5)" (p. 82), but Section 5.5 does not report it. The figure exists only as a generated macro (`generated-guard-only.tex`: 44 guarded edges, 69 sites).

The second figure I asked for in round 1 is not reported: the share that is unconditional given a recorded condition. That remains optional. The guard component g still holds only the router's guards: "Only an optional mode that no table of Chapter 5 uses keeps the enclosing condition." (p. 34).

**Note W4.** What was done:
- Section 3.2 now opens with the split between the specified model and the evaluated pass.
- The least-solution claim is limited to the core.
- D and T are moved to a short 3.2.7.
- The `unknown` effect edge is gone from Fig. 2.1 (p. 14).

What remains:
- Algorithm 1 still carries model-only lines ("model only: runs as the user leaves r", p. 40) and D and T in its loop.
- The canDeactivate and HTTP-interceptor rows of Table 3.3 (p. 33) are not marked as model-only.
- Sections 3.2.4 and 3.2.5 remain.
- Ch. 3 did not get shorter (round 1: pp. 30-44; revised: pp. 25-40).
- The relation count is now inconsistent (N2).

---

## Part 2. Remaining and new weaknesses

### R2-W5: The service-join novelty is contradicted by the output of the tool the thesis ran (persisting; REV-09 must-fix not done)
**Severity**: Major
**Evidence Anchor**: `text: Table 7.1 p. 94, "Among the published rules of earlier work only it places navigation inside services."`
**Confidence**: 5. I checked the tool output and the tool source directly.

**What the thesis claims.** The claim appears in six places:
- 2.4 (p. 16): their specification "does not follow a call into a service, so a navigation inside a service member" is not placed;
- 5.3.6 (p. 70): "The service join places navigation no earlier mechanism can place.";
- 5.3.7 (p. 71): "The step from outlet to full is 3 pairs, all on airbus";
- Fig. 3.1 (p. 36): "only this thesis adds";
- Table 7.1 (p. 94);
- Ch. 7 (p. 96): "accounts for the transitions it adds over their rules on their own subjects".

**What the repository shows.** Each point can be checked in the files named:
1. **The three airbus reference pairs.** The pairs held only at the full level are `/login → /dashboard`, `/dashboard → /update` and `/getAllProducts → /update` (`rima/results.json`, airbus, `levels.outlet.missed`). Their navigations sit in `src/app/services/router.service.ts` (`navigate(['dashboard'])` at line 16, `navigate(['update'])` at line 24). They are called from `LoginPageComponent` (line 63) and `GetAllProductsComponent` (line 50).
2. **Their tool emits these edges.** Rima et al.'s tool at f33003f emits `COMPONENT_NAVIGATES_ROUTE` edges from those two components to `/dashboard` and `/update`. The edges' `refs` point into `src/app/services/router.service.ts` (`uigraph-work/rima/theirs/airbus-inventory/json/a1-multigraph.json`).
3. **The rule that does it.** The rule is in `softscanner_fa/src/analyzers/business-logic/logic-utils.ts`, around lines 229-247, under the comment "F1: Bounded Router-service tracing". It traces one level into an injected service's method when the service class name matches `/router|navigation/i`. The specification the thesis cites (`docs/paper/approach.md`, line 199) says the opposite ("do not follow calls to methods on injected services"). The implementation departs from its own specification exactly here.
4. **The thesis's own run already shows it.** Table 5.18 (p. 73) gives their tool 100.0 % relative recall on airbus. The head-to-head readings (`rima/head2head/results-v3/reading.json`) list `/dashboard → /update` and `/getAllProducts → /update` in the "both" stratum.
5. **On the corpus their tool places nothing from a service file.** Across all 13 applications their tool cites a file other than the component's own as navigation evidence only on airbus: 4 edges, all in `router.service.ts`. On the six corpus applications it places none, while the full level places 36 sites there (p. 66).

**What follows.** This settles disagreement D1 of the roadmap. The "contradict" reading of R0, R2 and DA is right for Rima et al.'s own subjects. R1's "support" reading is right for the corpus.

The service join is therefore not "the construct the specification's rule does not follow" as far as the tool is concerned. On airbus it reproduces what their tool already does with a name heuristic. What is new is that the join generalises this to:
- any typed receiver;
- transitive service-to-service calls;
- provider bindings;
- the class-join fallback;
- guards and effects.

All of the evidence for that generalisation is on the corpus: 36 sites (2.0 %), 20/48 constructs, 7 sites over the class join. One more claim does not hold: "accounts for the transitions it adds over their rules on their own subjects" is true of the specification and false of the tool.

**Fix (text only).**
- **2.4:** add one sentence on the F1 rule, with the file and the commit.
- **5.3.7:** say that their tool reaches the three airbus pairs by that rule.
- **Ch. 7 (p. 96):** delete the "accounts for ..." clause.
- **Table 7.1, 5.3.6, Fig. 3.1 and the abstract's "its one new step":** restate the novelty as "a type-directed, transitive service join under provider bindings, which generalises a one-level, name-matched rule in Rima et al.'s implementation". Add "on the corpus their tool places no navigation from a service".

### R2-W2r: Assumption A3 is uncounted, and it interacts with the no-dependency configuration (residual of W2)
**Severity**: Minor
**Evidence Anchor**: `text: Section 3.1 p. 28, "The edges resting on A3 and A4 are not counted"`
**Confidence**: 4

A3 ("a call with no body in the application starts no navigation") is optimistic in the direction that makes a must edge false. With dependencies not installed (p. 83), every call on a library-typed receiver falls under it. Table B.1 records 1111 unresolved calls (p. 115). A4 (the activation model) cannot be counted statically. A3 can: the demotion pass already enumerates the code after each site.

**Fix**: report how many of the 159 must edges have at least one unresolved call after the site. If the count is 0, say so; that would strengthen the claim.

### R2-W4r: Model-only material remains in Chapter 3 (residual of W4)
**Severity**: Minor
**Evidence Anchor**: `text: Algorithm 1 p. 40, "model only: runs as the user leaves r"`
**Confidence**: 5

See note W4 in Part 1. **Fix**:
- drop lines 9-14 and the D and T terms from Algorithm 1, or move them into the 3.2.7 paragraph;
- mark the canDeactivate and interceptor rows of Table 3.3 as model-only;
- fold 3.2.4 and 3.2.5 into 3.2.7.

This recovers about 1.5 pages and removes the source of N2.

### R2-W6r: The zero-information target policy is unchanged, and two instances of it now carry the headline costs (residual of W6)
**Severity**: Minor
**Evidence Anchor**: `text: Table B.1 p. 114, "An empty prefix connects the site to every declared route except the root."`
**Confidence**: 4

Two sites drive the costs:
- **39.4 % of edges** come from `view-transaction.component.ts:135`, a template literal with an empty static prefix (p. 78).
- **Most mifos pairs, and hence the 6.5 % precision**, come from the shell's notifications tray. Its target opens with two parameters, so after the repair of Table A.1 it reaches every account screen from every screen (p. 68; `thesis/appendix.tex`, "Figure" row).

A target with no static segment goes to the `u_` sink with `unknown` (p. 114). A target whose static information is a parameter shape is fanned out over every matching route at ⊤ scope. In both cases the target carries almost no information, yet the two are treated differently.

Reporting has improved: chance baselines, the shell explanation in the abstract, and the 39.4 % in Table 7.1. The policy itself remains a design choice that the thesis states but does not defend.

**Fix**: X-06 stays optional. As a minimum, add one sentence in 6.3 or Ch. 7 saying the two costs come from this one policy family.

### R2-W7r: `unknown` is still described inconsistently (residual of W7)
**Severity**: Minor
**Evidence Anchor**: `text: Def. 3.1 p. 25, "never denotes a screen, a route or a navigation target"`
**Confidence**: 4

The same section says `unknown` "carries the destinations the analysis cannot name" (p. 26). **Fix**:
- delete "or a navigation target" in Def. 3.1, or the "carries" clause on p. 26;
- in 2.6.1, write "inspired by" instead of "adopts" (p. 18).

### R2-W8: Android sentence unchanged (persisting)
**Severity**: Minor
**Evidence Anchor**: `text: Section 2.10 p. 23, "and the Android work handles them with dynamic evidence"`
**Confidence**: 2 [FIELD-NORM UNVERIFIED]

The round-1 fix stands. Either re-check [77] and [78] for fragments, menus and dialogs, or narrow the sentence to ProMal [45]. Add one line placing intent and inter-component target resolution as out of scope.

### R2-W10: Guard-redirect (UrlTree) edges are missing from the stated limits (persisting)
**Severity**: Minor
**Evidence Anchor**: `text: Ch. 7 p. 96, "the guard relation is replaced by a stand-in"`
**Confidence**: 4

The sign-in redirect is the most common edge in signed-in applications, which are the type the introduction names. Every measured graph lacks it (p. 34). **Fix**: add one clause to the Ch. 7 open items and to the abstract's limits sentence.

### R2-W11r: Peripheral Chapter 2 material remains (residual of W11)
**Severity**: Minor
**Evidence Anchor**: `text: Section 2.8 p. 21, "found comprehension better in reactive code in an experiment with 127 subjects"`
**Confidence**: 4

The p. 21 paragraph on debugging studies and the p. 17 empirical type-system sentences support no design decision. Cutting them saves about one page toward the length target, which the body (89 pages) still misses.

### N1: The abstract's RQ1 sentence says more than Claim 3.1 and lost the toolbar caveat (new)
**Severity**: Minor (must-fix, because it is the abstract's first result)
**Evidence Anchor**: `text: Abstract p. 1, "The corpus yields 159 edges that always fire"`
**Confidence**: 5

The body gives three qualifications:
- Claim 3.1 holds only relative to A1-A4 (p. 28);
- it is tested only as a necessary condition, with 62 destinations unread (p. 78);
- 125 of the 159 edges come from one toolbar whose scope is untested (Table 7.1, p. 93).

The round-1 abstract carried the toolbar caveat; the revision dropped it while strengthening the verb.

**Fix**: "159 edges claimed to fire whenever their code runs (125 from one toolbar whose scope is untested), 33 without ...".

### N2: The relation count is now inconsistent across chapters (new, introduced by the REV-15 restructure)
**Severity**: Minor
**Evidence Anchor**: `text: Section 3.4 p. 39, "least fixpoint over four input relations. The prototype implements three of them"`
**Confidence**: 5

The four statements disagree:
- **Section 3.2 (p. 30):** "specified here over three input relations", "implements all three", plus two further relations in 3.2.7.
- **Section 3.4 (p. 39):** four relations, of which three are implemented.
- **Section 6.4 (p. 90):** "the four input relations of Section 3.2".
- **Ch. 7 (p. 96):** "three of its four input relations".

These are stale wordings from the round-1 structure, in which the four were N, outlets, CG and D. **Fix**: use the 3.2 wording everywhere (three implemented, D and T as extensions).

### N3: Two cross-references point to the wrong section (new)
**Severity**: Minor
**Evidence Anchor**: `text: Section 1.2 p. 11, "lists what it approximates (Section 2.6.2)"`
**Confidence**: 5

- Section 2.6.2 is the soundiness background. The list of approximations is Section 6.3 and Table B.1 (`ch1-introduction.tex` uses `\ref{sec:soundiness}`).
- A2 (p. 28) cites Section 3.2.3 for "no final must edge rests on such a join". That statement is in Section 3.3 (p. 36).

### N4: Author placeholders are left in the body (new)
**Severity**: Minor (must-fix before submission)
**Evidence Anchor**: `text: Section 4.3.2 p. 50, "[author: archive DOI; a repository URL would name the extractor]"`
**Confidence**: 5

There are four placeholders:
- p. 50, as quoted above;
- p. 50: "[author: confirm, per rima/PREREGISTRATION.txt:27]";
- p. 88 (Table 6.1): "[author: state whether the proposing tool was shown]";
- p. 52 (Table 4.1 note): "(confirm at the pinned commits)".

The licence status of Rima et al.'s checkout is therefore still unconfirmed in the text.

### N5: Section 6.1 attributes the small tier to authentication, against its own sensitivity figure (new)
**Severity**: Minor
**Evidence Anchor**: `text: Section 6.1 p. 82, "The small must tier is largely this fact"`
**Confidence**: 3. Guard-only is measured in edges and the census in constructs, so the comparison is indicative.

"This fact" refers to guards deciding on state the source does not fix. Yet admitting every guard raises the tier only from 159 to 203 edges (the next sentence). Table 5.1 counts 174 guard-only constructs of 1657. Guards alone therefore explain a minority. What the data support is the abstract's and 5.1's wording: the definition, applied across all of the application's decisions.

**Fix**:
- replace "this fact" with "the definition of must";
- report the 203 figure, and its 44 guarded edges, in Section 5.5, which p. 82 cites but which does not hold it.

### N6: Flow defects left by the cuts (new)
**Severity**: Minor
**Evidence Anchor**: `text: Section 6.4 p. 91, "rules out; Carrying the Angular reading into the Vue extractor"`
**Confidence**: 5

- **Broken sentence.** The sentence quoted above, on p. 91, is broken.
- **Non sequitur.** On p. 82, the count of edges resting on A1 and A2 is followed by "so a query that must not miss a transition cannot be answered". A1 and A2 concern false must edges, not missed transitions.
- **Repetition.** Section 5.3.6 (p. 70) gives the Oshima-Kishi admission count twice: "these alone admit none of the six applications", and again at the end of the subsection.

### N7: The abstract and Chapter 6 disagree on the primary summary of RQ3 (new; noted for consistency, the substance is R1's)
**Severity**: Minor
**Evidence Anchor**: `text: Table 6.1 p. 86, "per-application median, 40.2 %, is the primary"`
**Confidence**: 3

The abstract leads with the pooled 66.7 % and does not give the median. Table 7.1 (p. 94) leads with the median. **Fix**: align the abstract with Table 7.1.

---

## Part 3. Corrections to my own round-1 report

1. **W5 (iv) was wrong.** I wrote that the repaired graph loses the three airbus reference pairs. It does not.
   - `rima/results-RimaRep.json` shows airbus held at full 3/3, with the same reference pairs as before.
   - The three pairs the repair removed are non-reference pairs: `/login → /add`, `/login → /getAllProducts`, `/login → /productByCategory`. These were read as spurious (`rima/spurious-causes.json`: "attribution").
   - The editor was right that the arithmetic (68 to 69/73) did not fit my reading.
   - The revised sentence is still ambiguous: "loses the three airbus pairs from the sign-in screen, which the source does not hold" (p. 72). It follows directly on the three airbus reference pairs, one of which (`/login → /dashboard`) also starts on the sign-in screen. It should name the pairs or say "three non-reference pairs".
   - The rest of W5 stands, now with direct evidence (R2-W5).
2. **W6 put the 6.5 % precision on the wrong site.** The site that yields 39.4 % of edges (`view-transaction.component.ts:135`) does not dominate the mifos pairs. The pairs, and hence the 6.5 %, are dominated by the shell's notifications tray. The revised abstract's explanation, "most of whose pairs only the shell reaches", is the correct one. The policy concern stands, because both sites belong to the same policy family (R2-W6r).

---

## Strengths of the revision (domain view)
- **Assumptions made explicit.** A1-A4 are numbered, each with its class of counterexample and the number of edges that depend on it where counted (p. 28). "Lower bound relative to" is used consistently (pp. 28, 82, 96).
- **May tier recast.** It is a "design intent", with the rules that under-approximate listed (pp. 30, 90).
- **Formal properties scoped.** They are limited to the fixpoint core, and the fallback's lack of monotonicity is stated (pp. 31, 38).
- **Ablation levels qualified.** The levels are now plainly "not runs of either tool" (p. 66). The novelty is qualified as relative to "published rules" (p. 94). This qualifier is necessary but not sufficient (R2-W5).
- **Chance baselines.** They now accompany the end-to-end hit rates (pp. 45, 68, 94).
- **Title and contribution order.** They now match the evidence (title page, pp. 10, 95).

## Recommendation rationale
In round 1 my recommendation rested on three things: W1, W2 and W3 (the readings of the tiers), W4 (formal model versus prototype), and W5 and W6 (positioning and the fan-out). W1 to W4 are now substantially fixed, and their residuals are presentational. W6 is now reported honestly. W5 is the one Major item left. It was a must-fix in round 1 (REV-09) and was not done. The repository shows that the claim, as worded in Ch. 7, Table 7.1, Fig. 3.1 and 5.3.6-5.3.7, is contradicted by the tool the thesis itself ran.

The fix is bounded and text-only. It needs about six sentences and no new measurement, because the evidence is supplied above, and the contribution survives in narrowed form on the corpus. For that reason the right call is Minor Revision, not Major. The conditions are R2-W5, N1, N2 and N4. W10, W8 and N3 are one sentence each. The other items are optional.

**Recommendation: Minor Revision.** Items: 6 addressed, 8 partly addressed, 3 not addressed, out of 17.
