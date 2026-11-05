#!/usr/bin/env bash
# The one command. Runs every regen/<name>.sh into a scratch directory, says for each generated file
# whether it matches the copy in thesis/ (comment lines aside), then builds the PDF.
#
# Usage: regen/all.sh [--write] [<name> ...]
#   --write   copy each regenerated file that differs into thesis/ before building
#   <name>    run only these scripts, e.g. regen/all.sh h2h rima (default: all of them)
# Exit code: 0 when every file matched (or was written) and the PDF built, 1 otherwise.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); TH=$(cd "$HERE/../thesis" && pwd)
WRITE=0; if [ "${1:-}" = --write ]; then WRITE=1; shift; fi
if [ $# -gt 0 ]; then names=("$@"); else
  names=(); for s in "$HERE"/*.sh; do n=$(basename "$s" .sh); case $n in all|lib|build) ;; *) names+=("$n");; esac; done
fi
T=$(mktemp -d); bad=0; diffs=()
for n in "${names[@]}"; do
  [ -f "$HERE/$n.sh" ] || { printf 'FAIL  %-22s no such script\n' "$n"; bad=1; continue; }
  f=generated-$n.tex
  OUT=$T bash "$HERE/$n.sh" > "$T/$n.log" 2>&1; rc=$?
  if [ $rc -eq 3 ]; then printf 'skip  %-22s %s\n' "$n" "$(tail -1 "$T/$n.log")"
  elif [ $rc -ne 0 ] || [ ! -s "$T/$f" ]; then printf 'FAIL  %-22s exit %s, log %s\n' "$n" "$rc" "$T/$n.log"; bad=1
  elif diff -q <(grep -v '^%' "$T/$f") <(grep -v '^%' "$TH/$f" 2>/dev/null) > /dev/null; then printf 'same  %s\n' "$n"
  elif [ $WRITE = 1 ]; then cp "$T/$f" "$TH/$f"; printf 'WROTE %s\n' "$n"
  else printf 'DIFF  %-22s diff %s thesis/%s\n' "$n" "$T/$f" "$f"; diffs+=("$n"); bad=1; fi
done
if [ $# -eq 0 ]; then
  for f in "$TH"/generated-*.tex; do n=$(basename "$f" .tex); n=${n#generated-}
    [ -f "$HERE/$n.sh" ] || { printf 'FAIL  %-22s thesis/%s has no regen script\n' "$n" "$(basename "$f")"; bad=1; }
  done
fi
[ ${#diffs[@]} -gt 0 ] && echo "differ from thesis/: ${diffs[*]} (rerun with --write to take the new values)"
bash "$HERE/build.sh" || bad=1
exit $bad
