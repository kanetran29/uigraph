#!/usr/bin/env bash
# generated-expansion.tex: anchored edges checked against their expansion, from the corpus graphs.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld/uigraph.db"
cd "$RO" && "$TSX" expansion-check.mts $(for p in $APPS; do echo "$WORK/corpus/${p%%:*}/${p#*:}/uigraph.db"; done) --tex \
  > "$OUT/generated-expansion.tex"
