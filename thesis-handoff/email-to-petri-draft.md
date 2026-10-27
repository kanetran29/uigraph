# Draft email to Petri — review before sending

Not sent. Check the claims about Chapter 7 and the page count after the PDF builds.

---

**Subject:** Thesis draft: Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications

Dear Petri,

The full draft is attached. It follows your review of 21 October and every point in it
is addressed. Here is what changed.

**Chapter 2** grew from about 6 pages to about 14, and section 2.6 on formal
foundations now comes before the Angular mechanisms, as you asked. There are new
sections on static analysis over a source-level syntax tree and what TypeScript's
annotations do and do not contribute, on reactive programming and the boundary it puts
on static dataflow, and on mutation testing, which is the method behind RQ4. Dependency
injection is now treated with the analysis literature rather than the framework
documentation. Jasmine, the Spring work from ASE 2022, is presented as the closest
analogue to resolving Angular's injectors.

**Chapter 3.** Definition 3.1 now defines S, Sigma, G and M separately. You were right
that M needed stating: it is the modality set {must, may, unknown}, a confidence label
on an edge, and the chapter now says so explicitly and adds that it never denotes a
screen, a route or a target. There is an explicit equation for the screen set, the
bottom element is defined as the empty scope, and the anchored-edge union is now
reflexive.

On the lattice you were right and the old text was wrong. The implementation keeps
explicit screen sets, so the domain is the powerset of S with union as the join and the
height is the number of screens, not the depth of the route tree. The bound is now
O(|S| * |E_callgraph|) for the worklist fixpoint, and the part that is actually
implemented, nesting and outlets, is given separately as plain reachability. Section
3.2 also now opens by saying which relations are implemented and evaluated and which
are model only.

**Chapter 4** has a seventh protocol correction, and it concerns the mutation harness
itself. Two defects in it were producing wrong figures. It patched the source by
searching for the text of the construct, so a mutant aimed at one of several identical
constructs edited the first of them instead of its own, which meant that all five guard
mutants for the smallest application removed the same guard. It also judged detection on
the node and edge sets alone, so deleting one of two identical links in a template
counted as a miss although the graph had behaved correctly: it kept the edge, which the
second link still produces, and dropped only the witness pointing at the deleted line.
Detection is now judged on the witness set as well, which is the property that change
impact analysis actually needs. On the same seed and the same sample, correcting these
two moved the detection rate for realworld from 71.4 percent to 95.2 percent. Sampling
is now seeded and stratified with a fixed quota per operator, and the rate is reported
per operator with its n.

**Chapter 5** now makes node extraction the explicit headline rather than attribution.
Ghostfolio's route paths are references into the constant tables publicRoutes and
internalRoutes, so the graph holds a single node that matches none of its 84 declared
screens. In mifos, lazy boundaries and unlinked component nodes compound. In both cases
attribution works as designed and still returns nothing, because it resolves the scope
of a navigation site and then finds no target node to draw an edge to.

**RQ4 is answered** and stays in scope. Of 48 scored mutants across three applications,
39 were detected: 95.2 percent for realworld, 81.8 percent for alfresco and 62.5
percent for bitwarden. Renaming a route path was detected in all 22 scored cases. Every
change that produced no graph response at all was a guard removal, and six of those
eight are guards declared on a route whose path is the empty string. A second method
confirms the defect: in realworld both children of the editor route declare
canActivate: [requireAuth], and in the graph the edge entering /editor/:slug carries the
guard while the edge entering /editor carries none.

I also ran the same mutants against the baseline graph, which answers something RQ3
leaves open. Attribution does not raise the detection rate for an individual change,
from 92.3 to 95.2 percent on realworld. What it does is widen the part of the source the
graph responds to at all: the number of mutants that can be scored rises from 13 to 21,
and the link deletion operator goes from entirely excluded, because no link in the
application shell produces a baseline edge, to six of six detected.

A large share of mutants had to be excluded because the construct they change is absent
from the graph. Those exclusions are the coverage gap already counted under RQ1, so the
detection rate is conditional on coverage and is reported that way.

**Chapter 6** is written: key findings, limitations and threats to validity, the declared
approximations with measured prevalence, the note that the React and Vue comparison is a
qualitative analysis rather than a measurement, and future work. The corpus limitations
you named are in 6.2, including the tool-driven selection bias that Spartacus exposes
and the inverse relation between application size and user-interface test density. Your
three recommendations, an automated search pipeline over a larger pool, an industrial
case study and a minimum test-density criterion, are in 6.5.

On NgModule against standalone routing, I measured it instead of claiming it. The guard
defect appears in realworld and alfresco, which declare standalone route arrays, and in
bitwarden, which uses NgModule routing modules, so it is not a difference between the
two styles. The thesis makes no other comparison between them, because nothing else was
measured across them and the corpus is not stratified by them.

**Chapter 7** is written: one sentence per research question, then the contributions.

The thesis also now carries a short statement on the use of AI tools, as Aalto asks.

**After your review I ran an internal review of my own**, which found four claims the draft
was making past its evidence. All four are corrected. I mention them because two change
figures you will look for.

The thesis said it "proves" the soundness property. It does not: the property is stated
and mechanically tested, and one must edge in the corpus violates it. That is now said
where the claim is made rather than only in Chapter 5.

The before and after figures came from one commit of the extractor run twice with the
attribution pass disabled and enabled, not from two tagged versions as Chapter 4 said.
One commit is the stronger design, since it rules out every other difference, so the
chapter now says that and claims the advantage.

I had written that the 468 constructs the loss rules assign to attribution are an upper
bound on what attribution can recover. The harness contradicts it: of the 79 constructs
gained on the deterministic tier, 38 come from the attribution classes and 41 from the
node classes, 40 of those from lazy boundaries. So the two levels of failure are not
separable by the rules that classify them, and both chapters now say so.

The recovery figure of 81 summed the deterministic and the may tier. The deterministic
recovery is 38. Both are now reported separately.

Two further things came out of it that you may want to look at first. The differential
test disagrees in both directions and I had only reported one: the parser holds no
declared screen for 197 of the 338 nodes in the corpus. Table 5.3 decomposes all 197, and
the largest group, 143 nodes, sit at paths where the parser found no route of any kind,
117 of them in mifos against a single blind spot. I could not resolve that with the
methods I have, so I report the disagreement rather than explaining it away. And the rule
that a defect class needs two independent methods turned out to be stated more strongly
than it was applied: three of the five accepted classes rest on one method plus an
observation, attribution among them. The rule now reads as it was applied and the table
separates the two kinds of evidence.

Open items I am aware of:

- The preamble is still the report-class preview. I need aaltothesis.cls and
  aaltologo.sty before the submission build.
- 17 of the remaining attribution losses are still unexplained and will be inspected by
  hand.
- The candidate defect class "node not linked to its component" still has only one
  confirmation, so it is reported as a candidate.
- Mutation covers three of the six applications, because every mutant needs a full
  re-extraction.

Two questions:

1. Is the conditional framing of the detection rate acceptable to you, that is,
   excluding mutants whose construct the graph does not contain and reporting the
   exclusions alongside the rate? The alternative is to count them as misses, which
   would mix the sensitivity result with the coverage result.
2. Would you like the industrial case study pursued for this thesis, or left in future
   work?

Thank you for the review. It found a genuine error in the lattice argument and the
mutation protocol is in much better shape for having been questioned.

Best regards,
Duy Khanh Tran
