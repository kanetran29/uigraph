1. **ch6-discussion.tex:373.** The new opening says "nothing was built or measured for React … or Vue". Lines 379–380 still talk about "the Vue extractor" and "the extractor keeps the record declared first", and the repo has React and Vue adapters (docs/features/adapters/{react,vue}). The cut also removed the porting-defect disclosure.
   - Fix: change "nothing was built or measured for" to "nothing was measured for".
   - Restore before "the Vue extractor keeps that component": "Carrying the Angular reading into the Vue extractor dropped those components;"

2. **ch5-results.tex:431–432 (alfresco config-driven site).** Two caveats are now stated nowhere. Without them the A1 ✓ and \GTAlfFullExcess{} (also used in Ch7) read cleaner than they are.
   - After "at the may tier." restore: "Most of the pairs the full analysis adds over \emph{outlet} come from this placement."
   - Change "; it is not scored." to "It is not scored; scored as firing from nowhere, it would add to the excess of both."
   - At line 556, after "\GTAlfFullExcess{} at one site on alfresco", restore ", where it also places an undetermined site on every screen".

3. **ch5-results.tex:486 and 493 (mifos, preregistration).** Disclosures of preregistered predictions that are not reported have been removed.
   - After "so a hit discriminates less than it did." restore: "No other preregistered prediction is reported here."
   - Change "The preregistered five-class scheme is not scored." back to "The preregistered five-class scheme and its prediction that misses would be mostly a scope too narrow or a site not read are not scored."

4. **ch5-results.tex:426 (four excluded lines).** Restore the original wording: "The scorer reported them as placed by the graph and absent from the reference; they were read afterwards under the same rules, given only the line numbers and not the graph's placements. None is a navigation site, and they were added as excluded, where the protocol provided only for adding a missed site. No figure depends on it, since unlisted lines are not scored."

5. **ch5-results.tex:29.** Restore: "Edge counts must be read per tier and not summed as distinct constructs, because one unresolved site can produce many over-approximated may edges."

6. **ch5-results.tex:763.** Restore: "Without attribution no edge enters \path{/editor}, but one enters \path{/editor/:slug}, so the guard on the empty-path child is scored and missed rather than excluded."

7. **ch5-results.tex:856.** After "reported separately:" restore: "a low recovered fraction can coexist with many sites whose destination depends on runtime data. Its dynamic sites are spread over …"

8. **ch5-results.tex:820.** Restore: "so their agreement could not expose it and the runtime route oracle did".

9. **ch5-results.tex:660.** Before "This choice was made after their output was read." restore: ", and a move between two routes mounted in several places stays within one mount".

10. **ch5-results.tex:863.** Restore: "were minted at the primary address, which Angular reaches only as \texttt{(viewer:\ldots)}. Both tools read the subtree the same way, so only the runtime route oracle of Section~\ref{sec:res-probe} exposed it."

11. **ch5-results.tex:58.** Before "Two qualifications apply." restore: "The two readers still disagree about a handful of addresses."

12. **ch5-results.tex:922–924.** Restore at the end of the sentence: "; the difference is one relative link in a shared template that resolves against three owning screens".

13. **appendix.tex:416.** Change to "puts the comparison of Section~\ref{sec:res-earlier} in terms of …".

14. **ch2-background.tex:259.** Restore: "…particular Angular mechanisms. The Angular documentation is the reference for the framework details \cite{angulardocs}."

15. **ch2-background.tex:185.** Restore: "was associated with better code quality and understandability but no lower bug proneness across 604 GitHub projects".

16. **ch2-background.tex:199.** Change "that we found" to "that this review found".
