#!/usr/bin/env bash
# generated-tables.tex: the corpus tables, from the run without attribution in final16.tgz.
. "$(dirname "$0")/lib.sh"; R=$(final16)
cd "$RO" && node to-latex.mjs "$R/ctrl/results.json" > "$OUT/generated-tables.tex"
