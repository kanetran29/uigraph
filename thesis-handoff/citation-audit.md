# Citation audit of the thesis (5 Nov 2026)

Scope: all 84 entries of `thesis/references.bib` and every `\cite` in `thesis.tex`, `ch1`–`ch7`,
`plan.tex` and the `generated-*.tex` files (140 citation sites; ch5 and ch7 cite nothing).
Read-only: no `.tex` or `.bib` file was changed. Text was fetched from Crossref, DataCite,
OpenAlex, Semantic Scholar, publisher pages, arXiv, author pages and npm, Google Patents
and Open Library. PDFs were converted to text in a scratch folder and deleted; nothing was kept.

Method, per entry: (1) list every citation site and the claim attached to it; (2) compare
authors, title, year, pages and volume with Crossref, or with DataCite, the patent office,
Open Library or the live page where there is no Crossref DOI; (3) fetch the strongest source
reachable (full text over abstract over metadata); (4) judge every claim. Each row quotes at
most one short phrase from its source. Usage stayed at 18 % of the weekly limit throughout,
so the whole bibliography was covered and nothing was cut for budget.

## Verdict counts (per entry, worst claim counts)

- FT (supported by full text): 24
- AB (supported by abstract/metadata only): 47
- OV (not supported or overstated (at least one claim)): 7
- CV (cannot verify from a primary source): 4
- UN (not cited): 2

Full text was read for every work the thesis compares itself with or whose mechanism it
describes (Oshima and Kishi, Yang et al. ×2, StoryDroid, GoalExplorer, ProMal, UI-CTX,
Crawljax, FRAGGEN, VeriFlow, Kurant, soundiness). The two exceptions are Rima et al.,
read in the authors' manuscript and specification (the Springer chapter page blocks automated
access), and Larsen and Thomsen (abstract plus secondary literature).

## Metadata

No entry has a wrong author, title, year or DOI. Every DOI resolves to the cited work.
The differences from Crossref are all on Crossref's side or cosmetic:
- surname particles (Milani Fard, Van Cutsem, De Meuter, Mota Filho): the bib form is the
  fuller, correct one;
- Crossref has no year for five old proceedings (Ricca and Tonella 2001, Larsen and Thomsen 1988,
  Dean et al. 1995, Baxter et al. 1998, Arnold and Bohner 1993); the bib years are correct;
- `richards2015concrete` is a DataCite DOI (LIPIcs), so Crossref returns 404 but the DOI resolves
  correctly;
- `rima2026e2e`: published online 2026, print volume 2027 (the bib note says so); pp. 334–351 matches;
- key `websurvey2025` holds a 2026 entry (cosmetic only, invisible in the PDF);
- `oshima2018model` has no pages field (optional).

Non-DOI entries: the Fujitsu patent (US 8,402,319 B2, Fujitsu Ltd, granted 19 March 2013),
Bohner and Arnold (ISBN 0-8186-7384-2, IEEE CS Press) and the Fowler, Angular, React Router 8.4.0,
Vue Router 5.3.1 and Stryker pages all check out. `johnson1988reusable` could not be checked online.

## Claims to fix: overstated, wrong or unverifiable

Ordered by importance. The locations are where the sentence starts.

1. **ch1-introduction.tex:45–46 (Oshima and Kishi).** "accepting only applications that declare no
   nested routes, no route parameters and no data-bound navigation". The paper lists its
   restrictions "such as" child attributes and route parameters. Data binding is not an input
   restriction: data-binding changes are simply not treated as page transitions.
   *Suggest:* "…in order to model-check it, under stated restrictions that include no child routes
   and no route parameters, and without treating data-binding changes as page transitions".
   (The ch2-background.tex:148–150 wording is already correct.)
2. **ch1-introduction.tex:32–34 and ch2-background.tex:107 (Ricca and Tonella; WebUml; SiteHopper).**
   "navigation models have been extracted statically from server-rendered frameworks" and
   "This work shows that navigation models, including guards, have been extracted statically".
   ReWeb (Ricca and Tonella) downloads the pages, so it works semi-automatically with a crawler, as
   tab:rw itself says. WebUml combines static analysis with "mutational techniques" run against the
   server, making it hybrid. SiteHopper is a crawler. Only the Fujitsu patent is fully static.
   *Suggest:* "extracted statically or semi-automatically", or tie the static claim to the patent
   and WebUml's static part.
