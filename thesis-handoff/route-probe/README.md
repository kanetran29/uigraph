# route-probe

A third reading of each corpus application's route set, taken from the running framework rather
than from its sources. The extractor and `route-oracle/` both parse the route files; where they
share a misreading they agree, and the agreement means nothing. This harness asks Angular.

## What it does

`probe.mjs` serves one built application over a local static server with the single-page fallback
a router needs, loads it in headless Chromium, finds the live `Router` through Angular's debug
surface and reads its route configuration. `in-page.js` expands every lazily loaded subtree by
calling the application's own `loadChildren` and taking the routes out of whatever it resolves
to. Nothing parses a route file.

`compare-probe.mjs` compares that set with the extractor's graph (from `uigraph.db`) and the
oracle's declared set, and reports addresses minted but not mounted, mounted but not minted, and
the extractor's own statement about whether its route set is complete.

## Reproducing

Each application must be built in its **development** configuration: Angular removes the debug
surface this harness reads when an application calls `enableProdMode`. `apps.json` records the
build output path of each one and every adaptation its build needed.

```bash
node run-all.mjs --dist-root <built-apps> --corpus-root <checkouts> --oracle <oracle-out> --out results
node to-latex.mjs --results results --before results-before --out ../thesis/generated-probe.tex
```

`results-before/<slug>.before.C.json` is the route oracle's output from before the round this
harness opened, kept so the chapter's statement about what the static readers used to declare is
regenerated rather than remembered.
