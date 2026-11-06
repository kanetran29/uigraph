#!/usr/bin/env bash
# Builds thesis/thesis.pdf and prints its page count and the warnings worth fixing: overfull boxes,
# undefined references or macros, and floats too large for their page.
. "$(dirname "$0")/lib.sh"
cd "$H/thesis"
latexmk -pdf -interaction=nonstopmode -halt-on-error thesis.tex > "$SCRATCH/build.log" 2>&1 || { tail -30 "$SCRATCH/build.log"; echo "build FAILED; full log: thesis/thesis.log"; exit 1; }
pages=$(pdfinfo thesis.pdf 2>/dev/null | awk '/^Pages/ {print $2}')
echo "built thesis/thesis.pdf: ${pages:-?} pages, $(grep -c '^Overfull' thesis.log || true) overfull boxes, $(grep -c 'undefined' thesis.log || true) undefined references or macros, $(grep -c 'Float too large' thesis.log || true) floats too large for their page"
