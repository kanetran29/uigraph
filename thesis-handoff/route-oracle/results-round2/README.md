# Round-two run outputs

`final16.tgz` holds the outputs `regen-round.sh` left for the tables the thesis prints: two
`run-all.mjs` runs at a9d29df, harness 1.10.0 (mutation harness 1.9.1), made on 2026-11-05 after the
four repairs the comparison on Rima et al.'s subjects found. `ctrl/` is the run without attribution,
`fin/` the run with it, and `round2/` holds the files `round2-to-latex.mjs` reads (`results.json`, the
per-application `.B`, `.C`, `.L`, `.notes`, `.why` and `.diag` files, and `raw/`); the staged tables are
in `tex/`. `regen/tables.sh`, `before-after.sh`, `round2.sh`, `plots.sh` and `earlier-work.sh` read it,
and each writes the file committed in `thesis/` (provenance comment lines aside).

Earlier archives (final7, final12, final14 and final15, runs at earlier extractor commits, and why
final7 did not reproduce the tables of its time) are in the repository's history up to commit
27a8999; the thesis reports none of them.
