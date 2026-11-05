#!/usr/bin/env bash
# generated-must.tex: the ledger of the must tier, the corpus graphs against the round-two graphs.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && "$TSX" must-context.mjs --corpus "$WORK/corpus" --before round-two-graphs --after "$WORK/corpus" \
  --out "$SCRATCH" --tex "$OUT/generated-must.tex" > /dev/null
