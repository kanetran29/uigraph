#!/usr/bin/env bash
# generated-callgraph.tex: how much of the call graph resolves, from the corpus graphs.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && "$TSX" callgraph-stats.mjs --corpus "$WORK/corpus" --out "$SCRATCH" --tex "$OUT/generated-callgraph.tex" > /dev/null
