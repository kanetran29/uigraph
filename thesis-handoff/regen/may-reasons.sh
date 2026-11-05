#!/usr/bin/env bash
# generated-may-reasons.tex: why the may tier is may, from the graphs mapped with UIGRAPH_MAY_REASONS=1
# (work directory may-reasons/), checked against the corpus graphs.
. "$(dirname "$0")/lib.sh"; M=$WORK/may-reasons; need "$M/realworld.uigraph.db" "$M/realworld.unset.uigraph.db"
cd "$RO" && node may-reasons.mjs $(for p in $APPS; do echo --db ${p%%:*}="$M/${p%%:*}.uigraph.db"; done) \
  $(for p in $APPS; do echo --corpus ${p%%:*}="$WORK/corpus/${p%%:*}/${p#*:}/uigraph.db"; done) \
  --unset "$M/realworld.unset.uigraph.db" --tex "$OUT/generated-may-reasons.tex" > /dev/null
