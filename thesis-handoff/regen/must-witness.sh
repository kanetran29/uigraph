#!/usr/bin/env bash
# generated-must-witness.tex: the witness check of the must tier, from route-oracle/results-must/witness.
. "$(dirname "$0")/lib.sh"
cd "$RO" && node must-witness.mjs --dir results-must/witness --tex "$OUT/generated-must-witness.tex" > /dev/null
