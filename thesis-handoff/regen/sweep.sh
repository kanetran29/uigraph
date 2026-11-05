#!/usr/bin/env bash
# generated-sweep.tex: the demotion-rule mutation sweep, from route-oracle/results-must/mutation-sweep.json.
. "$(dirname "$0")/lib.sh"
cd "$RO" && node sweep-to-latex.mjs --tex "$OUT/generated-sweep.tex" > /dev/null
