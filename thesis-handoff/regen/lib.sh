# Shared by the regen/ scripts: paths, where a script writes its file, and helpers for the run
# archives and the work directory. Sourced by each script, not run on its own.
set -euo pipefail
H=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO=$(cd "$H/.." && pwd)
RO=$H/route-oracle
OUT=${OUT:-$H/thesis}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
WORK=${UIGRAPH_WORK:-$HOME/personal/uigraph-work}
TSX=$REPO/node_modules/.bin/tsx
APPS="realworld:. alfresco:projects/aca-content ghostfolio:apps/client k8sdash:modules/web bitwarden:apps/web mifos:."
RIMA_GT=$WORK/rima/softscanner_fa/docs/analysis/phase-b/gt
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
export NODE_OPTIONS=--max-old-space-size=8192
# This Mac's Xcode update broke xcrun, so git needs the Command Line Tools.
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Library/Developer/CommandLineTools ]; then export DEVELOPER_DIR=/Library/Developer/CommandLineTools; fi

# Unpacks a committed run archive into a cache (again only when the archive is newer) and prints
# the cache directory.
unpack() {
  local c="${TMPDIR:-/tmp}/thesis-regen-cache/$(basename "$1" .tgz)"
  if [ ! -d "$c" ] || [ "$1" -nt "$c" ]; then rm -rf "$c"; mkdir -p "$c"; tar -xzf "$1" -C "$c"; fi
  echo "$c"
}

# Ends the script with exit code 3 (skipped, not failed) when the work directory lacks a path.
need() {
  local p
  for p in "$@"; do [ -e "$p" ] || { echo "skipped: needs $p (set UIGRAPH_WORK to the work directory)"; exit 3; }; done
}

# The runs with and without attribution that the chapter-5 tables print (final16.tgz).
final16() { echo "$(unpack "$RO/results-round2/final16.tgz")/final16"; }

# The realworld graphs at each attribution level and the ablation result (ablation.tgz).
ablation() { echo "$(unpack "$RO/results-ablation/ablation.tgz")/ablation"; }
