# Round-two run outputs

`final16.tgz` holds the outputs `regen-round.sh` left for the tables the thesis prints: two
`run-all.mjs` runs at a9d29df, harness 1.10.0 (mutation harness 1.9.1), made on 2026-11-05 after the
four repairs the comparison on Rima et al.'s subjects found; `regen/` reads it. `final15.tgz` is the same
pipeline at f26a302 (extractor 2aac284), after the repairs the end-to-end check exposed. `final14.tgz` is the same pipeline at c42f220,
before those repairs, and `final12.tgz` at 920e1aa, before the in-scope conversion
denominator and the joined expansion; it reproduces the tables of that commit, not the current ones. `ctrl/` is
the run without attribution, `fin/` the run with it, and `round2/` holds the files
`round2-to-latex.mjs` read (`results.json`, the per-application `.B`, `.C`, `.L`, `.notes`, `.why`
and `.diag` files, and `raw/`); the staged tables are in `tex/`. `to-latex.mjs` reads
`ctrl/results.json` for `generated-tables.tex`, `compare.mjs` reads both runs for
`generated-before-after.tex`, `round2-to-latex.mjs` reads `round2/` for `generated-round2.tex`, and
`to-plots.mjs` reads both results files and the mutation results for `generated-plots.tex`.

To check that the archive is the one the thesis prints, unpack it and run the first three
generators on it; each writes the file committed in `thesis/` byte for byte. `generated-plots.tex`
also takes its mutation figures from `results-rq4/` beside this directory.

## The archive this one replaces

`final7.tgz` held two runs over extractor eb9dab80 (2026-10-30). It did not reproduce the round
tables committed at the time: `to-latex.mjs` printed a different loss ledger from it (ghostfolio 65
attribution-shared constructs, not 63; bitwarden 40, not 38) and `round2-to-latex.mjs` refused it
("46/25 is 184.0 %"). The committed tables had come from another run whose files were lost. Those
tables were therefore not carried forward: the pipeline was re-run at the final commit and every
table regenerated from that run, which is what `final12.tgz`, `final14.tgz` and `final15.tgz` archived and `final16.tgz` now does. `final7.tgz` remains in the
repository's history. The figures the chapters cite for the round's own tier are read out of git
at 7d109c7 by `earlier-instrument.mjs`, as the round's tables printed them.
