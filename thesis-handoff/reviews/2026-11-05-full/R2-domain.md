# Peer Review Report

## Manuscript Information
- **Title**: Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications (D. K. Tran, Aalto, 5 Nov 2026, 124 pp.)
- **Review Date**: 2026-11-05
- **Review Round**: 1
- **Dispatch note**: single-call review; sprint-contract and blind-commitment phases not used.

## Reviewer Information

### Reviewer Role
Peer Reviewer 2 (Domain)

### Reviewer Identity
Static-analysis researcher for JavaScript and web frameworks. Knows GUI-model extraction (window transition graphs/GATOR, StoryDroid, GoalExplorer) and dynamic crawling (Crawljax, FRAGGEN). Blind spot: statistical estimation (not assessed here).

### Review Focus
(1) Soundiness and the must/may/unknown semantics: is the must tier a lower bound? (2) Scope attribution as dataflow: lattice, levels, service join. (3) Positioning against Oshima and Kishi, Rima et al., VeriFlow, and whether the "no earlier work places navigation inside services" claim holds. (4) Whether the four repairs and the one-segment assumption are stated as assumptions with known counterexamples.

## Overall Assessment

### Recommendation
**Major Revision**

### Confidence Score
4. Static analysis and the Android and web literature are inside my expertise. Statistical aspects (Wilson bounds, sampling) are outside it and not assessed.

### Calibration Status
`NOT_CALIBRATED`

### Summary Assessment
The thesis builds a static Angular extractor with a three-valued modality (must/may/unknown). It measures construct-level loss on six applications and proposes scope attribution, a powerset-lattice dataflow analysis that places shell, shared-component and service navigation on screens. Domain-wise the work is unusually candid. The soundness claim is narrowed to an execution model, true, computed and reference scopes are separated, and Table 6.3 sorts misses by static boundary. The formal story and the evidence do not line up, though. (a) The evaluated prototype is not the specified least-fixpoint analysis, and the must/may tiers are used in ways that make both headline readings ("almost nothing is deterministic"; "may is an upper bound") partly artefacts of definitions. (b) The positioning claim that no earlier work places navigation inside services rests on a reading of Rima et al.'s specification, although their tool was run and its output contradicts that reading on airbus. (c) The "attribution of services" contribution is carried by 36 sites (2.0 % of the corpus), one hand-read application (alfresco, 16 sites) and 3 airbus pairs that the repaired run no longer supports. The supervisor's shortening request is best met by cutting model-only material and peripheral literature (W4, W11). My decision weights W1–W6.

## Strengths

### S1: The must-tier claim is stated with its execution model and tested only as a necessary condition
Claim 3.1 lists the cases it excludes (cancelling libraries, second listeners, modifier-key activation). The text says plainly that the witness check "establishes that every cited site exists", not the claim itself. This is the soundiness discipline of Livshits et al. applied honestly.
**Evidence Anchor**: `text: Section 3.1, p. 32-35, "The execution model is part of the claim and not a detail"`

### S2: True, computed and reference scope are kept apart, and the empty scope is split into unreachable and unresolved
This removes the usual conflation of "analysis output" and "ground truth" in GUI-model papers. Unresolved sites are anchored at an unplaced origin, so they stay countable.
**Evidence Anchor**: `text: Section 3.2.2, p. 36-37, "No true scope is established anywhere in this thesis"`

### S3: Nested ablation levels with a machine-checked subset condition
The five levels (owned, nesting, rooted, outlet, full) are checked to nest, and the output is refused otherwise. The thesis states that the earlier mechanisms are reimplemented inside the extractor, not run.
**Evidence Anchor**: `table: Table 5.13, p. 76; Section 5.3.3 p. 76, "are not runs of either tool"`

### S4: Runtime route oracle as an external check on node extraction
It exposed defects both static readers shared (named-outlet subtrees, barrel-loaded lazy modules). That is the correct response to the shared-blind-spot problem.
**Evidence Anchor**: `text: Table 4.5, p. 59, "both static readers read the subtree alike"`

### S5: Inside/outside-static-boundary classification of remaining misses
Table 6.3 and Section 6.3.1 separate known tool limits from limits of static extraction. They also say the references cannot show an outside miss.
**Evidence Anchor**: `table: Table 6.3, p. 107-108`

## Weaknesses

