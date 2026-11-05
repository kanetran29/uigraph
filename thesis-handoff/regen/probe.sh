#!/usr/bin/env bash
# generated-probe.tex: the runtime scope and route checks, from route-probe/results.
. "$(dirname "$0")/lib.sh"
cd "$H/route-probe" && node to-latex.mjs --results results --before results-before --out "$OUT/generated-probe.tex" > /dev/null
