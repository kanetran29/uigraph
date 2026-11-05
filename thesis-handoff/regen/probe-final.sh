#!/usr/bin/env bash
# generated-probe-final.tex: the runtime route oracle's reading compared with the final graph,
# from route-probe/results (the reading) and route-probe/results-final (that reading against a9d29df).
. "$(dirname "$0")/lib.sh"
cd "$H/route-probe" && node final-check.mjs --before results --final results-final --tex "$OUT/generated-probe-final.tex" > /dev/null
