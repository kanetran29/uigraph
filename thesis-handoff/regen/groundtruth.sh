#!/usr/bin/env bash
# generated-groundtruth.tex: the realworld structural reference scored at each level, from ablation.tgz.
. "$(dirname "$0")/lib.sh"; A=$(ablation)
cd "$RO" && "$TSX" score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$A/realworld.$l.uigraph.db"; done) \
  --tex "$OUT/generated-groundtruth.tex" 2> /dev/null
