#!/usr/bin/env bash
# generated-must-run.tex: the runtime check of the must tier, from the driver results in must-run/results.
# constructs.mjs runs first as a guard: the prose says no check failed, so a failed check stops here.
. "$(dirname "$0")/lib.sh"
cd "$H/must-run" && node constructs.mjs --tex "$SCRATCH/guard.tex" results/realworld.json results/mifos.json > /dev/null && node score.mjs --results results --apps realworld,mifos --tex "$OUT/generated-must-run.tex" > /dev/null
