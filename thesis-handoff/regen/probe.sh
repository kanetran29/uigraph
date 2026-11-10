#!/usr/bin/env bash
# generated-probe.tex: the runtime route check from route-probe/results, and the scope check re-scored on the
# final graph (results-final, rescore-final.mjs) from the observations in results.
. "$(dirname "$0")/lib.sh"
cd "$H/route-probe" && node to-latex.mjs --results results --scope results-final --before results-before --out "$OUT/generated-probe.tex" > /dev/null