3. **ch4-evaluation.tex:71–72 (`websurvey2025`).** "There is no standard benchmark corpus for
   single-page applications either \cite{websurvey2025}". The survey's full text (arXiv
   2503.05378) does not say this. Its only "benchmark" statements are about comparison tools:
   Crawljax is the most-used baseline, and seven studies use manual testing as a benchmark.
   *Suggest:* state it as the thesis's own finding from the literature search and drop the citation,
   or cite a source that says it.
4. **ch6-discussion.tex:641 (`feldthaus2013jscg`).** "can be resolved by ordinary import resolution,
   as in the JavaScript call graphs of Feldthaus et al." Their analysis is field-based and runs over
   browser scripts. "import", "module" and "require(" never occur in the paper.
   *Suggest:* drop "as in … Feldthaus et al." and say import resolution suffices, or cite a
   module-aware call-graph work after checking it.
5. **ch3-analysis.tex:380–381 and ch6-discussion.tex:697–698 (`antoniadis2020enterprise`,
   `sridharan2011f4f`).** These sentences say class hierarchy analysis is "recommended for
   framework-heavy code" and is "in the style the framework-modelling literature recommends".
   Neither paper recommends CHA. Both argue for modelling framework concepts explicitly:
   declarative components and entry points (JackEE), or generated specifications (F4F).
   *Suggest:* "Resolution follows class hierarchy analysis \cite{dean1995cha}, with Angular's provider
   declarations modelled explicitly as the source of bindings, as the framework-modelling literature
   recommends \cite{sridharan2011f4f,antoniadis2020enterprise}."
6. **ch2-background.tex:57 (tab:rw) and ch2:186–189 (VeriFlow).** VeriFlow evaluates 4 apps, but
   2 of them (OpenRMF, DVWA) are multi-page applications that it handles by dynamic crawling, not
   bundle parsing. The paper also never says how an edge's source vertex is chosen: it says only
   "source-destination relationships". So "no navigation site is attributed to the screens it can
   fire from" is inferred from silence.
   *Suggest:* tab:rw "4 apps (2 SPA), vs. ZAP", and "the paper does not describe how the source
   screen of a navigation call is determined".
7. **ch6-discussion.tex:176–177 (`papadakis2019mutation`).** "so the pattern of which operators are
   detected is more trustworthy than the rates \cite{papadakis2019mutation}". The chapter says operator
   choice significantly affects results and asks authors to explain mutant selection. The
   pattern-over-rates conclusion is the thesis's own.
   *Suggest:* cite Papadakis for the caution only, and state the conclusion as the thesis's.
8. **thesis.tex:152–156 (AI-use statement).** It says that "sources that could not be checked in this
   way are kept in a separate block in the bibliography file and are not cited anywhere". No such
   block exists. The two uncited entries (`haydar2004`, `zhang2023repocoder`) sit in the main list,
   and both have correct Crossref metadata. *Suggest:* drop the sentence or the two entries.
   The same paragraph says "No source is cited on the strength of such a summary". That holds,
   but items 9–10 below rest on abstracts or secondary descriptions, not on the paper itself.
