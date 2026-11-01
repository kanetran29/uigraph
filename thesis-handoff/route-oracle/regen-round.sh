#!/bin/bash
# Re-run the pipeline of the round-two tables of Chapter 5 at the current commit, and regenerate
# the four tables it feeds: generated-tables.tex (the loss ledger, from the run without
# attribution), generated-before-after.tex (the two runs joined construct by construct),
# generated-round2.tex (the round-two tables) and generated-plots.tex (the figures).
#
# remeasure.sh re-measures what depends on the graphs the extractor emits; this re-measures what
# depends on the route oracle's and the loss breakdown's reading of them, which run-all.mjs
# produces. Both start from the same work dir.
#
# Usage: regen-round.sh <work dir holding corpus/<app>> <out dir>
# The work dir must not be under /tmp, for the reason remeasure.sh gives. It runs the extractor
# of this checkout over the corpus in place, so give it a work dir nothing else is reading, and it
# writes the maps it makes into that corpus (the last one is the attributed map, which
# diagnose-attribution.mjs reads). The out dir receives ctrl/ and fin/ (one run-all.mjs run each),
# round2/ (the files round2-to-latex.mjs reads) and the generated tables before they are copied
# into thesis-handoff/thesis. It takes a long time: two runs over the six applications.
#
# The ctrl run is expected to exit non-zero: the extractor without attribution leaves constructs
# UNKNOWN, which is the premise of the round, and unexplained.mjs exits 1 for it. So the runs are
# not chained, and this script is not run under set -e; the fin run is the one that must exit 0,
# and nothing is copied into the thesis unless it did. To keep what a regeneration read, archive
# the out dir as results-round2/final7.tgz does.
set -u
if [ $# -ne 2 ]; then echo "usage: regen-round.sh <work dir holding corpus/<app>> <out dir>" >&2; exit 2; fi
W=$(cd "$1" && pwd) || exit 2
case "$W" in /tmp/*|/private/tmp/*) echo "the work dir must not be under /tmp" >&2; exit 2;; esac
mkdir -p "$2" || exit 2
OUT=$(cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd); TEX="$HERE/../thesis"
if [ -n "$(git -C "$REPO" status --porcelain -- packages)" ]; then echo "packages/ has uncommitted changes; commit before measuring" >&2; exit 2; fi
export NODE_OPTIONS=--max-old-space-size=8192
cd "$HERE" || exit 2

RUN=(node run-all.mjs --work "$W" --skip-clone --extractor-dir "$REPO" --no-mutation)
# results.json is written last, so a stale one would pass for the run that has not happened.
rm -f "$OUT/ctrl/results.json" "$OUT/fin/results.json"

echo "== ctrl: the extractor $(git -C "$REPO" rev-parse --short HEAD) without attribution"
"${RUN[@]}" --label ctrl --out "$OUT/ctrl"
echo "== ctrl exited $? (non-zero is expected)"
[ -f "$OUT/ctrl/results.json" ] || { echo "the ctrl run wrote no results.json, so it did not finish" >&2; exit 1; }

echo "== fin: the same extractor with attribution"
"${RUN[@]}" --attribution --label fin --out "$OUT/fin" || { echo "the fin run failed ($?); do not publish figures from it" >&2; exit 1; }
[ -f "$OUT/fin/results.json" ] || { echo "the fin run wrote no results.json" >&2; exit 1; }

# The reason every construct attribution leaves lost stays lost, which compare.mjs prints as
# TabRemaining. run-all.mjs does not write it, and a stale one describes an earlier run, so it is
# written again here from the fin map that is now in the corpus, for every application.
echo "== why the remaining attribution losses stay lost"
mkdir -p "$OUT/fin/raw"
APPS=$(node -e "for (const r of require('./corpus.json').repos) console.log(r.slug + ' ' + r.appDir)")
[ -n "$APPS" ] || { echo "corpus.json names no application" >&2; exit 1; }
while read -r slug appDir; do
  app="$W/corpus/$slug/$appDir"
  pnpm -s exec tsx diagnose-attribution.mjs "$app" "$OUT/fin/$slug.fin.L.json" "$OUT/ctrl/$slug.ctrl.L.json" "$app/uigraph.db" "$OUT/fin/raw/$slug.diag.json" > /dev/null || { echo "diagnose-attribution.mjs failed for $slug" >&2; exit 1; }
done <<< "$APPS"

# round2-to-latex.mjs reads, per application, two files from the run without attribution and five
# from the run with it, all in one directory.
echo "== round2"
rm -rf "$OUT/round2"; mkdir -p "$OUT/round2"
while read -r slug _; do
  for k in C L; do cp "$OUT/ctrl/$slug.ctrl.$k.json" "$OUT/round2/" || exit 1; done
  for k in B C L why notes; do cp "$OUT/fin/$slug.fin.$k.json" "$OUT/round2/" || exit 1; done
done <<< "$APPS"

echo "== tables"
STAGE="$OUT/tex"; rm -rf "$STAGE"; mkdir -p "$STAGE"
node to-latex.mjs "$OUT/ctrl/results.json" > "$STAGE/generated-tables.tex" || exit 1
node compare.mjs "$OUT/ctrl" "$OUT/fin" --tex "$STAGE/generated-before-after.tex" > "$OUT/compare.log" || { echo "compare.mjs refused; see $OUT/compare.log" >&2; exit 1; }
node round2-to-latex.mjs "$OUT/round2" > "$STAGE/generated-round2.tex" || exit 1
node to-plots.mjs "$OUT/ctrl/results.json" "$OUT/fin/results.json" results-rq4/rq4-realworld-attributed.json results-rq4/rq4-alfresco-attributed.json results-rq4/rq4-bitwarden-attributed.json > "$STAGE/generated-plots.tex" || exit 1

# Only now, when every generator has finished, do the tables in the thesis change.
for f in generated-tables generated-before-after generated-round2 generated-plots; do cp "$STAGE/$f.tex" "$TEX/$f.tex" || exit 1; done
echo "== done $(date +%H:%M:%S): $OUT holds the runs; the four tables are in $TEX"