### W1: The headline "almost nothing is deterministic" is largely a consequence of how modality and guard are defined
**Severity**: Major
**Evidence Anchor**: `text: Definition 3.1 p. 30 and Section 3.2.4 p. 39, "records that a navigation is conditional without recording the condition"`
**Confidence**: 4. Core GUI-model semantics (guarded transitions as in Ricca and Tonella, WTG).
Definition 3.1 gives every edge a guard component g beside the modality m. Section 3.1 and Table 3.2 demote to may every navigation under an `@if`, a branch, a callback, a router guard, or any condition. The prototype then does not write the enclosing condition into g. The edge therefore loses the condition and is also pushed into the tier whose evidence is weakest. A link under `@if (user())` is deterministic given its recorded guard, and a guarded-transition model would put it in must with g. Instead the abstract's first result ("almost no navigation can be extracted as a deterministic transition", 1.4 % on mifos) mostly measures that must means unconditional on any template or code condition. Table 5.1 then reads "1631 of 1657 sit behind a decision of the application" as a property of the applications. The census itself notes that "a guard that always lets the navigation through still counts as a guard", and removing only that effect moves the tier from 159 to 203 edges (p. 94). A reader of the abstract will take "deterministic" in the guarded-transition sense.
**Fix**: (i) Add to the abstract and RQ1 text a one-line definition: "must = fires on every execution of the enclosing code, with no template, code or router condition". (ii) Report a second figure, the share of constructs that are unconditional given a recorded condition. This needs the enclosing condition written into g, which the thesis says an optional mode already does (p. 39). (iii) Retitle the RQ1 answer so it does not imply the extractor or static analysis cannot find deterministic transitions.

### W2: "The must tier is a lower bound" (p. 94) is stated more strongly than Claim 3.1 supports
**Severity**: Major
**Evidence Anchor**: `text: Section 3.1 p. 33, "without it the must tier holds 33 of its 159 edges"; Section 6.1 p. 94, "the must tier is a lower bound"`
**Confidence**: 4
Claim 3.1 holds only under (a) the route-order assumption, on which 126 of 159 must edges rest, (b) exclusion of edges placed through ambiguous selector joins, and (c) an execution model. The execution model includes the rule that a call the reader cannot resolve "is taken not to navigate" (p. 34, Table 6.2 p. 106). That rule is optimistic exactly in the direction that makes a must edge false, and it applies to calls into libraries and untyped receivers. With dependencies not installed (p. 96), unresolved receivers are a mainstream case, not an edge case. The test (the witness check) cannot see any of the three: 0 failures among 159 with 62 destinations unread, and the demotion rules are "not independently verified" (p. 35). The route-order assumption is "unread registration order", with known counterexamples (a catch-all in a table registered earlier), and the extractor merely names dismissed catch-alls in a note. As a result Section 6.1's sentence and the abstract's "159" read as a lower bound on navigation, whereas the evidence supports "159 edges that hold if A1–A4 hold".
**Fix**: List the assumptions as numbered A1–A4 in Section 3.1, each with its counterexample class and the number of must edges that depend on it (126 for A1; the unresolved-call rule needs a count that is currently absent). Replace "is a lower bound" in 6.1 and Chapter 7 by "is a lower bound relative to A1–A4". Report how many of the 159 edges contain at least one unresolved call on the path that the rule skipped.

### W3: The may tier is called an upper bound, but several documented rules under-approximate it
**Severity**: Major
**Evidence Anchor**: `text: Section 3.1 p. 35, "An excess may edge ... costs only precision"; Table 6.2 p. 105, "drawn as a single edge to the first declared route"`
**Confidence**: 4
Section 3.1 reads may as the over-approximation of a modal transition system ("meant to contain every transition ... between its declared screens"). Table 6.2 documents rules that choose one outcome from a set of possible ones: (i) a commands array with trailing constants becomes one edge to the first matching route, and "no note records the omission"; (ii) an interpolation in a command is assumed to be exactly one segment (the Table 4.5 comparison rows, with the corpus counterexample `[cancelRoute]`, which "can be ../../"); (iii) a catch-all in a later registered table is assumed to match last; (iv) the dispatch relation is not implemented, so the screen that dispatched an effect "is never recovered"; (v) programmatic dialogs and overlays have no node. None of these can be said to over-approximate, and several (i, ii) are exactly the kind of "four repairs and one-segment assumption" that should be an enumerated assumption. In addition, the 12/22→19/22 repair history and the 68→69/73 repair on Rima's subjects show these rules were tuned against the same data on which the may-tier recall is then measured. The "upper bound" wording is therefore a design intent, not a property, and Chapter 3 should not present it as the latter.
**Fix**: Replace the "upper bound" paragraph by a list of the may-tier rules that are known not to over-approximate, each with its counterexample (command value containing "/", "..", or more than one segment; second route with the same pattern). Mark them as assumptions A5.. in the same list as W2. Where possible switch the rule to over-approximation: for (i), emit edges to every matching route, not the first; for (ii), emit a sink edge or a prefix fan-out when the segment count is unknown.