9. **Unverifiable details (primary full text not reached; not shown wrong):**
   - ch2-background.tex:102–103 and tab:rw Guards = yes (`webuml2004`): "deriving guards by
     control-flow analysis of the server code" is not in the abstract, and the full text is
     access-restricted. Needs the ACM PDF (Aalto library).
   - ch2-background.tex:99–101 (`riccatonella2001`): conditional edges on input values and analyst
     annotations appear only in secondary material (the TACAS 2001 companion paper's figure, slides).
     Needs the ICSE 2001 PDF (IEEE Xplore).
   - ch2-background.tex:281–283 and ch3-analysis.tex:204 (`larsen1988modal`): the abstract does not
     mention must/may. Secondary literature attributes modal transition systems to this paper.
     Low risk.
   - ch2-background.tex:408 (`bacon1996rta`): the abstract does not state RTA's instantiation rule,
     and the author copy's text is font-garbled. A standard fact, low risk.
   - ch2-background.tex:389 (`johnson1988reusable`): full text not reached. It is fine as the
     inversion-of-control source next to Fowler, who covers the dependency-injection part.
10. **Minor wording.** ch3-analysis.tex:353 says "monotone dataflow problem in the sense of
    Kildall". Kildall's 1973 framework is distributive; monotone frameworks are the later
    generalisation, covered by the co-cited Nielson et al. *Suggest:* "in the sense of Kildall,
    generalised to monotone frameworks \cite{nielson1999principles}". ch6-discussion.tex:427–429 cites `angulardocs`
    (the routing guide) for the `(name:path)` encoding, but the example `/inbox/33(popup:compose)`
    is on the `DefaultUrlSerializer` API page.

Not checked: whether `kalliamvakou2016indepth`'s recommendations include "filter by explicit
criteria and report them" (ch4:60). The abstract supports "a set of recommendations" in general.
No red-team panel was run on this audit: the brief capped helper agents for budget. Items 1–7
were each checked against the source text quoted in the table.

## Per-entry table

Verdict codes: FT = supported by full text; AB = supported by abstract or metadata only; OV = at least one claim not supported or overstated; CV = cannot verify from a primary source; UN = not cited. Locations are `file:line` at the time of the audit (another session is editing the .tex files, so lines may shift by a few).

| Key | Metadata | Source level reached | Cited at | Verdict | Evidence / notes |
|---|---|---|---|---|---|
| `oshima2018model` | ok (Crossref; bib has no pages) | full text (KSI PDF) | ch1:46; ch2:55,138-160,631 | OV | Restrictions are listed "such as" child attributes and route parameters; data binding is only out of scope (not treated as page transitions), not an input restriction, so ch1:46 "accepting only applications that declare ... no data-bound navigation" overstates. Confirmed: 4 sample + 2 real apps (1824/6893 LOC, 6/23 pages), faults injected into variants of sample app 1, page named by the routed parent component. The ch2 wording is accurate. |
| `rima2026e2e` | ok (Crossref: online 2026, print 2027, pp. 334-351) | author manuscript + spec (replication repo main.pdf, approach.md); Springer abstract behind bot wall | ch1:48; ch2:56,160-176,601 | FT | Manuscript: seven Angular apps, 303 workflows, Selenium tests, a ground truth built by one auditor. Spec: active components = route + ancestors + bootstrap components, closed under composition; same-class depth 1; first subscribe callback; "Do not model router outlets"; no provider-resolution graph. Every thesis statement matches. The published chapter was not read (the thesis already says so). |
| `zhang2025veriflow` | ok | full text (mdpi-res PDF) | ch1:50; ch2:57,186-189,602 | OV (minor) | Confirmed: bundle AST, routes as vertices, navigate calls as edges, a graph that "over-approximates all feasible navigation paths", guards only as unmodelled runtime conditions. But 2 of the 4 apps (OpenRMF, DVWA) are MPAs, handled by dynamic crawling, so tab:rw "SPA routes, from bundles ... 4 apps" is imprecise. "No navigation site is attributed" is inferred from silence: the paper does not say how an edge source is chosen. |
| `yang2015wtg` | ok | full text (haowei-wu.github.io/ase15.pdf) | ch1:9,31; ch2:25,43,70 | FT | Windows = activities, menus, dialogs; callbacks "executed in the UI thread"; window-stack modelling; 20 apps; manual examination of six apps. All confirmed. |
| `yang2018wtg` | ok | metadata | ch1:31; ch2:43,70 | AB | Claim is bibliographic ("journal version"): same title, ASE journal 25:833-873, superset of authors. Content not read. |
| `yang2015callbacks` | ok | full text (haowei-wu.github.io/icse15.pdf) | ch1:31; ch2:44,72,83 | FT | CCFG node "(h, v) in H x V"; getId resolved by interprocedural constant propagation; compared with a manual solution and with dynamic tool Ripper. Confirmed. |
| `storydroid2019` | ok | full text (arXiv 1902.00476) | ch1:9; ch2:25,45,73 | FT | ATG built from startActivity; "self-developed 10 apps as our ground truth". Confirmed. |
| `goalexplorer2019` | ok | full text (Rubin's UBC page) | ch1:9; ch2:26,46,74; ch6:716 | FT | Static STG guides dynamic exploration; STG accuracy (RQ3) vs. manual ground truth "for 36 open-source F-Droid apps". Confirmed. |
| `promal2022` | ok | full text (par.nsf.gov) | ch2:47,89; ch6:716 | FT | imprecision of the reference analysis causes several buttons to be aliases; static + dynamic + ML; 40 apps; precision/recall/F1. Confirmed ("wrong window" is a fair paraphrase). |
| `uictx2025` | ok | full text (NDSS PDF) | ch2:48,76 | FT | Backward data-flow from handler to findViewById; branch-level code context; "collect and label 2,000 UI" widgets. Confirmed. |
| `crawljax2012` | ok | full text (Mesbah's author copy) | ch1:10,37; ch2:27,52,116; ch6:111,712 | FT | Fires events, compares DOM after each event, state equivalence via comparators; evaluation against a manually created reference model. Confirmed. |
| `feedex2013` | ok (Crossref family name "Fard"; bib "Milani Fard" is correct) | abstract | ch1:10,38; ch2:53,118; ch6:111,712 | AB | Exploration strategy (coverage impact, navigational/structural diversity), 6 apps, coverage. Confirmed. |
| `fraggen2022` | ok (year 2023 matches print) | full text (arXiv 2110.14043) | ch1:38; ch2:53,118; ch6:712 | FT | Dynamic, coverage-evaluated; changes exploration, not model source. Confirmed. |
| `kurant2025` | ok | full text (annals-csis.org) | ch1:43; ch2:54,135 | FT | Component dependency graph for React, F1 0.95 vs. manual graph; the word "rout..." never occurs in the paper, so "does not address routing" holds. |
| `websurvey2025` | ok (key says 2025, entry 2026: cosmetic) | full text (arXiv 2503.05378) | ch1:40; ch2:119; ch4:72; ch6:111 | OV | Scope 2014-2025, 258 papers: confirmed. ch4:72 "There is no standard benchmark corpus for single-page applications either" is not stated in the survey; "benchmark" occurs only for comparison tools (Crawljax most used). |
| `riccatonella2001` | ok (Crossref has no year; 2001 correct) | abstract + secondary (TACAS 2001 companion figure, slides) | ch1:34; ch2:29,49,99-101 | OV | Abstract: UML model, semi-automatic test generation. Conditional edges on input values and analyst annotations appear only in secondary material ("Cond. edges" in the companion paper's figure). ReWeb downloads pages (a crawler), so ch1:34 "extracted statically" overstates. ICSE full text not reached. |
| `webuml2004` | ok | abstract | ch1:34; ch2:50,103 | CV | Abstract: class and state diagrams from source code plus server interaction with "mutational techniques" (hybrid: matches tab:rw). "Deriving guards by control-flow analysis of the server code" and tab:rw Guards = yes are not in the abstract; full text restricted (ACM, UniMi record). |
| `sitehopper2013` | ok | abstract excerpt (via search; no Crossref/S2 abstract) | ch2:29,105 | AB | a crawler that computes on-the-fly an abstraction of the NSM. The sentence is right, but SiteHopper is dynamic, which weakens ch2:107 "navigation models ... have been extracted statically". |
| `tkachuk2013patent` | ok (Google Patents: US8402319B2, Fujitsu Ltd, granted 2013-03-19) | patent abstract (primary) | ch1:34; ch2:51,104 | AB | Static extraction of a page transition graph from JSP, XML configuration and class files. "Struts" is not in the abstract (the claims were not read) but the inputs are Struts-style. |
| `haydar2004` | ok | - | not cited | UN | Uncited; not printed by BibTeX. |
| `livshits2015soundiness` | ok | full text (yanniss.github.io author copy) | ch2:302 | FT | Soundy means "mostly sound, with specific, well-identified unsound choices"; the authors call for the extent of unsoundness to be stated. Confirmed. |
| `larsen1988modal` | ok (Crossref has no year; 1988 correct) | abstract + secondary | ch2:283; ch3:204 | CV | Abstract describes a modal process logic and refinement; it does not mention must/may. Secondary literature (e.g. arXiv 1306.3050) credits modal transition systems to [LT88]. Low risk; primary full text (IEEE) not reached. |
| `kalliamvakou2014promises` | ok | abstract | ch4:60; ch6:260,726 | AB | majority of the projects are personal and inactive; GitHub used for storage and web hosting. Confirmed. |
| `kalliamvakou2016indepth` | ok (online 2015, print 2016) | abstract | ch4:60; ch6:260,726 | AB | Same perils plus "a set of recommendations for software engineering researchers". The specific recommendation "filter by explicit criteria and report them" was not checked in the full text. |
| `angulardocs` | ok (live page) | documentation | ch1:58; ch2:332; ch6:429 | FT | Guards as functions (CanActivateFn, route-guards page); auxiliary URL "/inbox/33(popup:compose)" is on the DefaultUrlSerializer API page, not the routing guide the URL points to. |
| `angulareffects` | ok | documentation | ch2:449 | FT | Whenever any of these signal values change, the effect runs again. Confirmed. |
| `nielson1999principles` | ok | metadata | ch2:318; ch3:354 | AB | Textbook account; content not re-read. |
| `kildall1973unified` | ok | abstract | ch2:314; ch3:354 | AB | General flow-analysis algorithm on a directed graph. Minor: ch3:354 "monotone dataflow problem in the sense of Kildall": Kildall's framework is distributive; monotone frameworks are Kam and Ullman's generalisation (the Nielson co-citation covers it). |
| `cousot1977abstract` | ok | abstract | ch2:317 | AB | Confirmed. |
| `johnson1988reusable` | not machine-checkable (no DOI); bib comment cites Foote's page | not reached (laputan.org returned no content) | ch2:389 | CV | Cited for inversion of control alongside Fowler; Johnson and Foote discuss frameworks inverting control, not DI containers. The co-citation with Fowler carries the DI part. |
| `fowler2004injection` | ok (title; 23 January 2004 on page) | full text (web page) | ch2:389 | FT | DI as a "more specific name" for this kind of inversion of control. Confirmed. |
| `dean1995cha` | ok (Crossref has no year) | abstract (Cecil project page) | ch2:407; ch3:380,535; ch6:698 | AB | CHA = "examining the complete inheritance graph of a program". Confirmed. |
| `bacon1996rta` | ok | abstract; author PDF text unreadable (font encoding) | ch2:408 | CV | Abstract compares three algorithms without naming RTA's instantiation rule. Standard fact; low risk. |
| `grove2001callgraph` | ok | abstract | ch2:410 | AB | a unifying framework for understanding call graph construction algorithms. Confirmed. |
| `andersen1994pointsto` | ok (title page: DIKU, May 1994; report no. not seen) | full text (thesis ch. 4, Cornell course copy) | ch2:409 | FT | Inclusion-based points-to analysis. Confirmed. |
| `feldthaus2013jscg` | ok | full text (franktip.org) | ch2:411; ch6:641 | OV | ch2:411 confirmed ("in principle unsound, produces highly accurate call graphs"). ch6:641 "resolved by ordinary import resolution, as in the JavaScript call graphs of Feldthaus et al." is not supported: the analysis is field-based over browser scripts, and "import", "module" and "require(" never occur in the paper. |
| `antoniadis2020enterprise` | ok | abstract | ch2:422,621; ch3:381; ch6:698 | OV (minor) | 4x higher completeness, components and entry points: confirmed. ch3:381 "as recommended for framework-heavy code" and ch6:698 "class hierarchy analysis in the style the framework-modelling literature recommends": the paper recommends explicit declarative framework modelling, not CHA. |
| `elliott1997frp` | ok | abstract | ch2:450 | AB | Fran, behaviours and events. Confirmed. |
| `bainomugisha2013survey` | ok (pages are article number 52) | abstract | ch2:451 | AB | Survey and taxonomy of reactive programming. Confirmed. |
| `reactrouterdocs` | ok (npm: react-router 8.4.0 exists) | registry metadata | ch6:626 | AB | Reference only. |
| `vuerouterdocs` | ok (npm: vue-router 5.3.1, published 2026-09-02; latest is now 5.4.0) | registry metadata | ch6:626 | AB | Reference only. |
| `baxter1998clone` | ok | abstract | ch2:210,618 | AB | AST clone detection; "C production software system of some 400 K source lines". Confirmed. |
| `pawlak2016spoon` | ok (online 2015, print 2016) | abstract | ch2:212,618 | AB | Confirmed. |
| `jensen2009type` | ok | full text (cs.au.dk) | ch2:125,223,617 | FT | sound type information ... using abstract interpretation ... the full language as defined in the ECMAScript standard. Confirmed. |
| `bierman2014understanding` | ok | full text (gavinbierman.github.io) | ch2:232,625 | FT | "not statically type sound, by design"; a precise core-calculus definition. Confirmed. |
| `richards2015concrete` | ok (DataCite DOI; Crossref 404 is expected) | abstract | ch2:233,625 | AB | optional type annotations that are, by design, unsound. Confirmed. |
| `gao2017type` | ok | full text (UCL) | ch2:238 | FT | both Flow 0.30 and TypeScript 2.0 successfully detect 15%. Confirmed. |
| `bogner2022type` | ok | abstract | ch2:240 | AB | 604 projects; better code quality and understandability; bug proneness not lower. Confirmed. |
| `feldthaus2014checking` | ok | full text (cs.au.dk) | ch2:242 | FT | found 142 errors in the declaration files of 10 libraries. Confirmed. |
| `madsen2013practical` | ok | abstract (OpenAlex truncated; rest from search excerpt and TLDR) | ch2:257 | AB | Stubs "tedious to write, incomplete, and occasionally incorrect"; use analysis infers library behaviour from how the application uses it. Confirmed. |
| `madsen2015static` | ok | abstract | ch2:259 | AB | Event-based call graph, listeners triggered by events. Confirmed. |
| `ocariza2015detecting` | ok | abstract | ch2:266,623 | AB | MVC identifier/type consistency, AngularJS, 15 bugs. Confirmed. |
| `demillo1978hints` | ok | abstract | ch2:537 | AB | Coupling effect wording matches the abstract. Confirmed. |
| `jia2011mutation` | ok | abstract | ch2:541; ch2:630 | AB | Confirmed. |
| `papadakis2019mutation` | ok (Crossref lists no authors; bib list matches the chapter) | full text (orbilu preprint) | ch2:543,568,630; ch6:177 | OV (minor) | Confirmed: survey plus best-practice checklist (a "mini-handbook"). ch6:177 attributes "the pattern of which operators are detected is more trustworthy than the rates" to the chapter. It says operator choice significantly affects results and asks authors to explain mutant selection, but does not draw that conclusion. |
| `just2014mutants` | ok | abstract | ch2:546 | AB | 357 real faults; correlation independent of coverage. Confirmed. |
| `mirshokraie2013efficient` | ok | abstract | ch2:554 | AB | Confirmed. |
| `mirshokraie2015guided` | ok | abstract | ch2:554 | AB | Confirmed. |
| `praphamontripong2010applying` | ok (ICST Workshops) | abstract | ch2:556 | AB | Interaction faults, new operators; venue is a workshop. Confirmed. |
| `stryker` | ok (live site) | web page | ch2:561 | FT | "more than 30 supported mutations"; the site also says it is test-runner agnostic. Confirmed. |
| `yang2008empirical` | ok | abstract | ch2:396 | AB | 34 open-source Java applications. Confirmed. |
| `laigner2022cataloging` | ok | full text (arXiv 2109.04256) | ch2:397 | FT | 12 anti-patterns; static analyser. Confirmed. |
| `sridharan2011f4f` | ok | abstract (OpenAlex truncated; rest from SPLASH abstract via search) | ch2:420,621; ch6:698 | AB | Specification generated from "application code and configuration files", consumed by a taint engine. Confirmed. See antoniadis2020enterprise for ch6:698. |
| `landman2017challenges` | ok | full text (CWI) | ch2:424 | FT | reflection can not be ignored for 78% of the projects; unsound assumptions. Confirmed. |
| `chen2022jasmine` | ok | abstract | ch2:427,621 | AB | Spring DI/AOP, Soot call graphs. "Closest analogue" is the thesis's own judgement. |
| `cooper2006embedding` | ok | full text (Brown author copy) | ch2:468,628 | FT | Glitch definition; signal heights, recomputation "in order of increasing height"; graph must be acyclic. Confirmed. |
| `drechsler2014distributed` | ok | abstract (via SPLASH page excerpt) | ch2:473 | AB | Distributed change propagation that keeps glitch freedom. Confirmed. |
| `salvaneschi2017positive` | ok | abstract | ch2:491 | AB | 127 subjects vs. Observer; better comprehension. Confirmed. |
| `salvaneschi2016debugging` | ok | abstract (via search excerpt) | ch2:495 | AB | Reactive Inspector; controlled experiment "shows that RP Debugging outperforms traditional debugging". Confirmed. |
| `banken2018debugging` | ok | abstract | ch2:502,628 | AB | Console logging; experiment with 111 developers. Confirmed. |
| `zimmerle2022mining` | ok (Crossref family "Filho"; bib "Mota Filho" is fuller) | abstract | ch2:510 | AB | 95.2% of operators used; Stream Abstraction 36.4% of 23 topics. Confirmed. |
| `alabor2020debugging` | ok | abstract | ch2:506 | AB | Ten professionals interviewed, four observed, manual trace logs. Confirmed. |
| `liu2024make` | ok | abstract | ch1:65 | AB | 93 apps; more activity coverage and bugs than the best baseline. Confirmed. |
| `wen2024autodroid` | ok | full text (arXiv 2308.15272) | ch1:68 | FT | Offline stage builds a "UI Transition Graph (UTG) memory" by exploration. Confirmed. |
| `llmdroid2025` | ok | abstract | ch1:70 | AB | LLM guidance when coverage growth slows. Confirmed. |
| `wang2024leveraging` | ok | abstract | ch1:72 | AB | LVLM plus curiosity-oriented exploration, web GUIs. Confirmed. |
| `wang2024software` | ok | abstract | ch1:73 | AB | Survey of 102 studies. Confirmed. |
| `jimenez2024swebench` | ok (no DOI; arXiv 2310.06770, ICLR 2024) | abstract | ch1:75 | AB | coordinating changes across multiple functions, classes, and even files. Confirmed. |
| `yang2024sweagent` | ok | abstract | ch1:77 | AB | ACI for navigating repositories. Confirmed. |
| `zhang2023repocoder` | ok | - | not cited | UN | Uncited; not printed by BibTeX. |
| `arnold1993impact` | ok (Crossref has no year) | abstract | ch1:11; ch2:575; ch6:101 | AB | A three-part framework for characterizing and comparing diverse impact analysis approaches. Confirmed. |
| `bohner1996software` | ok (Open Library: ISBN 0818673842, IEEE CS Press) | metadata | ch1:11; ch2:576; ch6:101 | AB | Edited collection exists as cited; "standard reference" is the thesis's judgement. |
| `ren2004chianti` | ok | abstract | ch2:579; ch6:100 | AB | Atomic changes; affected tests. Confirmed. |
| `lehnert2011taxonomy` | ok (IWPSE-EVOL workshop) | abstract | ch2:580; ch6:101 | AB | Taxonomy for impact analysis. Confirmed. |
