#!/usr/bin/env bash
# generated-approx.tex: counts of the declared approximations in realworld, alfresco and bitwarden,
# read from the application sources in the work directory.
. "$(dirname "$0")/lib.sh"; need "$WORK/corpus/realworld"
cd "$RO" && node approx-counts.mjs realworld="$WORK/corpus/realworld" alfresco="$WORK/corpus/alfresco/projects/aca-content" \
  bitwarden="$WORK/corpus/bitwarden/apps/web" --tex > "$OUT/generated-approx.tex"
