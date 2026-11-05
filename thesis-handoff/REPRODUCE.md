# Reproducing the thesis figures

Every number in the thesis comes from a generated file in `thesis/generated-*.tex`. Each file
names the script that wrote it on its first line and, where it depends on the extractor, the
extractor commit on its second. The versions are stated in Chapter 4's Reproducibility subsection.

## Versions

| Item | Value |
| --- | --- |
| Extractor measured | `f26a302`; `packages/` last changed at `2aac284` (the three repairs the end-to-end check exposed, Table `tab:repairs`) |
| Demotion-rule sweep, may-reason census | `f26a302`, 174 mutants; graphs with the `UIGRAPH_MAY_REASONS` switch off identical (`results-may-reasons/equivalence.json`) |
| Previously evaluated extractor | `c42f220` (tag `thesis-eval-final`): its mifos graph is kept as `e2e-nav/results/mifos/graph-unfixed.json.gz` for the figure before the repairs |
| Harness | route-oracle 1.10.0, mutation harness 1.9.1, route-probe 1.1.0 |
| Generators | the commit that holds this file; `packages/` is unchanged since `2aac284` |
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
tar -xzf results-round2/final15.tgz -C "$T"      # two run-all.mjs runs at f26a302
tar -xzf results-ablation/ablation.tgz -C "$T"   # ablation.json and the six realworld level DBs

node to-latex.mjs "$T/final15/ctrl/results.json" > "$T/generated-tables.tex"
node compare.mjs "$T/final15/ctrl" "$T/final15/fin" --tex "$T/generated-before-after.tex"
node round2-to-latex.mjs "$T/final15/round2" > "$T/generated-round2.tex"
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/realworld.json \
  $(for l in owned nesting rooted outlet full class; do echo --db $l="$T/ablation/realworld.$l.uigraph.db"; done) \
  --tex "$T/generated-groundtruth.tex"
mkdir -p "$T/e1" "$T/e2"
pnpm -s exec tsx scope-ablation.mjs --corpus "$T/e1" --out "$T/e2" --from "$T/ablation/ablation.json" \
  --tex "$T/generated-ablation.tex"

R=results-rq4
node rq4-to-latex.mjs $R/rq4-{realworld,alfresco,bitwarden}-attributed.json $R/rq4base-{realworld,alfresco,bitwarden}.json \
  $R/rq4earlier-{realworld,alfresco,bitwarden}.json > "$T/generated-rq4.tex"
node to-plots.mjs --rq4-only $R/rq4-{realworld,alfresco,bitwarden}-attributed.json > "$T/generated-plots-rq4.tex"
node to-plots.mjs "$T/final15/ctrl/results.json" "$T/final15/fin/results.json" \
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
2 and 3 November 2026, and the ten again from `final15.tgz` on 5 November. The census, census-base, expansion, must, guard-only, route-order and
callgraph tables need the corpus graphs and are regenerated only by section 2.

The runtime tables come from `thesis-handoff/route-probe/results/`:

```bash
cd ../route-probe
node to-latex.mjs --results results --before results-before --out "$T/generated-probe.tex"
```

## 2. Re-measure from the sources (hours)

Needs a work directory outside `/tmp` (macOS cleans it) holding `corpus/<app>` checkouts at the
pins above, each with its dependencies installed. Then, from the repository root:

Run from the commit that holds this file: its `packages/` is identical to `2aac284`, and its
harness is the one that wrote the committed tables.

```bash
pnpm install --frozen-lockfile
cd thesis-handoff/route-oracle && npm ci
./remeasure.sh <work>                 # maps the corpus, writes census, must tier, witness check,
                                      # guard-only, route order, call graph, ablation, ground truth, RQ4
./regen-round.sh <work> <out>         # two run-all.mjs runs, writes tables, before-after, round two, plots
./post-remeasure.sh <work>            # e2e graphs and score, alfresco levels, both references, ceiling
```

Both scripts refuse to start if `packages/` has uncommitted changes. The mutation sweep (`mutation-sweep.mjs`, then
`sweep-to-latex.mjs`) runs the adapter's test suite once per mutant with `--maxWorkers=2` and is only needed if
`packages/adapter-angular/src` changes. `remeasure.sh` ends in `sweep-to-latex.mjs`, which refuses a sweep recorded on
other adapter sources; run the sweep and then `sweep-to-latex.mjs` again.

The runtime probe needs each application built in its development configuration; see
`route-probe/README.md`.

