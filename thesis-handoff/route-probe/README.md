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

## The licence the round-two tables read

`round2-to-latex.mjs` takes an optional `--probe <results-dir>`. The dead-link census suppresses
every candidate from an application whose route set the extractor declared a lower bound. An
application this harness has measured against the framework's own configuration, and found to be
missing no address the framework mounts, is exempt from that suppression: the note says the set
might be short, and the measurement says it is not. Without the flag no application is exempt,
which is how the script behaved before this harness existed.

## What it does not establish

It reads route configuration, not rendered pages, so an address behind a guard that always
refuses counts as mounted. That makes the "mounted" set larger than the set a visitor can reach,
so a finding of an invented address is sound and a finding of none is weaker than it looks.

The extractor's spread note is raised from any array its shape test accepts as a route table. No
array in this corpus is a false positive -- every note comes from a `.routes.ts` or
`-routing.module.ts` -- but a menu or form config built with a spread would raise one, and that
note would caveat an application's whole dead-link census for nothing.
