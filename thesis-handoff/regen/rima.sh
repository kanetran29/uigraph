#!/usr/bin/env bash
# generated-rima.tex: our graphs (frozen extractor) on Rima et al.'s reference. Their reference has no
# licence, so it stays in the work directory.
. "$(dirname "$0")/lib.sh"; need "$RIMA_GT"
cd "$H/rima" && node score.mjs --gt "$RIMA_GT" --graphs graphs --subjects subjects.txt \
  --json "$SCRATCH/r.json" --tex "$OUT/generated-rima.tex" > /dev/null
