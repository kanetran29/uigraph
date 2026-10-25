# lit2 notes: what each source says (checked claims only)

Claims below come from the abstract (Crossref, OpenAlex, Semantic Scholar, or the publisher, author or conference page) unless marked otherwise. "Use for" lines are suggestions, not claims made by the paper.

## A. AST-based static analysis and typed JavaScript/TypeScript

**bierman2014understanding** (ECOOP 2014). I could not get the abstract (the Springer and author-preprint pages were blocked). The Semantic Scholar TLDR says the paper gives a precise definition of TypeScript's type system on a core set of constructs, then splits it into a safe inner fragment plus a layer of unsafe rules. Richards et al. (ECOOP 2015, which cites it) also describe TypeScript's types as "by design, unsound". *Check the paper's abstract yourself before you quote anything specific.* Use for: TypeScript types are a deliberately unsound aid, so an analysis that uses them cannot treat them as guarantees.

**jensen2009type** (SAS 2009, TAJS). A static analysis based on abstract interpretation that infers detailed, sound type information for JavaScript. It covers the full ECMAScript language, including its object model and built-ins, and the authors propose it as a foundation for developer tools. Use for: lattice-based abstract interpretation over JS, a precedent for your screen-set lattice.

**gao2017type** (ICSE 2017). The authors took fixed bugs from JavaScript project histories, added type annotations to the buggy code, and checked whether Flow 0.30 or TypeScript 2.0 would have flagged them. Both type systems detect about 15% of these public bugs. Use for: why typed code (TypeScript in Angular) gives static analysis useful extra information.

**bogner2022type** (MSR 2022). A mining study of 604 GitHub projects (299 JS, 305 TS, over 16M LoC). TS apps had significantly better code quality and understandability. Bug proneness and bug resolution time were not lower for TS, and more use of `any` correlated (weakly) with worse metrics. Use for: a nuanced view of what TypeScript does and does not buy you.

**feldthaus2014checking** (OOPSLA 2014, TSCheck). Checks TypeScript declaration files against the JavaScript libraries they describe. It captures the runtime object state after library initialisation and adds a lightweight static analysis of function code. It found 142 errors in the declaration files of 10 libraries, and the work exposed practical limits of the TypeScript type system. Use for: TypeScript type information can itself be wrong.

**madsen2013practical** (ESEC/FSE 2013). JavaScript apps depend on large frameworks and libraries, and hand-written stubs for them are tedious, incomplete and sometimes wrong. The paper combines pointer analysis with *use analysis*, which infers library behaviour from how the application uses it. Evaluated on 25 Windows 8 JS apps. Use for: frameworks as the main obstacle to static analysis of JS apps, and the case for modelling framework semantics.

**madsen2015static** (OOPSLA 2015). Introduces the *event-based call graph* for Node.js programs, where listeners run when events fire. It presents three analyses that build it and uses them to find event-handling bugs, such as unhandled events and listeners registered too late, with a manageable false-positive rate. Use for: static analysis of framework-driven, implicit control flow (compare Angular router and template events).

**ocariza2015detecting** (ICSE 2015, Aurebesh). A formal consistency model for MVC-framework web apps, plus a tool that finds identifier and type inconsistencies between models, views and controllers (recall 96.1%, precision 100%). It found 15 real bugs in AngularJS applications. Note: AngularJS 1.x, not modern Angular. Use for: the closest peer-reviewed static analysis of an Angular-family framework, linking templates to code.

**baxter1998clone** (ICSM 1998). Detects exact and near-miss code clones by comparing abstract syntax trees, using a variant of compiler common-subexpression detection. Applied to a C system of about 400K lines. Use for: a classic, highly cited example of AST-based analysis tooling.

**pawlak2016spoon** (SPE 2016). SPOON is a library for writing analyses and transformations of Java source code in plain Java, without hacking a compiler or learning a new formalism. Use for: the "analyses over a source-level AST metamodel" design, analogous to building on the TypeScript compiler API.

## B. Mutation testing

**demillo1978hints** (Computer 1978). The abstract states the *coupling effect*: tests that uncover simple errors are often also effective at uncovering much more complex errors. This is the foundational argument for mutation testing. Use for: why small syntactic mutants are meaningful.

**jia2011mutation** (TSE 2011). A comprehensive analysis and survey of mutation testing approaches, tools and empirical results. Its trend analyses suggest the techniques and tools are reaching maturity and applicability. Use for: the standard general reference.

**papadakis2019mutation** (Advances in Computers 112, 2019). Surveys a decade of advances on the fundamental problems of mutation testing and lists open problems. It also gives best-practice advice on using mutation in empirical studies of testing, as a "mini-handbook". Use for: methodology guidance on how you report your mutation experiment.

