#!/usr/bin/env bash
# generated-route-order.tex: the must tier without the route-order assumption, from the corpus graphs.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && "$TSX" route-order.mjs --corpus "$WORK/corpus" --out "$SCRATCH" --tex "$OUT/generated-route-order.tex" > /dev/null
