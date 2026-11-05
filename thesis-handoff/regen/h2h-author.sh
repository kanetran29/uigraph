#!/usr/bin/env bash
# generated-h2h-author.tex: the author's re-reading of the head-to-head sample, from results-v3/author-check.json.
. "$(dirname "$0")/lib.sh"
cd "$H/rima/head2head" && node author-check.mjs results-v3/author-check.json "$OUT/generated-h2h-author.tex" > /dev/null
