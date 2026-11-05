#!/bin/bash
# Fetches Rima et al.'s seven subjects at the commits of subjects.txt, maps each at the four
# attribution levels of PREREGISTRATION.txt, exports the graphs and soundiness ledgers into
# rima/graphs, runs the independent route parser on each (validity check V2), and scores them.
#
# Usage: map.sh <work dir> <softscanner_fa checkout at f33003f>
# The work dir must not be under /tmp (macOS prunes it; see route-oracle/remeasure.sh).
set -euo pipefail
W=$(cd "$1" && pwd); GT=$(cd "$2/docs/analysis/phase-b/gt" && pwd)
case "$W" in /tmp/*|/private/tmp/*) echo "the work dir must not be under /tmp" >&2; exit 2;; esac
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
if [ -n "$(git -C "$REPO" status --porcelain -- packages)" ]; then echo "packages/ has uncommitted changes; commit before measuring" >&2; exit 2; fi
CLI="pnpm -s -C $REPO/packages/cli run uigraph --"
export NODE_OPTIONS=--max-old-space-size=8192
# Writes one document of a uigraph database, gzipped.
doc() { node -e "const {DatabaseSync}=require('node:sqlite');const z=require('zlib');const r=new DatabaseSync(process.argv[1]).prepare('select json from docs where key=?').get(process.argv[2]);require('fs').writeFileSync(process.argv[3],z.gzipSync(r.json))" "$1" "$2" "$3"; }
mkdir -p "$W/src" "$W/db" "$W/routes" "$HERE/graphs"
echo "extractor $(git -C "$REPO" log -1 --format=%h -- packages)" > "$HERE/graphs/EXTRACTOR"

grep -v '^#' "$HERE/subjects.txt" | while read -r slug repo sha sub; do
  [ -n "$slug" ] || continue
  d="$W/src/${repo//\//__}"
  if [ "$(git -C "$d" rev-parse HEAD 2>/dev/null)" != "$sha" ]; then
    rm -rf "$d"; mkdir -p "$d"
    git -C "$d" init -q && git -C "$d" remote add origin "https://github.com/$repo.git"
    git -C "$d" fetch -q --depth 1 origin "$sha" && git -C "$d" -c advice.detachedHead=false checkout -q FETCH_HEAD
  fi
  app="$d/$sub"
  for l in noattr rooted outlet full; do
    db="$W/db/$slug.$l.db"; rm -f "$db"
    case $l in
      noattr) $CLI map "$app" --adapter angular --out "$db" > "$W/db/$slug.$l.log" 2>&1 ;;
      full) $CLI map "$app" --adapter angular --attribution --out "$db" > "$W/db/$slug.$l.log" 2>&1 ;;
      *) UIGRAPH_SCOPE_LAYERS=$l $CLI map "$app" --adapter angular --attribution --out "$db" > "$W/db/$slug.$l.log" 2>&1 ;;
    esac
    doc "$db" graph "$HERE/graphs/$slug.$l.json.gz"
  done
  doc "$W/db/$slug.full.db" soundiness "$HERE/graphs/$slug.soundiness.json.gz"
  node "$REPO/thesis-handoff/route-oracle/index.mjs" "$app" "$W/db/$slug.full.db" --json "$W/routes/$slug.json" > "$W/routes/$slug.txt" 2>&1 || true
  echo "$slug mapped"
done

node "$HERE/score.mjs" --gt "$GT" --graphs "$HERE/graphs" --subjects "$HERE/subjects.txt" \
  --json "$HERE/results.json" --tex "$REPO/thesis-handoff/thesis/generated-rima.tex"
