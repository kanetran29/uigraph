#!/bin/bash
# Runs Rima et al.'s static stages (A1 extraction, A2 workflow enumeration) on every application of
# apps.txt, from their repository at the commit THEIRS_COMMIT records, and keeps each run's log and
# exit status. Their B stages (test generation and execution) are not run.
# Usage: run-theirs.sh <work dir> <softscanner_fa checkout>   (dependencies installed with --ignore-scripts)
set -u
export NODE_OPTIONS=--max-old-space-size=8192
W=$(cd "$1" && pwd); T=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd); OUT="$W/rima/theirs"
mkdir -p "$OUT"
DEVELOPER_DIR=/Library/Developer/CommandLineTools /usr/bin/git -C "$T" rev-parse HEAD > "$HERE/THEIRS_COMMIT"
grep -v '^#' "$HERE/apps.txt" | while read -r slug dir tsc; do
  [ -n "$slug" ] || continue
  o="$OUT/$slug"; rm -rf "$o"; mkdir -p "$o"
  start=$(date +%s)
  (cd "$T" && perl -e 'alarm shift; exec @ARGV' 1800 ./node_modules/.bin/tsx src/a1-cli.ts "$W/$dir" "$tsc" "$o" > "$o/a1.log" 2>&1); a1=$?
  a2=skip
  if [ $a1 -eq 0 ]; then (cd "$T" && perl -e 'alarm shift; exec @ARGV' 1800 ./node_modules/.bin/tsx src/a2-cli.ts "$o/json/a1-multigraph.json" "$o" > "$o/a2.log" 2>&1); a2=$?; fi
  echo "$slug a1=$a1 a2=$a2 seconds=$(( $(date +%s) - start ))" | tee -a "$OUT/status.txt"
done
