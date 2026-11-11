#!/usr/bin/env bash
# generated-must-run-addendum.tex: Addendum A of the must-tier runtime check (realworld signed in,
# k8s dashboard toolbar) from must-run/results-addendum, macros MustRunAdd<App><Measure>; and the
# k8s dashboard first pass (DEVIATIONS A4) from results-addendum/pass1, macros MustRunAddFirst...;
# and MustRunConfirmedConstructs, the must constructs confirmed at least once over both runs.
. "$(dirname "$0")/lib.sh"
cd "$H/must-run"
node score.mjs --results results-addendum --apps realworld,kdash --prefix MustRunAdd --tex "$SCRATCH/a.tex" > /dev/null
node score.mjs --results results-addendum/pass1 --apps kdash --prefix MustRunAddFirst --tex "$SCRATCH/b.tex" > /dev/null
node constructs.mjs --tex "$SCRATCH/c.tex" results/realworld.json results/mifos.json results-addendum/realworld.json results-addendum/kdash.json > /dev/null
{ cat "$SCRATCH/a.tex"; grep -v '^%' "$SCRATCH/b.tex" | grep -v 'MustRunAddFirstAll'; grep -v '^%' "$SCRATCH/c.tex"; } > "$OUT/generated-must-run-addendum.tex"
