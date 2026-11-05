#!/usr/bin/env bash
# generated-rima-verdicts.tex: the source readings of the pairs outside Rima et al.'s reference.
. "$(dirname "$0")/lib.sh"; need "$RIMA_GT"
cd "$H/rima" && node verdicts.mjs --raw adjudication-raw.json,adjudication-raw-traduora.json:ever-traduora \
  --input adjudication-input.json --out "$SCRATCH/adjudication.json" --causes spurious-causes.json \
  --corrections corrections.json --results results.json --gt "$RIMA_GT" --tex "$OUT/generated-rima-verdicts.tex" > /dev/null
