#!/usr/bin/env bash
# generated-plots.tex: the plot coordinates, from final16.tgz and the mutation results.
. "$(dirname "$0")/lib.sh"; R=$(final16)
cd "$RO" && node to-plots.mjs "$R/ctrl/results.json" "$R/fin/results.json" \
  results-rq4/rq4-realworld-attributed.json results-rq4/rq4-alfresco-attributed.json results-rq4/rq4-bitwarden-attributed.json \
  > "$OUT/generated-plots.tex"