### W4: The evaluated analysis is not the specified analysis, and Chapter 3 spends most of its length on the specified one
**Severity**: Major
**Evidence Anchor**: `text: Section 3.2 p. 35-36, "implements three of the four input relations"; Section 3.3 p. 43, "not the least solution of the constraints"`
**Confidence**: 5
Chapter 3 defines a least fixpoint over four relations and proves termination and order independence from monotonicity. The prototype implements N, outlets and CG, replaces T and D by stand-ins, omits the routed-component propagation, adds two fallbacks (one admittedly not monotone), joins application-wide over provider bindings, and thus "is not the least solution of this system or of any restriction of it" (p. 42). Algorithm 1 carries three "model only" lines, Figure 2.1 and Section 3.2.5 show an `unknown` effect edge "no pass emits", and Table 3.3 has rows for guards, interceptors and NgRx that are not evaluated. The result is that the formal contribution (lattice, monotonicity, least solution) and the measured contribution (a heuristic with fallbacks) are two different objects, and the properties stated for the first (including Claim 3.2 on expansion) say nothing about the second. A careful reader must keep a ledger of which sentence concerns which. This is also the largest block of text that does not support a result.
**Fix**: Define the implemented analysis as the thesis's analysis: three relations, two stand-ins, two fallbacks, as a worklist algorithm with the fallbacks as a labelled post-pass. State the monotone/least-solution result for the fixpoint core only. Move the full four-relation model (D, T, injector hierarchy, UrlTree guards, effects) to a one-page "extensions" section or to future work. Drop the unimplemented `unknown`-for-effects edge from Figure 2.1. This removes about 3 to 4 pages (Algorithm 1 notes, Table 3.3 rows, 3.2.4 and 3.2.5) and answers the supervisor's request to shorten.

### W5: The claim that no earlier work places navigation inside services rests on a reading of a specification, and the thesis's own data contradict part of it
**Severity**: Major
**Evidence Anchor**: `text: Section 5.3.7 p. 83, "the construct the specification's rule does not follow"; Chapter 7 p. 114, "accounts for the transitions it adds over their rules"`
**Confidence**: 4. I checked repository files (rima/STUDENT-READING.md lists airbus `/login` → `/add`, `/getAllProducts`, `/productByCategory` among Rima's tool's pairs) and the thesis's own repaired row.
Section 2.4 admits that the account of Rima et al. is "taken from the publisher's abstract, the operational specification ... and the anonymised manuscript"; "the published chapter was not available". The abstract and Table 5.17 nevertheless state, without that qualifier, that attribution "unlike the mechanisms of earlier work ... places navigation inside services". The evidence is: (i) 20 of 48 service constructs recovered, measured against the thesis's own baseline; (ii) 36 service/guard/effect sites, 2.0 % of the corpus total; (iii) alfresco's reference (16 sites, 174 pairs, built by an AI assistant, 17 sites left undetermined), where the full level loses 9.4 points of precision at one site; (iv) the 3 airbus pairs between the outlet and full levels. The tool was run (Section 5.3.8), so the question can be settled directly. Point (iv) is undermined by the thesis itself: Rima's tool holds all 73 reference pairs "by construction", including those 3 airbus pairs, so the tool already produces them. Section 5.3.7 later removes those three pairs as spurious sign-in-screen pairs ("the source holds no such transition"). Chapter 7 still lists them as what the service join "accounts for". After the repair the outlet-to-full difference is no longer attributed to any documented service navigation.
**Fix**: (i) Inspect Rima's output on airbus and on the corpus services and report whether the tool places any service-hosted navigation (the tool is available at commit f33003f). (ii) State the positioning as "according to the published specification" if no tool run settles it. (iii) Repair Chapter 7's sentence and abstract wording to match the repaired Table 5.18 (which pairs separate outlet from full after the repair?). (iv) In the abstract say that the service-join evidence is 36 sites and one hand-read application.

