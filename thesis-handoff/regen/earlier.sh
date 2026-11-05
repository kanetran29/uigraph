#!/usr/bin/env bash
# generated-earlier.tex: the earlier instrument's figures, read out of git at f17a302 and 7d109c7.
. "$(dirname "$0")/lib.sh"
cd "$RO" && node earlier-instrument.mjs --tex "$OUT/generated-earlier.tex" > /dev/null
