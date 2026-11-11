#!/usr/bin/env bash
# generated-must-run-addendum.tex: Addendum A of the must-tier runtime check (realworld signed in,
# k8s dashboard toolbar) from must-run/results-addendum, macros MustRunAdd<App><Measure>; and the
# k8s dashboard first pass (DEVIATIONS A4) from results-addendum/pass1, macros MustRunAddFirst....
. "$(dirname "$0")/lib.sh"
cd "$H/must-run"
node score.mjs --results results-addendum --apps realworld,kdash --prefix MustRunAdd --tex "$SCRATCH/a.tex" > /dev/null
node score.mjs --results results-addendum/pass1 --apps kdash --prefix MustRunAddFirst --tex "$SCRATCH/b.tex" > /dev/null
{ cat "$SCRATCH/a.tex"; grep -v '^%' "$SCRATCH/b.tex" | grep -v 'MustRunAddFirstAll'; } > "$OUT/generated-must-run-addendum.tex"
