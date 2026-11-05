#!/usr/bin/env bash
# generated-census.tex: the census of the corpus graphs mapped with attribution (work directory corpus/).
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && node graph-census.mjs --corpus "$WORK/corpus" --out "$SCRATCH" --tex "$OUT/generated-census.tex" > /dev/null