### W6: One target-resolution policy dominates the graph and the 6.5 % precision comparison
**Severity**: Major
**Evidence Anchor**: `text: Section 5.5.3 p. 91, "39.4 % of all edges (5454) come from one call site"; Table 6.2 p. 105, "An empty prefix connects the site to every declared route"`
**Confidence**: 4
One `navigateByUrl` to a template literal with an empty static prefix yields 5454 edges (39.4 %) and drives mifos to 161 363 pairs and precision 6.5 % against 80.0 %. A fully dynamic target is sent to the `u_` sink with `unknown`, which is the sound and cheap treatment. An interpolation-led target (no static segment) is fanned out to every route, which is an equally unknown target recorded as 600 edges. This is an inconsistent treatment of the same semantic situation (target carries no static information), and it determines 39.4 % of the edge count, the e2e density (162 567 of 367 236 ordered pairs, 44 %, so a hit rate near 44 % is expected by chance), and the "6.5 % against 80.0 %" line in the abstract. The abstract uses this number to describe the extractor, whereas it measures the fan-out policy.
**Fix**: Treat a target whose static prefix has zero segments as fully dynamic (sink, `unknown`). Alternatively cap fan-out at k candidates. Re-run the Rima comparison and the e2e check, and state the expected-by-chance hit rate beside 19/22. If the fan-out is kept, say in the abstract that one site accounts for 39.4 % of edges.

### W7: The `unknown` modality is defined as a confidence label but is used as "unresolved target", and its order conflicts with the cited modal transition systems
**Severity**: Minor
**Evidence Anchor**: `text: Section 3.1 p. 31, "Carrying this modality and reaching a node that is not a screen coincide"`
**Confidence**: 3
Definition 3.1 says modalities "never denote ... a target", but on every corpus edge `unknown` coincides with the sink target, and the order is `unknown < may < must`. In Larsen and Thomsen, must-transitions are a subset of may-transitions, so must implies may and "unknown" has no place in the order. A reader from the MTS literature will expect must ⊆ may. The thesis in effect uses a confidence scale, not an MTS.
**Fix**: Call the modality a confidence label throughout and say once that it is inspired by, not an instance of, MTS. Either remove `unknown` from the edge modality set and mark sink edges by target kind, or keep it and drop the "never denotes a target" sentence.

### W8: The Android comparison generalises from one paper, and inter-component resolution work is not discussed
**Severity**: Minor
**Evidence Anchor**: `text: Section 2.10 p. 27, "the Android work handles them with dynamic evidence"`
**Confidence**: 2. [FIELD-NORM UNVERIFIED] for the missing-literature part; I did not check the thesis's own cited WTG papers [77, 78] for fragments and background tasks.
The statement that fragments, background tasks and aliased widgets are handled "with dynamic evidence" is sourced to ProMal [45]. The WTG journal version [77] and the callback analysis [78] are cited in the same chapter, and the thesis should check what they do with these cases. Android static work that resolves inter-component targets by constant propagation (the IC3/Intent line) is the closer analogue of the thesis's target resolution (Table 6.2 "Computed targets") and is not discussed.
**Fix**: Re-read [77], [78] for fragments/menus/dialogs and rewrite the sentence with their treatment. Add a sentence on constant-propagation-based target resolution in Android, or say that it was not reviewed.

### W9: Not installing dependencies weakens type-directed resolution; its effect is not measured
**Severity**: Minor
**Evidence Anchor**: `text: Table 6.1 p. 96, "TypeScript compiler cannot resolve types from the framework"`
**Confidence**: 3
Chapter 5 states that figures are properties of the no-dependency configuration. Chapter 3's call graph resolves receivers by declared type, and the must rule treats unresolved calls as non-navigating (W2). Whether the Angular `Router` type, third-party navigation helpers and base classes resolve is the main determinant of CG quality, yet no number says how many receivers lose their type.
**Fix**: Install dependencies on the smallest application (realworld) and on one mid-size one, and report the changes in resolved calls (the thesis already counts 5574/4937/18/1111 resolutions) and in the must tier.

### W10: Guard redirects (UrlTree) are a main Angular navigation pattern, and the evaluated graph lacks them
**Severity**: Minor
**Evidence Anchor**: `text: Section 3.2.4 p. 39, "Treating guards only as labels on inbound edges misses this edge class entirely"`
**Confidence**: 3
Section 3.2.4 says correctly that an auth guard returning a UrlTree is itself a navigation from the screen the user is leaving. The prototype does not implement it, and the guard stand-in can be "too small ... and too large". The login redirect is the most common edge in signed-in applications, which the introduction names as the typical case. The thesis lists it as a limitation but not in the abstract's or Chapter 7's open items count.
**Fix**: State in the abstract/Chapter 7 that redirect edges produced by guards are absent from all measured graphs. Optionally measure on realworld how many guard-redirect edges the source holds.

