#!/usr/bin/env bash
# generated-must-run-addendum.tex: Addendum A of the must-tier runtime check (realworld signed in,
# k8s dashboard toolbar), from must-run/results-addendum; macros MustRunAdd<App><Measure>.
. "$(dirname "$0")/lib.sh"
cd "$H/must-run" && node score.mjs --results results-addendum --apps realworld,k8sdash --prefix MustRunAdd --tex "$OUT/generated-must-run-addendum.tex" > /dev/null
