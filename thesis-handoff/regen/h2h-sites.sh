#!/usr/bin/env bash
# generated-h2h-sites.tex: the preregistered token check of the sites cited for real head-to-head pairs.
. "$(dirname "$0")/lib.sh"; need "$WORK/rima/src" "$WORK/corpus/realworld"
cd "$H/rima/head2head" && node check-sites.mjs --score results-v3/score.json --apps apps.txt --work "$WORK" \
  --tex "$OUT/generated-h2h-sites.tex" > /dev/null
