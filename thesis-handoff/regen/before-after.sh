#!/usr/bin/env bash
# generated-before-after.tex: the runs without and with attribution compared, from final16.tgz.
. "$(dirname "$0")/lib.sh"; R=$(final16)
cd "$RO" && node compare.mjs "$R/ctrl" "$R/fin" --tex "$OUT/generated-before-after.tex" > /dev/null
