#!/usr/bin/env bash
# generated-ablation.tex: the scope-attribution ablation and width table, from ablation.tgz.
. "$(dirname "$0")/lib.sh"; A=$(ablation)
cd "$RO" && "$TSX" scope-ablation.mjs --corpus "$SCRATCH/c" --out "$SCRATCH/o" --from "$A/ablation.json" \
  --tex "$OUT/generated-ablation.tex" > /dev/null
