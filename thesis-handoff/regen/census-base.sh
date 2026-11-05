#!/usr/bin/env bash
# generated-census-base.tex: the same census of the graphs mapped without attribution (work directory noattr/).
. "$(dirname "$0")/lib.sh"; need "$WORK/noattr/realworld/uigraph.db"
cd "$RO" && node graph-census.mjs --corpus "$WORK/noattr" --prefix CensusBase --reading-subset --out "$SCRATCH" \
  --tex "$OUT/generated-census-base.tex" > /dev/null
