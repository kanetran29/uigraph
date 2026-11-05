#!/usr/bin/env bash
# generated-guard-only.tex: the must tier with every guard passing, from the corpus graphs.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && "$TSX" guard-only.mjs --corpus "$WORK/corpus" --out "$SCRATCH" --tex "$OUT/generated-guard-only.tex" > /dev/null
