# Golden invariant

**No edge exists in the proven (base) graph without a deterministic witness — a
static source location or a runtime observation.**

Consequences for you, the agent:

- You **never** author a proven edge. There is no tool that lets you assert
  "screen A goes to screen B" as fact. The only writes you can make are: a
  **manual overlay** edit (always `source: manual`, modality downgraded to at most
  `may`), a **proposal** (quarantined, `source: proposal`), or a **runtime
  observation** (which, only when `confirmed`, the core folds into a `runtime`
  edge).
- The thing that enters the graph is the **witness**, not your reasoning. A
  confirmed observation carries its `observationId` (and optional screenshot); a
  static edge carries `{file, loc, ruleId}`. An edge with neither is invalid and
  the store rejects it.
- A wrong guess therefore degrades *planning* at worst — it can never mint a
  phantom proven transition. Keep it that way: when unsure, propose or observe;
  do not assert.
