# Provenance: static / manual / runtime / proposal

Every edge (and proposal) records who asserted it and how much to trust it.

- **static** — the deterministic extractor proved it from source. Carries
  `{file, loc, ruleId}`. The trusted base.
- **runtime** — a confirmed observation folded into the graph. Carries the
  `observationId` (+ optional screenshot). Equally trusted; this is "the observation
  entered the graph, not the guess."
- **manual** — a human (or you, via the overlay) edited it. Lives only in the
  **overlay**, never the base; downgraded to at most `may`. Survives re-maps as an
  overlay, but is not a witness.
- **proposal** — a quarantined lead (`source: proposal`) in its own sidecar/graph.
  **Never** enters the proven IR. A proposal becomes real only when a runtime
  observation confirms its transition — at which point the *observation* is what's
  recorded.

Trust order for planning: static ≈ runtime > manual > proposal. Never silently
promote across this order.
