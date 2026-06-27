# Deciding what to do next

Three reads tell you the whole state and the next action.

- **get_loop_status** — start here. `loopDone` true ⇒ stop: every *known* uncertain
  edge is resolved (runtime-witnessed or parked) AND every proposal is resolved. This
  is **all known work done, not "the app fully mapped"** — undiscovered cases and the
  frontier of known-unknowns are outside this signal. Otherwise `worklistSize` and
  `resolution.openCount` tell you how much is left.
- **get_coverage** — `verified/total` (verified = `source:runtime`) and the
  `unverified[]` list. Coverage only counts runtime witnesses; static-but-undriven
  edges count against the ratio by design. The denominator is the *known* edge set, so
  the ratio means "of the edges we know, how many are runtime-confirmed" — never "every
  real transition exists." Keep `verified%` (runtime-confirmed) distinct from
  `accounted%` (resolved by any means, parking included): a parked edge is accounted
  for but **not** verified.
- **next_to_verify** — the actual worklist, already ranked: `unknown` (priority 3,
  dynamic targets) > `may` (2, conditional) > proposals (1). Pairs already
  runtime-witnessed and proven `must`-static edges are skipped.

Decision rule each iteration:
1. `get_loop_status`; if `loopDone`, stop.
2. Take the top of `next_to_verify`.
3. Try to verify it (see verify-flow). Confirmed → archived automatically; refuted →
   withdrawn automatically.
4. If a target can't be reached or driven after a couple of tries, `mark_unverifiable`
   it (with a reason) so the worklist keeps shrinking.

The worklist shrinks monotonically (resolved proposals leave the active graph), so
this terminates.
