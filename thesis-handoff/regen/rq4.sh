#!/usr/bin/env bash
# generated-rq4.tex: the mutation (RQ4) tables, from route-oracle/results-rq4.
. "$(dirname "$0")/lib.sh"
cd "$RO/results-rq4" && node ../rq4-to-latex.mjs rq4-{realworld,alfresco,bitwarden}-attributed.json \
  rq4base-{realworld,alfresco,bitwarden}.json rq4earlier-{realworld,alfresco,bitwarden}.json \
  > "$OUT/generated-rq4.tex" 2> /dev/null
