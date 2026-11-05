#!/usr/bin/env bash
# generated-plots-rq4.tex: the mutation plot coordinates, from route-oracle/results-rq4.
. "$(dirname "$0")/lib.sh"
cd "$RO" && node to-plots.mjs --rq4-only results-rq4/rq4-realworld-attributed.json results-rq4/rq4-alfresco-attributed.json \
  results-rq4/rq4-bitwarden-attributed.json > "$OUT/generated-plots-rq4.tex"
