# Round-two run outputs

`final7.tgz` holds the outputs of two `run-all.mjs` runs over extractor eb9dab80, harness 1.8.0,
made on 2026-10-30: `ctrl/` without attribution, `fin/` with it, and `round2/` as
`round2-to-latex.mjs` read them (`results.json`, the per-application `.B`, `.C`, `.L`, `.notes`
and `.diag` files, and `raw/`). `to-latex.mjs` reads `ctrl/results.json` for
`generated-tables.tex`, `compare.mjs` reads both runs for `generated-before-after.tex`, and
`round2-to-latex.mjs` reads `round2/` for `generated-round2.tex`. They are archived here because
the working copies were under `/tmp`, which the operating system prunes.

**They do not reproduce the tables committed in `thesis/`.** Checked on 2026-11-01 against the
tables of 7d109c7:

- `to-latex.mjs ctrl/results.json` prints a different loss ledger. ghostfolio holds 65
  attribution-shared constructs, not 63, and 7 query-only, not 11; bitwarden holds 40
  attribution-shared and 16 query-only, not 38 and 19. `compare.mjs` then closes on 459 lost
  constructs where `generated-before-after.tex` says 455.
- `round2-to-latex.mjs round2` refuses the archive ("46/25 is 184.0 %"): for one application the
  witness check's `clean` exceeds the sites it judged.

So the archive is one run of the pipeline and the committed tables are the output of another, whose
files were lost, and neither can stand in for the other. `regen-round.sh <work dir> <out dir>`
re-runs the pipeline at the current commit and rewrites the four tables from its own output;
replace `final7.tgz` with an archive of the `<out dir>` it leaves.
