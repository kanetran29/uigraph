# Round-two run outputs

`final7.tgz` holds the outputs of the two `run-all.mjs` runs over extractor eb9dab80, harness
1.8.0, that the round-two tables of Chapter 5 are generated from: `ctrl/` without attribution,
`fin/` with it, and `round2/` as `round2-to-latex.mjs` read them on 2026-10-30
(`results.json`, the per-application `.B`, `.C`, `.L`, `.notes` and `.diag` files, and `raw/`).
`to-latex.mjs` read `ctrl/results.json` for `generated-tables.tex`, `compare.mjs` read both runs
for `generated-before-after.tex`, and `round2-to-latex.mjs` read `round2/` for
`generated-round2.tex`. They are archived here because the working copies were under `/tmp`,
which the operating system prunes.
