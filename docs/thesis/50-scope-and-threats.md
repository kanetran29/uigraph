# Declared scope, approximations, and threats to validity

The approximation list is a deliverable, not an apology. Every item carries a prevalence
figure measured over the pinned corpus, so a reader can judge what the exclusions cost. A
thesis that says "I cover X, not Y, and here is how much of real applications Y accounts for"
is stronger than one that is silent about Y.

## Measured prevalence of navigation mechanisms

Counts over the pinned corpus (occurrences in source):

| application | `dialog.open` | routerLink | router.navigate | aux outlets | `relativeTo` | TemplateRef | NgRx effects |
| --- | --- | --- | --- | --- | --- | --- | --- |
| realworld | 0 | 40 | 11 | 0 | 1 | 2 | 0 |
| alfresco | 8 | 5 | 108 | 8 | 2 | 78 | 60 |
| ghostfolio | 6 | 308 | 45 | 0 | 8 | 34 | 0 |
| k8s dashboard | 1 | 57 | 4 | 1 | 3 | 51 | 0 |
| bitwarden | 0 | 39 | 174 | 0 | 7 | 159 | 0 |
| mifos | 355 | 1042 | 582 | 0 | 279 | 1112 | 0 |

`@defer` occurs zero times across the corpus and `canMatch` three times in total. Both are
excluded on grounds of measured irrelevance rather than convenience.

## In scope

- component nesting with import-scope resolution (NgModule and standalone)
- router outlets, including named and auxiliary outlets
- structural-directive conditions collected along the containment path
- a DI-aware call graph, with the resolution approximations listed below
- guards, resolvers and interceptors as program points that can themselves navigate
- dispatch relations, so NgRx effects and router event subscriptions participate in the fixpoint
- relative navigation, where the edge target becomes a function of the source scope

## Out of scope, with reasons

| excluded | prevalence | why |
| --- | --- | --- |
| dialogs and overlays as UI states | 355 in one application, present in four | a dialog is a state transition with no URL; the state space becomes a product of route and dialog stack. The model has a `modal` node kind but no composition rule. The largest excluded class, and the first candidate for future work |
| in-page state: tabs, steppers, accordions | not measured | requires deciding whether a tab switch is a transition, which is a modelling commitment the thesis does not need |
| dynamically created components | 84–272 in three applications | `ViewContainerRef.createComponent` and `ngComponentOutlet` create nesting edges that exist only at runtime |
| templates passed as values | up to 1112 occurrences | a `TemplateRef` is defined in one component and rendered in another; the defining site gives the witness, the rendering site gives the screens, and reconciling them is its own problem |
| signal-driven navigation | not separately counted | firing condition is a data dependence; recorded as modality `unknown` with the read set as symbolic guard |
| locale-dependent route configuration | observed in one screened-out application | route paths that differ per locale |
| `@defer` blocks, `canMatch` | 0 and 3 | measured irrelevance |
| micro-frontends, module federation | not measured | out of the single-application model |

## Threats to validity

**Construct validity.** Conversion rate counts source occurrences of navigation constructs,
which over-counts: duplicates and repeated targets legitimately collapse into one edge. It is a
lower bound on what is lost, not an exact loss. The counter-argument is that no collapsing rule
explains 113 constructs producing zero edges.

**Internal validity.** Corpus applications carry no installed dependencies during extraction,
so behaviour that depends on resolving imports through packages is untested. Mutation samples
are small and not randomly drawn. Test D's URL extraction is textual and under-samples exactly
the navigation style of most interest.

**External validity.** Six Angular applications, all open source. Enterprise code is unmeasured
and may differ systematically — the one screened-out commercial-backend storefront uses a
configuration-driven router the extractor does not attempt.

**Oracle independence.** Test C's parser is independent by construction but not stronger; in
four of six applications it found fewer routes than the extractor, so its disagreements are
diagnostic rather than authoritative.

**Ground-truth proxy for impact analysis.** Where co-change of source and E2E specs stands in
for "this change broke a test", the proxy misses changes that broke a test without the test
being edited, and counts refactors that touched both for unrelated reasons. CI logs expire after
about ninety days, so retrospective per-run results are not recoverable at corpus scale.

**Experimenter bias.** The extractor's author is also the evaluator. Mitigations actually
applied: oracles that derive ground truth from execution or from authored deltas rather than
from re-reading source; a mechanical, re-runnable harness rather than manual inspection; and the
three self-corrections recorded in [30-evaluation-protocol.md](./30-evaluation-protocol.md),
two of which moved results against the extractor's favour and one for it.
