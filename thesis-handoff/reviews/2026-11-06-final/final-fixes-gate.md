# Final fixes gate (2026-11-06)

| Item | Status | Basis |
|---|---|---|
| F-01 services novelty | PARTIAL | Acceptance criterion met: no sentence credits the service step with transitions over Rima et al.'s tool on their subjects; the Ch. 7 clause is gone. Checked against `softscanner_fa/src/analyzers/business-logic/logic-utils.ts:229-247`: the rule tests `/router\|navigation/i` on the resolved type name of a constructor-injected `this.<svc>.<m>()` and runs only at `depth < 1`. Left: l. 3191 "three non-reference pairs" fix not made; "only this thesis adds" still in three places; two new sentences misparse (abstract "which adds", ch2 gap clause inside a three-item list). |
| F-02 abstract precision | PARTIAL | Comparator, "AI-built" label and self-reference are present, but "source, which applies the analysis's own relations" attaches to "source", garbling the self-reference caveat. |
| F-03 "always fire" | PARTIAL | "125 from one toolbar" is in, but "whose scope is untested" was left out; the decision makes that part required. |
| F-04 census unit | PARTIAL | Rename done in abstract, 5.1, 5.5.1 and Table 7.1 RQ1; generator keys on `file:line:col` (`may-reasons.mjs:101`). Table 5.1 caption and note still say "constructs". |
| F-05 placeholders | PARTIAL | Commit 485fd01 removed every `[author:`, but "(confirm at the pinned commits)" remains at `ch4-evaluation.tex:45`. All six checkouts in `~/personal/uigraph-corpus` are at their pinned commits and licences match Table 4.1. |
| F-06 AI-use statement | PARTIAL | The two false sentences are fixed and now true. TikZ wording matches `HANDOFF.md:206` and `ai-use-draft.tex:38`. Exactly two bib entries uncited (`haydar2004`, `zhang2023repocoder`), no `\nocite`. One stale pointer: "demotion rules of Section 5.5" points at `sec:res-round2` (RQ5 losses) while the rules are in `tab:demotion`. REV-10 table, model names and prose extent are the author's to write and remain open. |
| F-07 length | NOT MET | Cuts to Table 6.1 and Table 7.1 save 0 pages. Build is 117 pp, body pp. 8-96 (89 pp). Needs the supervisor's confirmation or about 9 pp cut. |
| Global | - | Current diff builds cleanly in a scratch copy: 117 pp, 0 undefined refs, 0 overfull boxes. Abstract rendered words 383 to 391 on the same 32 lines (the editor's "-12 words" is wrong). No `\label`, `\cite` or macro lost. Only `\ref` dropped (`sec:res-rima`) went with the clause F-01 required deleting. No result claim got stronger. One caveat lost (F-03). RQ4 "select tests" clause compressed, but ch6:48 and the abstract's "consumer use is not measured" still carry it. |

## Required edits

1. `thesis.tex` l. 96: `(\CensusMustKdash{} from one toolbar)` -> `(\CensusMustKdash{} from one toolbar of untested scope)`
2. `thesis.tex` l. 98: `sit behind a guard or branch of the application.` -> `sit behind an application guard or branch.`
3. `thesis.tex` l. 100: `it generalises Rima et al.'s bounded router-service tracing through a member-level call graph and injector bindings, which adds` -> `its service join, generalising Rima et al.'s bounded router-service tracing, adds`
4. `thesis.tex` l. 100: `an AI-built reference read from one application's source, which applies the analysis's own relations, is \GTAlfFullPrecision{} (\GTAlfClassPrecision{} for the class join).` -> `an AI-built reference that applies the analysis's own relations to one application's source is \GTAlfFullPrecision{} (per-class join: \GTAlfClassPrecision{}).`
5. `thesis.tex` l. 134: `demotion rules of Section~\ref{sec:res-round2}` -> `demotion rules of Table~\ref{tab:demotion}`
6. `ch5-results.tex` l. 41: caption -> `Why the may-only witness locations are may, by family of reason.` (short form; the longer form wraps and adds a page). l. 44: `\emph{Any} counts the constructs with` -> `\emph{Any} counts the witness locations with`
7. `ch5-results.tex` l. 635-636: `loses` / `the three airbus pairs from the sign-in screen` -> `loses` / `three non-reference airbus pairs from the sign-in screen`
8. "only this thesis adds": `ch3-analysis.tex` l. 444 -> `which this thesis adds.`; l. 469 -> `Orange: what this thesis adds;`; `ch5-results.tex` l. 375-376 -> `the step` / `this thesis adds:`
9. `ch2-background.tex` l. 403-405: `edges as constraints. Rima et al.'s implementation also traces router calls into services, to a bounded depth. What` -> `edges as constraints, and their implementation traces router calls into services to a bounded depth. What`; `under their provider bindings, which generalises that bounded tracing, a modality` -> `under their provider bindings (a generalisation of that bounded tracing), a modality`
10. `ch4-evaluation.tex` l. 45: `Licences are read from the local checkouts (confirm at the pinned commits);` -> `Licences are read from the local checkouts at the pinned commits;`

Applied to a scratch copy and built: 117 pp, 0 undefined refs, 0 overfull boxes, abstract 382 rendered words (HEAD 383) on 32 lines, every section starting on the same page as with the current diff.

## Left to the author or supervisor

- F-06: REV-10 table, model names, prose extent, third-party source.
- F-07: supervisor's confirmation of 89 pp, or a cut of about 9 pp.
- F-01: optional "on the corpus their tool places none from a service" needs the author's confirmation.
- F-06: "revised by me" is the author's own statement to confirm.

VERDICT: FAIL as it stands. With edits 1-10, F-01 to F-05 and the false-statement part of F-06 pass. The rest of F-06 and all of F-07 stay open until the author or supervisor provides the input above.
