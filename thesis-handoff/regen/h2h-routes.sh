#!/usr/bin/env bash
# generated-h2h-routes.tex: which of their tool's routes name a screen of ours (validity check V2).
# Needs their tool's output in the work directory (rima/theirs), which is not committed.
. "$(dirname "$0")/lib.sh"; need "$WORK/rima/theirs"
cd "$H/rima/head2head" && node routes-v2.mjs --work "$WORK" --decls results-v2/route-decls.json \
  --json "$SCRATCH/routes.json" --tex "$OUT/generated-h2h-routes.tex" > /dev/null
