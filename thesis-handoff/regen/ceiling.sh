#!/usr/bin/env bash
# generated-ceiling.tex: the static ceiling, joining the author's class of every remaining miss
# (ceiling-classes.json) to both structural references and the end-to-end check.
. "$(dirname "$0")/lib.sh"; A=$(ablation); L=$WORK/alfresco-levels; need "$L/full.db"
cd "$RO"
"$TSX" score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$A/realworld.$l.uigraph.db"; done) \
  --tex "$SCRATCH/gt.tex" --json "$SCRATCH/gt-realworld.json" 2> /dev/null
"$TSX" score-ground-truth.mjs --truth ground-truth/alfresco.json --prefix GTAlf \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$L/$l.db"; done) \
  --tex "$SCRATCH/gta.tex" --json "$SCRATCH/gt-alfresco.json" 2> /dev/null
node ceiling.mjs --classes ceiling-classes.json --gt realworld="$SCRATCH/gt-realworld.json" --gt alfresco="$SCRATCH/gt-alfresco.json" \
  --e2e realworld=../e2e-nav/results/realworld --e2e mifos=../e2e-nav/results/mifos --tex "$OUT/generated-ceiling.tex" > /dev/null
