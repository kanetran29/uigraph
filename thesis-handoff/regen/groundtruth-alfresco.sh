#!/usr/bin/env bash
# generated-groundtruth-alfresco.tex: the alfresco structural reference scored at each level, from the
# level graphs in the work directory (alfresco-levels).
. "$(dirname "$0")/lib.sh"; L=$WORK/alfresco-levels; need "$L/owned.db" "$L/full.db"
cd "$RO" && "$TSX" score-ground-truth.mjs --truth ground-truth/alfresco.json --prefix GTAlf \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$L/$l.db"; done) \
  --tex "$OUT/generated-groundtruth-alfresco.tex" 2> /dev/null
