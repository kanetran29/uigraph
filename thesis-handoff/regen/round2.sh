#!/usr/bin/env bash
# generated-round2.tex: the round-two tier and loss figures, from round2/ in final16.tgz.
. "$(dirname "$0")/lib.sh"; R=$(final16)
cd "$RO" && node round2-to-latex.mjs "$R/round2" > "$OUT/generated-round2.tex"
