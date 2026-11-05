#!/usr/bin/env bash
# generated-e2e.tex: the end-to-end navigation check, from the archived logs and graphs in e2e-nav/results.
. "$(dirname "$0")/lib.sh"
cd "$H/e2e-nav" && node score.mjs --app realworld=results/realworld --app mifos=results/mifos --tex "$OUT/generated-e2e.tex" > /dev/null
