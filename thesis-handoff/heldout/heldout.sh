#!/bin/bash
# Measures the frozen extractor on the held-out applications of heldout/PREREGISTRATION.txt, with the same scripts the
# corpus figures come from: map with and without attribution, the independent route parser (index.mjs), the witness
# check and the loss breakdown. Nothing here repairs anything; a failing step is recorded and the run goes on.
#
# Usage: heldout.sh <work dir> <extractor checkout> [<apps file> <results dir>]
#   <work dir>            where the applications are fetched (never under /tmp)
#   <extractor checkout>  a clean checkout whose packages/ equals c42f220 (checked below)
#   <apps file>           slug, repository, SHA and app directory per line (default apps.txt, the first round)
#   <results dir>         where the result files go (default results)
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd)
W=${1:?work dir}; X=$(cd "${2:?extractor checkout}" && pwd)
case "$W" in /tmp/*|/private/tmp/*) echo "the work dir must not be under /tmp" >&2; exit 2;; esac
if [ -n "$(git -C "$X" status --porcelain -- packages)" ] || [ -n "$(git -C "$X" diff --stat c42f220 -- packages)" ]; then
  echo "$X/packages is not c42f220" >&2; exit 2
fi
RO="$H/../route-oracle"; APPS=${3:-$H/apps.txt}; OUT=${4:-$H/results}; mkdir -p "$W" "$OUT"
CLI="pnpm -s -C $X/packages/cli run uigraph --"
export NODE_OPTIONS=--max-old-space-size=8192
echo "extractor $(git -C "$X" rev-parse --short HEAD) (packages = c42f220)" > "$OUT/provenance.txt"
while read -r slug repo sha sub; do
  D="$W/$slug"
  if [ "$(git -C "$D" rev-parse HEAD 2>/dev/null)" != "$sha" ]; then
    rm -rf "$D"; mkdir -p "$D"
    git -C "$D" init -q && git -C "$D" remote add origin "https://github.com/$repo.git" &&
      git -C "$D" fetch -q --depth 1 origin "$sha" && git -C "$D" -c advice.detachedHead=false checkout -q FETCH_HEAD
  fi
  A="$D/$sub"
  echo "$slug $repo $sha $sub" >> "$OUT/provenance.txt"
  for step in attr noattr; do
    t0=$(date +%s)
    if [ $step = attr ]; then rm -f "$A/uigraph.db"; $CLI map "$A" --adapter angular --attribution > "$OUT/$slug.map.log" 2>&1
    else rm -f "$W/$slug.noattr.db"; $CLI map "$A" --adapter angular --out "$W/$slug.noattr.db" > "$OUT/$slug.map0.log" 2>&1; fi
    echo "$slug map-$step exit=$? seconds=$(( $(date +%s) - t0 ))" >> "$OUT/provenance.txt"
  done
  node "$RO/index.mjs" "$A" "$A/uigraph.db" --json "$OUT/$slug.C.json" > "$OUT/$slug.C.log" 2>&1; echo "$slug index exit=$?" >> "$OUT/provenance.txt"
  node "$RO/witness-check.mjs" "$A" "$A/uigraph.db" --routes "$OUT/$slug.C.json" --json "$OUT/$slug.B.json" > "$OUT/$slug.B.log" 2>&1; echo "$slug witness exit=$?" >> "$OUT/provenance.txt"
  node "$RO/loss-breakdown.mjs" "$A" "$A/uigraph.db" --routes "$OUT/$slug.C.json" --json "$OUT/$slug.L.json" > "$OUT/$slug.L.log" 2>&1; echo "$slug loss exit=$?" >> "$OUT/provenance.txt"
  node "$RO/loss-breakdown.mjs" "$A" "$W/$slug.noattr.db" --routes "$OUT/$slug.C.json" --json "$OUT/$slug.L0.json" > "$OUT/$slug.L0.log" 2>&1; echo "$slug loss-noattr exit=$?" >> "$OUT/provenance.txt"
  cp "$A/uigraph.db" "$W/$slug.attr.db" 2>/dev/null
done < "$APPS"
cat "$OUT/provenance.txt"