The end-to-end navigation check (`e2e-nav/`) is scored from its archived logs and the
corpus graphs, both under `e2e-nav/results/<app>/`. `route-oracle/post-remeasure.sh <work>`, run after
`remeasure.sh`, writes them, scores both structural references and writes the static ceiling: `graph.json.gz` and `soundiness.json.gz` are the `graph` and `soundiness`
documents of `<work>/corpus/<app>/uigraph.db`, gzipped. The comparison graphs beside them are scored on the same
pairs: `graph-noattr.json.gz` (mapped without `--attribution` by `remeasure.sh`), `graph-rooted.json.gz` and
`graph-outlet.json.gz` (realworld: those levels from `results-ablation/ablation.tgz`; mifos:
`uigraph map <corpus>/mifos --adapter angular --attribution` with `UIGRAPH_SCOPE_LAYERS=rooted` or `outlet`, made for
Section `sec:res-earlier` after the suites were scored), and `graph-unfixed.json.gz` (the graph at `c42f220`, before the
repairs the check exposed). `node --test score.test.mjs` checks the scorer.

```bash
cd thesis-handoff/e2e-nav
node score.mjs --app realworld=results/realworld --app mifos=results/mifos \
  --tex ../thesis/generated-e2e.tex
```

To re-run the suites: copy `nav-trace.ts` into the application's `src/app/`, call
`startNavTrace(router)` once at start-up (the applied change is `results/<app>/instrumentation.diff`),
run `collector.mjs` on 127.0.0.1:4599, and run the application's own Playwright suite with one
worker. Realworld (`dd99ed2`, submodule `ffbd690`) uses `--grep-invert @security` against the
public backend, which is not pinned. Mifos (`7f78179`) needs `docker compose -f
docker-compose.e2e.yml up -d db fineract` and the projects `setup` and `chromium`; the exact
commands and environment are in `results/mifos/summary.txt`. The rules were fixed beforehand in
`PREREGISTRATION.txt`.

The may-reason census (`generated-may-reasons.tex`) is a step of `remeasure.sh` ("why the may tier is may"): it maps
the corpus again with `UIGRAPH_MAY_REASONS=1`, a measurement switch that adds `reasons` to may witnesses and changes
nothing else, checks that the graphs with `reasons` removed equal the corpus graphs, and runs `may-reasons.mjs`.
Run it with bash: the `$APPS` loops rely on word splitting, which zsh does not do.

The second structural reference (`generated-groundtruth-alfresco.tex`; protocol `route-oracle/ground-truth/ALFRESCO-PROTOCOL.txt`):
map `projects/aca-content` of the alfresco pin with `uigraph map <dir> --adapter angular --attribution --out <level>.db` at
`f26a302`, with `UIGRAPH_SCOPE_LAYERS=<level>` for each of owned, nesting, rooted, outlet and class (none for full), then

```bash
cd thesis-handoff/route-oracle
pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/alfresco.json --prefix GTAlf \
  $(for l in owned nesting rooted outlet full class; do echo --db $l=<dir>/$l.db; done) \
  --tex ../thesis/generated-groundtruth-alfresco.tex --json <dir>/gt-alfresco.json
```

The realworld reference is scored the same way from the ablation DBs, with `--json <dir>/gt-realworld.json`.

The earlier-work restrictions (`generated-earlier-work.tex`):

```bash
cd thesis-handoff/route-oracle
node earlier-work.mjs --dir <final15>/fin --apps realworld,alfresco,ghostfolio,k8sdash,bitwarden,mifos \
  --tex ../thesis/generated-earlier-work.tex
```

The static ceiling (`generated-ceiling.tex`, Table `tab:ceiling`) joins the author's class for every remaining miss,
recorded in `route-oracle/ceiling-classes.json`, to the two scorers' output; it refuses a miss without a class and a
class without a miss:

```bash
cd thesis-handoff/route-oracle
node ceiling.mjs --classes ceiling-classes.json \
  --gt realworld=<dir>/gt-realworld.json --gt alfresco=<dir>/gt-alfresco.json \
  --e2e realworld=../e2e-nav/results/realworld --e2e mifos=../e2e-nav/results/mifos \
  --tex ../thesis/generated-ceiling.tex
```

The held-out check (`heldout/`, preregistered in `heldout/PREREGISTRATION.txt`, two rounds and a sensitivity case) is
not reported in the thesis (Addendum F); its scripts and results stay in `heldout/` and are run as `heldout/heldout.sh`
and `heldout/heldout-to-latex.mjs` describe.

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
