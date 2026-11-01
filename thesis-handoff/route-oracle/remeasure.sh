#!/bin/bash
# Re-measure every figure that depends on the current extractor, in an order that keeps the
# measurements apart: the corpus is mapped first, the read-only harnesses run on those graphs,
# the ablation re-extracts and restores them, and the mutation run edits sources in place, so it
# runs last and on a copy of the corpus, never on the one the others read.
#
# Usage: remeasure.sh <work dir holding corpus/<app>>
# The work dir must not be under /tmp: macOS deletes files there it has not seen used for a few
# days, and it emptied every corpus repository's .git once during this work.
set -euo pipefail
W=$(cd "$1" && pwd)
case "$W" in /tmp/*|/private/tmp/*) echo "the work dir must not be under /tmp" >&2; exit 2;; esac
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd); TEX="$HERE/../thesis"; BEFORE="$HERE/round-two-graphs"
APPS="realworld:. alfresco:projects/aca-content ghostfolio:apps/client k8sdash:modules/web bitwarden:apps/web mifos:."
if [ -n "$(git -C "$REPO" status --porcelain -- packages)" ]; then echo "packages/ has uncommitted changes; commit before measuring" >&2; exit 2; fi
CLI="pnpm -s -C $REPO/packages/cli run uigraph --"; MAP="$CLI map"
export NODE_OPTIONS=--max-old-space-size=8192
cd "$HERE"

echo "== map $(git -C "$REPO" rev-parse --short HEAD)"
for p in $APPS; do a=${p%%:*}; s=${p#*:}
  rm -f "$W/corpus/$a/$s/uigraph.db"; $MAP "$W/corpus/$a/$s" --adapter angular --attribution > /dev/null 2>&1
  mkdir -p "$W/noattr/$a/$s"; rm -f "$W/noattr/$a/$s/uigraph.db"; $MAP "$W/corpus/$a/$s" --adapter angular --out "$W/noattr/$a/$s/uigraph.db" > /dev/null 2>&1
done

echo "== census"
node graph-census.mjs --corpus "$W/corpus" --out results-census --tex "$TEX/generated-census.tex"
# The recorded reading of the must tier was made on the attributed graphs, so the unattributed ones are checked against it as a subset.
node graph-census.mjs --corpus "$W/noattr" --prefix CensusBase --reading-subset --out results-census --tex "$TEX/generated-census-base.tex"

echo "== anchored edges against their expansion"
pnpm -s exec tsx expansion-check.mts $(for p in $APPS; do a=${p%%:*}; s=${p#*:}; echo "$W/corpus/$a/$s/uigraph.db"; done) --tex > "$W/expansion.tex"
cp "$W/expansion.tex" "$TEX/generated-expansion.tex"

echo "== witness check of the must tier"
mkdir -p results-must/witness
for p in $APPS; do a=${p%%:*}; s=${p#*:}
  # The independent parser's route set, against which each must edge's destination is tested.
  node index.mjs "$W/corpus/$a/$s" "$W/corpus/$a/$s/uigraph.db" --json "$W/C-$a.json" > /dev/null 2>&1
  node witness-check.mjs "$W/corpus/$a/$s" "$W/corpus/$a/$s/uigraph.db" --routes "$W/C-$a.json" --json "$W/wc-$a.json" > /dev/null 2>&1
  node -e "const d=require('$W/wc-$a.json');const o={};for(const k of ['edges','sitesCited','mergedSites','mustEdges','mustClean','mustUnread','destinationsChecked','mustBad','tally'])o[k]=d[k];require('fs').writeFileSync('results-must/witness/$a.json',JSON.stringify(o,null,1)+'\n')"
done
node must-witness.mjs --dir results-must/witness --tex "$TEX/generated-must-witness.tex"

echo "== ledger of the round's tier"
pnpm -s -C "$REPO" exec tsx "$HERE/must-context.mjs" --corpus "$W/corpus" --before "$BEFORE" --after "$W/corpus" --out "$HERE/results-must" --tex "$TEX/generated-must.tex"

echo "== must tier with every guard passing"
pnpm -s -C "$REPO" exec tsx "$HERE/guard-only.mjs" --corpus "$W/corpus" --out "$W/guard-only" --tex "$TEX/generated-guard-only.tex"
cp "$W/guard-only/guard-only.json" results-must/guard-only.json

echo "== call graph resolution"
pnpm -s -C "$REPO" exec tsx "$HERE/callgraph-stats.mjs" --corpus "$W/corpus" --out "$HERE/results-callgraph" --tex "$TEX/generated-callgraph.tex"

echo "== ablation, width table and ground truth"
pnpm -s exec tsx scope-ablation.mjs --corpus "$W/corpus" --out "$W/ablation" --keep realworld --tex "$TEX/generated-ablation.tex"
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$W/ablation/realworld.$l.uigraph.db"; done) --tex "$TEX/generated-groundtruth.tex"

echo "== mutation run, on a copy of the corpus"
rm -rf "$W/corpus-rq4"; mkdir -p "$W/corpus-rq4"
for a in realworld alfresco bitwarden; do cp -cR "$W/corpus/$a" "$W/corpus-rq4/$a" 2>/dev/null || cp -R "$W/corpus/$a" "$W/corpus-rq4/$a"; done
export UIGRAPH_MAP="$CLI"
for p in realworld:. alfresco:projects/aca-content bitwarden:apps/web; do a=${p%%:*}; s=${p#*:}
  node mutate.mjs "$W/corpus-rq4/$a" "$W/corpus-rq4/$a/$s" --attribution --quota 8 --seed 20261021 --json "results-rq4/rq4-$a-attributed.json" > "$W/rq4-$a.log" 2>&1
  node mutate.mjs "$W/corpus-rq4/$a" "$W/corpus-rq4/$a/$s" --quota 8 --seed 20261021 --json "results-rq4/rq4base-$a.json" > "$W/rq4base-$a.log" 2>&1
done
node rq4-to-latex.mjs results-rq4/rq4-realworld-attributed.json results-rq4/rq4-alfresco-attributed.json results-rq4/rq4-bitwarden-attributed.json \
  results-rq4/rq4base-realworld.json results-rq4/rq4base-alfresco.json results-rq4/rq4base-bitwarden.json > "$W/rq4.tex" 2> results-rq4/rq4-diagnostics.txt
cp "$W/rq4.tex" "$TEX/generated-rq4.tex"
node to-plots.mjs --rq4-only results-rq4/rq4-realworld-attributed.json results-rq4/rq4-alfresco-attributed.json results-rq4/rq4-bitwarden-attributed.json > "$TEX/generated-plots-rq4.tex"
# results-must/mutation-sweep.json is written by mutation-sweep.mjs, which runs the adapter's suite once
# per mutant (about half an hour); run it first, at a committed tree, whenever the adapter has changed.
# sweep-to-latex.mjs refuses (and so ends this script) a sweep recorded on another packages/adapter-angular/src
# or another mutant list than HEAD's, so a sweep of rules that have since changed cannot be published.
node sweep-to-latex.mjs --tex "$TEX/generated-sweep.tex"
echo "== done $(date +%H:%M:%S)"
