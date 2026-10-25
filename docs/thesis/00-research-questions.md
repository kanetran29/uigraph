# Research questions and scope

## Setting

Static extraction of UI transition graphs is well studied for Android and almost entirely
absent for web single-page applications, where the existing work is dynamic: crawl or trace
based, hence incomplete and without guard information. This thesis asks how well static
extraction can work for Angular applications, where it fails, and whether the largest
failure class can be repaired by an algorithm rather than by engineering effort.

## Questions

**RQ1 — How much of a real Angular application's navigation is statically extractable?**
Measured as the fraction of navigation constructs present in the source that become
deterministic (`must`) transitions in the extracted graph, over a corpus of six applications
spanning 14 to 674 declared routes.

**RQ2 — Where does extraction break, and why?**
A classification of defects, each corroborated by at least two independent oracles, with a
prevalence figure per class.

**RQ3 — Can the largest defect class be removed by an algorithm?**
Attribution — determining which screens a navigation site can fire from — is formulated as a
scope-valued dataflow analysis. The question is whether it raises RQ1's measure, and by how
much, under the same protocol.

**RQ4 — Does the resulting graph support change impact analysis?**
Measured as sensitivity: the fraction of injected source changes that produce a corresponding
change in the graph. A change the graph cannot see is a change impact analysis would miss.

## What is deliberately not claimed

**Completeness is not claimed and cannot be.** Dynamic navigation — computed route strings,
indirection through values not known until runtime — makes the complete edge set undecidable
in general. The thesis proves *conditional soundness* over a declared scope and *measures*
recall against oracles. This follows the soundiness position (Livshits et al., "In Defense of
Soundiness"): the analysis is sound modulo a published list of approximated constructs, and
that list is a deliverable rather than an apology. It is in [50-scope-and-threats.md](./50-scope-and-threats.md).

**No claim is made about agent performance.** Whether a coding agent performs better with the
graph than without it is a separate question requiring a controlled experiment with a pinned
model and a declared token budget. It is out of scope here and is stated as future work rather
than asserted.

**No claim is made about generality beyond Angular.** The formal model is framework-agnostic;
the measurements are not. Other adapters exist but are unmeasured.

## Corpus

Six open-source Angular applications, pinned to exact commits, chosen so that route-tree size
spans two orders of magnitude and so that guard density, lazy-loading style and navigation
mechanism vary. Selection criteria and the screening that produced them are recorded in
[30-evaluation-protocol.md](./30-evaluation-protocol.md).
