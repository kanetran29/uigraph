1. [blocking] ch6-discussion.tex:22-26. The cut made a claim stronger and broke the logic. Line 22-23 now says the screens a site would connect "exist in the graph" with no exception, and the next sentence then talks about sites whose target screen has no node. Restore after line 24: "The exceptions are sites that the diagnosis labels as having a target screen with no node. The label also covers targets held in a field. Most of these sites are in ghostfolio (Table~\ref{tab:remaining})." This replaces the current "Most of the sites that the diagnosis labels … are in ghostfolio" sentence.

2. [blocking] ch6-discussion.tex:31. A caveat was deleted. The chapter's opening thread (line 6, "each level limits what the other can achieve") is now supported in one direction only. Restore after line 31: "A complete set of nodes yields few transitions while the sites outside the component a route renders stay unattributed."

3. [blocking] ch6-discussion.tex:405. A claim became stronger: "gives every navigation site an owning component" lost its exception. Restore after it: "Code that imports the router instance directly is the analogue of Angular's service case and can be resolved by ordinary import resolution."

4. [blocking] ch2-background.tex:354. Two citations are gone: `yang2008empirical` and `laigner2022cataloging` are now cited nowhere, so they drop out of the bibliography. The claim "Dependency injection configuration is readable statically" also lost its evidence. Restore before that sentence: "The pattern is widely used outside Angular: Yang, Tempero and Melton detected its use from source code in 34 open-source Java applications \cite{yang2008empirical}, and Laigner et al.\ catalogue 12 dependency injection anti-patterns and detect them with a static analyser \cite{laigner2022cataloging}." Then change the next sentence to "Dependency injection configuration is therefore readable statically; …".

5. [blocking] ch5-results.tex:631. A deviation disclosure was deleted, and the sentence is now a comma splice. Restore: "Each subject was taken at its last commit before the date of its ground truth, since their registry pins none; the independent route parser found …".

6. [blocking] ch2-background.tex:427. "Indicates rather than establishes the practice" now qualifies a finding that was cut. Restore after "observed 4 of them debugging RxJS code": "They found that the engineers rely on manually added trace logging rather than on specialised tools. The study is a workshop paper with a small sample, …".

7. [blocking] ch2-background.tex:452. The coupling-effect assumption behind RQ4 is now named but never stated, and nothing in ch3-ch7 states it. Restore after "\emph{coupling effect} stated by DeMillo et al.": ", namely that tests which uncover simple errors are often also effective at uncovering much more complex errors \cite{demillo1978hints}. Without that assumption a mutant would say nothing about the faults a developer actually writes."

8. [blocking] ch2-background.tex:227. The "therefore" does not follow: the paragraph before is about TSCheck errors, which do not imply that a declared type narrows anything. Restore: "What follows for an analysis of Angular code is a division of labour. A declared type narrows the set of candidate implementations of a call, which is useful and is what the …".

9. [blocking] ch2-background.tex:326. Resolvers are no longer defined, but later chapters rely on them (ch3:134-135 "a resolver, which demotes as an \texttt{await} does", ch3:164, ch4:274, ch5:38). Restore after "route rather than cancel the navigation.": "Routes may also have resolvers, which fetch data the router awaits before it activates the route."

10. [blocking] ch2-background.tex:340-341. `relativeTo` is no longer introduced, but ch5:531 and the appendix (171, 276-285) use it. Restore after "\texttt{Router.navigateByUrl}": "; the target may be given relative to the current route through the \texttt{relativeTo} option".

11. [blocking] ch3-analysis.tex:241. A caveat that limits how severe the baseline defect is was deleted. ch5:105 mentions an application with no edges on a development version, so readers can now over-read the defect. Restore after "…yield no edges.": "On it no application is without edges."

12. [minor] ch6-discussion.tex:13 and :18. "This weaker reading" now comes before the stronger one is introduced, and a caveat was dropped. Restore before line 12: "Node completeness has two readings." At line 18, restore: "…complete in this stronger sense of a node for every mounted address, which is what a user of the graph would want."

13. [minor] ch2-background.tex:455. A workshop-paper disclosure was deleted; the chapter flags workshop papers elsewhere. Restore: "Praphamontripong and Offutt define operators for faults in the way web components interact, in a workshop paper \cite{praphamontripong2010applying}." In the merged cite, keep only the two mirshokraie keys.

14. [minor] ch2-background.tex:327. A generalisation became stronger. Restore "Applications that keep their route table in one place often write" in place of "applications often write".

15. [minor] ch2-background.tex:243-249. The paragraph says Aurebesh "bears on this work" but the reason was cut. Restore after line 249: "What the two have in common is the problem of relating an identifier in a template to the code that defines it."

16. [minor] ch2-background.tex:247. The cut removed the only use of "MVC", so thesis.tex:183 now lists an unused abbreviation. Restore "of a model--view--controller (MVC) framework" wording, or delete the abbreviation-list entry.

17. [minor] ch3-analysis.tex:371. A modelling approximation now reads as fact. Restore "A dispatch is treated as a call-graph edge from every dispatcher to every handler".

18. [minor] ch5-results.tex:896-899. The technical meaning changed: the barrel sits between the lazy route and the module, and the failing reader is one that follows one hop, which is why the bound is three hops. Restore: "…that it imports, and a reader that stops at the module file finds nothing. A lazy route may also name a module through a barrel that re-exports a feature module. A reader that follows one hop finds no table and places the screens at the application root …".

19. [minor] ch5-results.tex:970-971. A scope qualifier was dropped. Restore "which is external evidence about these six applications that the two static readers could not produce".

20. [minor] ch6-discussion.tex:428. "These are expectations" has lost its antecedent. Restore before it: "The lattice, the fixpoint and the anchored representation transfer unchanged. Of the relations, outlets and guards transfer with small changes, the call graph becomes simpler, and component nesting becomes harder in React."

21. [minor] ch6-discussion.tex:414. The catch-all collision now reads as part of the redirect point. Restore before "A table that mixes": "The same porting exposed a second Vue-only hazard."

All `\label`s, tables, figures and number macros are intact. Every removed `\ref` target is still referenced elsewhere. The only citations lost are `yang2008empirical` and `laigner2022cataloging` (item 4).

Verdict: FAIL. Items 1-11 must be restored before the cut is accepted.