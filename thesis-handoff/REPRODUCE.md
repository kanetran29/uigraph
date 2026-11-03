# Reproducing the thesis figures

Every number in the thesis comes from a generated file in `thesis/generated-*.tex`. Each file
names the script that wrote it on its first line and, where it depends on the extractor, the
extractor commit on its second. The provenance table in Chapter 4 (section Reproducibility,
`tab:provenance`) lists which tables are final and which are historical.

## Versions

| Item | Value |
| --- | --- |
| Extractor measured | `c42f2204802a32fe50f0aecfedc0faef1eefb61b` (tag `thesis-eval-final`; branch `thesis-final-2026-11`) |
| Demotion-rule sweep | `920e1aa`, same `packages/adapter-angular/src` tree as `c42f220` (`bdbe98b2`) |
| Harness | route-oracle 1.9.0, mutation harness 1.9.1, route-probe 1.1.0 |
| Generators | the commit that holds this file; `packages/` is unchanged since `c42f220` |
| Toolchain | node v24.14.0, pnpm 10.30.3, TeX Live with `latexmk` |

Do not use the tag `thesis-eval`. It points at `dd28cc2`, the first attribution commit, and does
not reproduce the figures.

Corpus pins (also in `route-oracle/corpus.json`):

| App | Repository | Commit | Mapped directory |
| --- | --- | --- | --- |
| realworld | gothinkster/angular-realworld-example-app | `dd99ed2` | `.` |
| alfresco | alfresco/alfresco-content-app | `b88d47f` | `projects/aca-content` |
| ghostfolio | ghostfolio/ghostfolio | `9884fa0` | `apps/client` |
| k8sdash | kubernetes/dashboard | `0ba796d` | `modules/web` |
| bitwarden | bitwarden/clients | `e40ce6f` | `apps/web` |
| mifos | openMF/web-app | `7f78179` | `.` |

## 1. Regenerate the tables from the recorded data (minutes)

No corpus checkout is needed. Run `pnpm install --frozen-lockfile` once at the repository root
(it provides `tsx` and `@ui-graph/core`), then from `thesis-handoff/route-oracle`:

```bash
set -e
npm ci
T=$(mktemp -d)
tar -xzf results-round2/final14.tgz -C "$T"      # two run-all.mjs runs at c42f220
tar -xzf results-ablation/ablation.tgz -C "$T"   # ablation.json and the six realworld level DBs

node to-latex.mjs "$T/final14/ctrl/results.json" > "$T/generated-tables.tex"
node compare.mjs "$T/final14/ctrl" "$T/final14/fin" --tex "$T/generated-before-after.tex"
node round2-to-latex.mjs "$T/final14/round2" > "$T/generated-round2.tex"
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$T/ablation/realworld.$l.uigraph.db"; done) \
  --tex "$T/generated-groundtruth.tex"
mkdir -p "$T/e1" "$T/e2"
pnpm -s exec tsx scope-ablation.mjs --corpus "$T/e1" --out "$T/e2" --from "$T/ablation/ablation.json" \
  --tex "$T/generated-ablation.tex"

R=results-rq4
node rq4-to-latex.mjs $R/rq4-{realworld,alfresco,bitwarden}-attributed.json $R/rq4base-{realworld,alfresco,bitwarden}.json \
  > "$T/generated-rq4.tex"
node to-plots.mjs --rq4-only $R/rq4-{realworld,alfresco,bitwarden}-attributed.json > "$T/generated-plots-rq4.tex"
node to-plots.mjs "$T/final14/ctrl/results.json" "$T/final14/fin/results.json" \
  $R/rq4-{realworld,alfresco,bitwarden}-attributed.json > "$T/generated-plots.tex"
node sweep-to-latex.mjs --tex "$T/generated-sweep.tex"
node must-witness.mjs --dir results-must/witness --tex "$T/generated-must-witness.tex"

for f in "$T"/generated-*.tex; do
  diff <(grep -v '^%' "$f") <(grep -v '^%' "../thesis/$(basename "$f")") > /dev/null \
    && echo "same  $(basename "$f")" || echo "DIFF  $(basename "$f")"
done
ls "$T"/generated-*.tex | wc -l   # expect 10
```

Only the `%` provenance lines should differ, since they name the commit the generator ran at.
These ten files, and `generated-probe.tex` below, were checked this way in a clean checkout on
2 and 3 November 2026. The census, census-base, expansion, must, guard-only, route-order and
callgraph tables need the corpus graphs and are regenerated only by section 2.

The runtime tables come from `thesis-handoff/route-probe/results/`:

```bash
cd ../route-probe
node to-latex.mjs --results results --before results-before --out "$T/generated-probe.tex"
```

## 2. Re-measure from the sources (hours)

Needs a work directory outside `/tmp` (macOS cleans it) holding `corpus/<app>` checkouts at the
pins above, each with its dependencies installed. Then, from the repository root:

Run from the commit that holds this file: its `packages/` is identical to `c42f220`, and its
harness is the one that wrote the committed tables.

```bash
pnpm install --frozen-lockfile
cd thesis-handoff/route-oracle && npm ci
./remeasure.sh <work>                 # maps the corpus, writes census, must tier, witness check,
                                      # guard-only, route order, call graph, ablation, ground truth, RQ4
./regen-round.sh <work> <out>         # two run-all.mjs runs, writes tables, before-after, round two, plots
```

Both scripts refuse to start if `packages/` has uncommitted changes. The mutation sweep (`mutation-sweep.mjs`) runs the adapter's test suite and is only
needed if `packages/adapter-angular/src` changes.

The runtime probe needs each application built in its development configuration; see
`route-probe/README.md`.

## 3. Build the PDF

```bash
cd thesis-handoff/thesis
latexmk -g -pdf -interaction=nonstopmode thesis.tex
```

## Historical tables

Three groups are printed as records of an earlier instrument: the first-round node audit
(`generated-node-audit.tex`; it records extractor `4505fd2a`, which is absent from the
repository), the earlier instrument and the round's own must tier (`generated-earlier.tex`, read
from git at `f17a302` and `7d109c7` by `earlier-instrument.mjs`), and the runtime scope and route
checks (`route-probe/results/`, made on 29 and 30 October; the route check records no extractor
commit). `generated-approx.tex` reads only the
application sources.
