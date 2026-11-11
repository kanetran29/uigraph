#!/usr/bin/env bash
# generated-must-run.tex: the runtime check of the must tier, from the driver results in must-run/results.
. "$(dirname "$0")/lib.sh"
cd "$H/must-run" && node score.mjs --results results --apps realworld,mifos --tex "$OUT/generated-must-run.tex" > /dev/null
