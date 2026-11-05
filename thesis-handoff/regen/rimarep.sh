#!/usr/bin/env bash
# generated-rimarep.tex: the same as rima.sh with the repaired extractor's graphs (graphs-repaired).
. "$(dirname "$0")/lib.sh"; need "$RIMA_GT"
cd "$H/rima" && node score.mjs --gt "$RIMA_GT" --graphs graphs-repaired --subjects subjects.txt --prefix RimaRep \
  --json "$SCRATCH/r.json" --tex "$OUT/generated-rimarep.tex" > /dev/null
