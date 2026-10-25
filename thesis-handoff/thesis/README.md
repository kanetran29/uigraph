# Thesis scaffold

Structure only. No filler prose: every file carries its section headings, a note
on what belongs there, and a page target taken from a sample of seven Aalto CS
and Security master's theses read in full.

## Getting the class files

This scaffold assumes the official `aaltothesis` class. It is not included here.

- Aalto wiki: search the Aalto intranet wiki for "Aalto Thesis LaTeX Template"
- Overleaf: "Aalto University bachelor's, master's and licentiate thesis template"
- GitHub mirror with example chapters: `zwuh/aalto-thesis`

Copy `aaltothesis.cls` and `aaltologo.sty` next to `main.tex`, then:

```
latexmk -pdf main.tex
```

Check the school, degree programme and major strings in the class file against
your own record before submitting. They differ by school.

## Page targets

Structure after Petri's review (5 Oct 2026): seven chapters, Chapter 3 split.

| chapter | file | target |
|---|---|---|
| 1 Introduction | ch1-introduction.tex | 4-6 |
| 2 Background | ch2-background.tex | 12-18 |
| 3 Static navigation analysis and scope attribution | ch3-analysis.tex | 10-15 |
| 4 Evaluation setup and research material | ch4-evaluation.tex | 8-12 |
| 5 Results | ch5-results.tex | 10-15 |
| 6 Discussion | ch6-discussion.tex | 8-12 |
| 7 Conclusion | ch7-conclusion.tex | 1-2 |

Result tables live in generated-tables.tex. Regenerate with
`node to-latex.mjs results/results.json > generated-tables.tex`; never edit by hand.

Total 70 to 90 pages. The sampled theses ran 53 to 133 with a median near 93;
theses from this supervisor cluster tighter at 55 to 70.

## Conventions taken from the sample

- Six main chapters is the modal structure for this school. This thesis uses seven
  because the supervisor asked for the analysis and the evaluation setup to be separate.
- Related work is folded into Background, not given its own chapter.
- Threats to validity is never a standalone chapter. It is a subsection of half
  a page to two pages inside Discussion.
- Chapter 1 carries an explicit research-questions section and a "Structure of
  the thesis" section. Every thesis this supervisor signs has both.

## References

`references.bib` contains only entries verified during research: a page was
opened confirming the work exists. Entries that were named but not confirmed sit
in a commented block at the end of that file under VERIFY BEFORE USE. Do not
move one up without opening its DOI or publisher page first.