### W11: Chapter 2 holds material that no result uses
**Severity**: Minor
**Evidence Anchor**: `text: Section 2.8.2 p. 25, "Salvaneschi et al. ran an experiment with 127 subjects"`
**Confidence**: 4
No pass handles effects or subscriptions (p. 40, p. 105), so the reactive-programming literature (2.8.1 glitch freedom, 2.8.2 experiments on debuggers), the empirical TypeScript/Flow studies (2.5.3, second paragraph), the Java DI usage and anti-pattern studies (2.7.4, first paragraph) and the mutation-testing background beyond one paragraph (2.9.1–2.9.2) support no design decision. Together they are roughly 5 to 6 pages. Section 2.10 uses them only in one closing sentence.
**Fix**: Cut 2.8.2, the two empirical paragraphs of 2.5.3 and the Laigner/Yang sentences to one sentence each. Keep 2.8.1 as one paragraph that explains why effects are unknown. This is the cheapest part of the "shorten considerably" request.

## Criterion-Bound Judgements

| Dimension / criterion | Criterion source | Judgement | Evidence anchors | Rationale | Uncertainty or scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| Literature coverage of the field | Domain reviewer protocol, Step 1 | PARTLY_MEETS | `text: Section 2.2-2.4, p. 15-17`; W8 | Android WTG, web navigation models, Crawljax line and the three Angular/SPA extractions are covered and compared in Table 2.1. Android inter-component resolution is absent and one Android claim over-generalises | Cannot verify the unlisted-literature part | No |
| Theoretical framework fit (lattice, MTS, soundiness) | Protocol, Step 2 | PARTLY_MEETS | `text: Section 3.1 p. 30-35`; W4, W7 | Soundiness and dataflow are used correctly in principle. The formal properties apply to a model, not to the evaluated prototype, and the MTS order is not the cited one | Soundiness claim is honestly narrowed | Yes |
| Accuracy of arguments | Protocol, Step 3 | PARTLY_MEETS | W2, W3, W5 | "Lower bound" and "upper bound" are stronger than the rules; a positioning claim contradicts the thesis's own repaired data | Some claims are explicitly hedged in the body but not in the abstract | Yes |
| Contribution and positioning | Protocol, Step 4; card item 3 | PARTLY_MEETS | `text: Chapter 7 p. 114`; W5, W6 | The measurement (construct-level loss ledger) is a genuine contribution. The service-placement novelty is thinly evidenced | The tool run (5.3.8) can settle this with little work | Yes |
| Supervisor's 4 Nov requests (domain-visible parts) | Author-provided context | PARTLY_MEETS | W4, W11 | Shortening: model-only Chapter 3 material and Chapter 2 peripheral sections are removable (about 8 to 10 pages together). Readability: Chapter 5 text reports many caveats inline | Other seats cover the abstract and AI statement | No |

## Detailed Comments (domain-relevant only)
- **Abstract**: it is dense with caveats, which is honest but costs readability. After W1, W2, W5 and W6 the three numbered results can be stated in about half the words. The sentence "on the largest its precision is 6.5 % against 80.0 %" needs the one-site explanation (W6).
- **Chapter 1.2**: the scope list mixes limits with claims ("one comparison ... is out-of-sample") and should be reduced to aims.
- **Section 3.2.2**: the chain ⊥ ⊑ {screen(r)} ⊑ subtree(r) ⊑ ⊤ is stated for a route with a component, and the join of two scopes leaves it. This is fine, but the "named elements" are only a storage device, which should be said first.
- **Figure 3.1**: it shows the levels as strictly nested sets of pairs (⊂). In the table (5.13) this is enforced by cumulative switches, so the nesting is a property of the experiment design, not of the earlier tools. The caption should say so.
- **Section 5.3.8 (Table 5.19)**: the row "Corpus without mifos" was added after reading; the Wilson bounds that separate the tools exist only there. Statistical points are left to Reviewer 1.

## Recommendation Rationale
The domain content is serious and the reporting is better than most tool theses. The decision rests on three items that change claims, not wording: W1 (the main empirical finding is partly definitional), W2/W3 (the must-lower-bound and may-upper-bound readings are not what the rules deliver), and W5/W6 (the service-join novelty and the precision comparison depend on a specification reading and a single target policy). None needs new large experiments: W1, W2, W3 and W5 are fixable by re-stating claims and counting assumptions, and W5 and W6 by running tools and re-measuring already built pipelines.

**Recommendation: Major Revision.**
