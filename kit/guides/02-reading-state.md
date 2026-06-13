# Deciding what to do next

Three reads tell you the whole state and the next action.

- **get_loop_status** — start here. `loopDone` true ⇒ stop (100%: every uncertain
  edge runtime-witnessed AND every proposal resolved). Otherwise `worklistSize` and
  `resolution.openCount` tell you how much is left.
- **get_coverage** — `verified/total` (verified = `source:runtime`) and the
  `unverified[]` list. Coverage only counts runtime witnesses; static-but-undriven
  edges count against the ratio by design. The denominator is the *known* edge set —
  100% means "every edge we know is confirmed," not "every real transition exists."
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