**just2014mutants** (FSE 2014) *(added)*. Uses 357 real faults in 5 open-source applications (321K LoC). Mutant detection correlates significantly with real-fault detection, independently of code coverage. The paper also discusses limitations of mutation analysis. Use for: justifying mutation score as a proxy for fault-detection ability.

**mirshokraie2013efficient** (ICST 2013, MUTANDIS). Uses static and dynamic analysis to guide mutant generation towards error-prone code, or code likely to affect output, to reduce cost and equivalent mutants. Proposes JavaScript and web-specific mutation operators. Use for: mutation testing applied to JavaScript web apps.

**mirshokraie2015guided** (TSE 2015). Journal extension of the above that adds FunctionRank. More than 93% of generated mutants are non-equivalent, and more than 75% of surviving non-equivalent mutants are in the top 30% of ranked functions.

**praphamontripong2010applying** (ICST Workshops 2010). Defines new mutation operators for faults in how web components interact (client-server and server-server), implemented in webMuJava. A small case study suggests mutation helps produce tests that find web app faults. Note: workshop venue.

**stryker** (@misc). I found no peer-reviewed Stryker paper, and the website cites none. The site describes StrykerJS (JavaScript/TypeScript), Stryker.NET (C#) and Stryker4s (Scala), with 30+ supported mutations, Apache-2.0 licence, and a runner-agnostic design.

## C. Dependency injection / IoC

**yang2008empirical** (ASWEC 2008). Develops operational definitions of dependency injection and techniques to detect its use, then applies them to 34 open-source Java applications. Motivation: DI is claimed to improve extensibility, modifiability, testability and reusability. Use for: empirical DI usage. Note: ASWEC is a mid-tier venue.

**razina2007effects** (IASTED SEA 2007). Compared 20 pairs of similar SourceForge projects, with and without DI, using a "Number of DIs" metric plus coupling and cohesion metrics. Overall there was no correlation with coupling or cohesion, but projects with 10% or more DI showed a trend toward lower coupling. Note: no DOI, low-tier venue. Use with care.

**laigner2022cataloging** (JSS 2022). Proposes a catalog of 12 DI anti-patterns with refactorings, and a static analyzer that detects them (92.19% relative recall). At least 9 anti-patterns appear frequently in open-source and industry projects, and practitioners rated the catalog relevant. Use for: DI misuse is detectable statically.

**antoniadis2020static** (PLDI 2020). Major Java analysis frameworks offer almost no support for enterprise apps. JackEE captures concepts common to enterprise frameworks (components, entry points) in a declarative, mostly framework-independent form. It reports about 4x higher completeness and about 6x speedup over the most precise conventional analysis. (You already cite this.)

**chen2022jasmine** (ASE 2022). Spring's core technologies (DI and AOP) rely on dynamic features that make static analysis hard. Jasmine extends Soot to make call graphs more complete for Spring, and was evaluated on micro-benchmarks and 18 real Spring programs. It improves Soot and Doop based tools, and with FlowDroid it found 12 sensitive-data leak paths. Use for: DI frameworks hide call edges, and modelling DI semantics recovers them. This is the closest analogue to resolving Angular's DI.

**sridharan2011f4f** (OOPSLA 2011). Frameworks' heavy use of reflection makes static taint analysis ineffective, and ad hoc per-framework support does not scale. F4F generates a specification of framework behaviour from application code and config files, which a taint engine then consumes. It found 525 new issues across nine benchmarks. Use for: framework modelling through generated specifications.

**landman2017challenges** (ICSE 2017). A literature review plus corpus study of Java reflection. Reflection cannot be ignored in 78% of projects, and resolving it needs unsound assumptions. They used AST-based counting of hard idioms such as dynamic proxies. Use for: why soundness is out of reach when frameworks use reflection or DI. Supports a "soundy" design stance.

## D. Reactive programming and glitches

**salvaneschi2016debugging** (ICSE 2016). Reactive programming lacks tool support. The paper argues that reactive programs need different debugging concepts and proposes "RP Debugging", implemented in Reactive Inspector, a debugger integrated with the Eclipse Scala IDE. A controlled experiment found it outperforms traditional debugging. Use for: reactive dataflow is hard to reason about with conventional tools.

**salvaneschi2017positive** (TSE 2017). An experiment with 127 subjects comparing reactive programming against OO with the Observer pattern. Comprehension was significantly better with reactive programming. Use for: a balanced view, since reactive code is easier to read but harder to debug and analyse.

**banken2018debugging** (ICSE 2018, RxFiddle). Traditional debuggers lack Rx support, so developers fall back to console logging. RxFiddle visualises Rx data-flow structure and values, and in an experiment with 111 developers it helped them finish debugging tasks faster. Use for: Rx (RxJS) data flows are opaque, which is directly relevant to Angular.

**drechsler2014distributed** (OOPSLA 2014). A change-propagation algorithm for distributed reactive programming that works without central knowledge of the dependency topology, avoids unnecessary propagation, and keeps glitch freedom. Use for: a peer-reviewed definition and treatment of glitch freedom.

**cooper2006embedding** (ESOP 2006, FrTime). Embeds dynamic dataflow in a call-by-value language: expressions evaluate to nodes in a dataflow graph. *Checked in the paper body*: a glitch is a signal recomputed before all its dependencies are up to date. FrTime prevents glitches by giving each signal a height and updating in order of increasing height (topological order), which requires an acyclic graph. Use for: the classic glitch definition and the topological-order solution, which Angular signals also rely on.

**zimmerle2022mining** (MSR 2022). Studies RxJava, RxJS and RxSwift usage on GitHub and Stack Overflow. 95.2% of Rx operators are used, and of 23 Stack Overflow topics the Stream Abstraction topic has the most posts (36.4%). Use for: RxJS operator surface is large and actually used, which makes static modelling hard.

**alabor2020debugging** (REBLS workshop 2020). Interviews with 10 professionals plus an observational study of 4 subjects found that engineers debugging RxJS mostly add manual trace logs rather than using specialised tools. Note: workshop paper, small sample.

## E. LLMs / agents for GUI testing and repository context

**liu2024make** (ICSE 2024, GPTDroid). Frames mobile GUI testing as Q&A: GUI page info goes to the LLM, the LLM returns actions, and app feedback goes back in. A functionality-aware memory prompt supports long-term reasoning. On 93 Google Play apps it gets 32% higher activity coverage and finds 31% more bugs than the best baseline, plus 53 new bugs (35 confirmed or fixed). Use for: LLM testers explore without a model of the app's navigation structure, which motivates supplying one.

**wen2024autodroid** (MobiCom 2024). An LLM-based Android task automation system. It combines LLM commonsense with app-specific knowledge from *automated dynamic analysis*, using a functionality-aware UI representation and exploration-based memory injection. It reaches 90.9% action accuracy and a 71.3% task success rate on 158 tasks. Use for: LLM agents work better when given app-specific knowledge. Here that knowledge comes from dynamic exploration, and a static navigation graph is one alternative source.

**wang2024leveraging** (ICSME 2024, VETL). An LVLM-driven end-to-end web GUI testing technique for text inputs and element selection, with curiosity-driven exploration. It discovers 25% more unique web actions than WebExplor. Use for: an LLM-based tool that targets *web* GUIs specifically.

**wang2024software** (TSE 2024). A survey of 102 studies on LLMs in software testing, covering tasks, models, prompting and challenges. Use for: a general survey reference.

**jimenez2024swebench** (ICLR 2024 oral). A benchmark of 2,294 real GitHub issues from 12 Python repos. Solving them often needs coordinated edits across functions, classes and files, and the best model at the time (Claude 2) solved 1.96%. Use for: repository-level understanding is the bottleneck for coding agents.

**yang2024sweagent** (NeurIPS 2024). A custom agent-computer interface (ACI) that lets LM agents navigate repositories, edit files and run tests. It reached 12.5% pass@1 on SWE-bench, and interface design strongly affects agent performance. Use for: agents benefit from structured tooling and context about the codebase.

**zhang2023repocoder** (EMNLP 2023). Iterative retrieval and generation for repository-level code completion, with a new RepoBench benchmark. It improves the in-file baseline by over 10% in all settings. Use for: cross-file context improves LLM code tasks.

## F. Change impact analysis

**bohner1996software** (IEEE CS Press 1996, ISBN 0-8186-7384-2). An edited collection (Bohner and Arnold as editors) of representative papers on impact analysis, covering source-code dependency analysis and traceability analysis (per the Wiley description). This is the standard reference for the term "impact analysis".

**arnold1993impact** (CSM 1993) *(added)*. Defines a three-part framework for comparing impact analysis approaches: how the approach is used, how it works internally, and how effective it is. It illustrates the framework on five approaches. Use for: a citable peer-reviewed definition from the same authors.

**ren2004chianti** (OOPSLA 2004). Chianti breaks the difference between two program versions into atomic changes, then reports affected tests and, for each test, the changes that affect it. On a year of Daikon CVS data, on average 52% of unit tests were affected, each by only 3.95% of the atomic changes. Use for: a classic static and dynamic change impact analysis tool.

**lehnert2011taxonomy** (IWPSE-EVOL 2011, workshop). A taxonomy for classifying impact analysis approaches, built from a literature review, with criteria more detailed than earlier frameworks. Use for: placing your "which screens does this change affect" analysis in the CIA taxonomy.
