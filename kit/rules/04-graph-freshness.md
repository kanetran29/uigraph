# Graph freshness: is the map current?

The graph is a **snapshot of the source at map time**, not a live view. Source files
change; the stored graph does not — until someone re-runs `uigraph map`. So before you
trust the graph — and **always at the start of a session** — call **`get_freshness`**.

It returns one of three states:

- **`fresh`** — no covered source file has changed since `mappedAt`. Proceed; the graph
  reflects the code.
- **`stale`** — at least one covered source file changed / was added / was removed. The
  `changed` / `added` / `removed` lists tell you which files moved. The graph may now be
  wrong, especially for those areas. **Do two things:**
  1. **Notify the user, in plain language** — e.g. *"Heads up: the UI graph is behind the
     code — N files changed since it was last mapped (`fileA`, `fileB`, …). Want me to
     re-map so the graph is current?"*
  2. Do **not** assert proven edges for the changed areas, and offer to run
     `uigraph map <dir> --adapter <name>` (a fast, static, key-free re-extract).
- **`unknown`** — uigraph can't recompute freshness: either nothing has been mapped yet, or
  the source dir that was mapped isn't on this machine (e.g. it was mapped on CI). Treat
  `unknown` as **could-be-stale** — never assume `fresh`. Tell the user and ask them to map
  the project locally.

Notes:

- Freshness uses a fixed source glob (`.ts/.tsx/.js/.jsx/.vue`, excluding
  `node_modules/.next/dist/build/coverage/.git`), so it can **over-report** `stale` on a
  test or config tweak. That's intentional: a false `stale` costs only a cheap re-map, while
  a false `fresh` would have you trust a wrong graph.
- **You decide; uigraph never acts on its own.** `get_freshness` (and the `uigraph status`
  CLI) only *report*. uigraph holds no API key and runs no model — re-mapping and notifying
  are actions **you** take on the user's behalf. The re-map itself (`uigraph map`) is pure
  static analysis: no model call, no key, no cost.

## After you re-map: report what changed

A re-map snapshots the prior graph, so once you've re-mapped, call **`diff_since_last`** to
see what the code change actually did to the proven UI graph — added/removed screens and
transitions, and which edge fields changed — plus the two map timestamps. Use it to tell the
user in plain language, e.g. *"Re-mapped: that change added a `Checkout → Confirmation`
transition and removed the `Promo` screen."* It needs no arguments (the previous base lives
in the workspace db, not a file). Keep `diff_since_last` distinct from `get_freshness`:
freshness = *source files changed since the map*; diff-since-last = *the graph delta between
two maps*. States: `ok` (a delta), `no-prior` (only one map yet), `no-current` (never mapped).
This is **base-graph only** — it reports what the code did, never overlay/proposal/plan edits.
