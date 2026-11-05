#!/usr/bin/env bash
# generated-earlier-work.tex: the earlier-work restrictions, from the run with attribution in final16.tgz.
. "$(dirname "$0")/lib.sh"; R=$(final16)
cd "$RO" && node earlier-work.mjs --dir "$R/fin" --apps realworld,alfresco,ghostfolio,k8sdash,bitwarden,mifos \
  --tex "$OUT/generated-earlier-work.tex" > /dev/null
