#!/bin/bash
# The steps after remeasure.sh that the end-to-end check, the alfresco reference and the static
# ceiling need: copy the corpus graphs into e2e-nav/results, map mifos at the two levels that
# stand for earlier work, score the suites, map the alfresco levels, score both structural
# references with their per-site misses, and join every remaining miss to its class.
#
# Usage: post-remeasure.sh <work dir that remeasure.sh used>
set -euo pipefail
W=$(cd "$1" && pwd)
case "$W" in /tmp/*|/private/tmp/*) echo "the work dir must not be under /tmp" >&2; exit 2;; esac
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd); H="$REPO/thesis-handoff"
if [ -n "$(git -C "$REPO" status --porcelain -- packages)" ]; then echo "packages/ has uncommitted changes; commit before measuring" >&2; exit 2; fi
CLI="pnpm -s -C $REPO/packages/cli run uigraph --"
export NODE_OPTIONS=--max-old-space-size=8192
# Writes one document of a uigraph database, gzipped.
doc() { node -e "const {DatabaseSync}=require('node:sqlite');const z=require('zlib');const r=new DatabaseSync(process.argv[1]).prepare('select json from docs where key=?').get(process.argv[2]);require('fs').writeFileSync(process.argv[3],z.gzipSync(r.json))" "$1" "$2" "$3" 2>/dev/null; }

echo "== e2e graphs"
mkdir -p "$W/mifos-levels"
for l in rooted outlet; do
  rm -f "$W/mifos-levels/$l.db"
  UIGRAPH_SCOPE_LAYERS=$l $CLI map "$W/corpus/mifos" --adapter angular --attribution --out "$W/mifos-levels/$l.db" > "$W/mifos-levels/$l.log" 2>&1
  doc "$W/mifos-levels/$l.db" graph "$H/e2e-nav/results/mifos/graph-$l.json.gz"
  doc "$W/ablation/realworld.$l.uigraph.db" graph "$H/e2e-nav/results/realworld/graph-$l.json.gz"
done
for a in realworld mifos; do
  R=$H/e2e-nav/results/$a
  # The graph before the repairs the check exposed, mapped at c42f220 and committed until f26a302.
  [ -f "$R/graph-unfixed.json.gz" ] || git -C "$REPO" show f26a302:thesis-handoff/e2e-nav/results/$a/graph.json.gz > "$R/graph-unfixed.json.gz"
  doc "$W/corpus/$a/uigraph.db" graph "$R/graph.json.gz"
  doc "$W/corpus/$a/uigraph.db" soundiness "$R/soundiness.json.gz"
  doc "$W/noattr/$a/uigraph.db" graph "$R/graph-noattr.json.gz"
done
(cd "$H/e2e-nav" && node score.mjs --app realworld=results/realworld --app mifos=results/mifos --tex ../thesis/generated-e2e.tex > "$W/e2e-score.txt")

echo "== alfresco levels"
mkdir -p "$W/alfresco-levels"
for l in owned nesting rooted outlet class full; do
  rm -f "$W/alfresco-levels/$l.db"
  if [ "$l" = full ]; then $CLI map "$W/corpus/alfresco/projects/aca-content" --adapter angular --attribution --out "$W/alfresco-levels/$l.db" > "$W/alfresco-levels/$l.log" 2>&1
  else UIGRAPH_SCOPE_LAYERS=$l $CLI map "$W/corpus/alfresco/projects/aca-content" --adapter angular --attribution --out "$W/alfresco-levels/$l.db" > "$W/alfresco-levels/$l.log" 2>&1; fi
done

echo "== ground truth"
cd "$HERE"
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/alfresco.json --prefix GTAlf \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$W/alfresco-levels/$l.db"; done) \
  --tex ../thesis/generated-groundtruth-alfresco.tex --json "$W/gt-alfresco.json" 2> "$W/gt-alfresco.txt"
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$W/ablation/realworld.$l.uigraph.db"; done) \
  --tex ../thesis/generated-groundtruth.tex --json "$W/gt-realworld.json" 2> "$W/gt-realworld.txt"

echo "== ceiling"
node ceiling.mjs --classes ceiling-classes.json \
  --gt realworld="$W/gt-realworld.json" --gt alfresco="$W/gt-alfresco.json" \
  --e2e realworld=../e2e-nav/results/realworld --e2e mifos=../e2e-nav/results/mifos \
  --tex ../thesis/generated-ceiling.tex
echo "== runtime route oracle against the final graph"
APPS="realworld:. alfresco:projects/aca-content ghostfolio:apps/client k8sdash:modules/web bitwarden:apps/web mifos:."
for p in $APPS; do a=${p%%:*}; s=${p#*:}
  node "$H/route-probe/compare-probe.mjs" --probe "$H/route-probe/results/$a.probe.json" --oracle "$W/C-$a.json" \
    --db "$W/corpus/$a/$s/uigraph.db" --out "$H/route-probe/results-final/$a.cmp.json" > /dev/null 2>&1
done
(cd "$H/route-probe" && node final-check.mjs --tex ../thesis/generated-probe-final.tex)
echo "== post done"
