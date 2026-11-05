#!/usr/bin/env bash
# generated-h2h.tex: the head-to-head with Rima et al.'s tool, from the blind readings in rima/head2head.
. "$(dirname "$0")/lib.sh"
cd "$H/rima/head2head" && node score.mjs --reading results-v3/reading.json --strata results-v3/strata.json \
  --raw results/raw.json,results-v2/raw-new.json --corrections results/corrections.json \
  --json "$SCRATCH/score.json" --tex "$OUT/generated-h2h.tex" > /dev/null
