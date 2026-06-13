# The proposal reconciliation loop

Your usual job: drive every uncertain transition and every quarantined proposal to
resolution — confirm what's real (it archives + becomes a witnessed edge), withdraw
what's hallucinated, park what's genuinely undrivable — until `get_loop_status`
reports `loopDone`. The core guarantees soundness; you supply the driving.

## The loop

```
loop:
  s = get_loop_status()
  if s.loopDone: STOP            # 100%: every uncertain edge witnessed, every proposal resolved
  work = next_to_verify(limit = N)
  progressed = false
  for target in work:
    plan = plan_path(target.from, target.to)
    if not plan:                          # no static route to set the target up
      alt = retry with allow = [must, may, unknown]  OR  a multi-hop route via another screen
      if still none after R tries:
        if target.kind == 'proposal': mark_unverifiable(target.proposalId, reason)
        continue
    gen_spec(target.from, target.to, baseUrl)   # or drive Playwright directly
    drive the running app; observe the real outcome
    report_observation(from, to, event, outcome, proposalId, screenshot)
    #   confirmed -> core folds a runtime edge AND archives the proposal 'confirmed'
    #   refuted   -> core withdraws the proposal 'rejected' (no edge added)
    progressed = true
  # judgment call: a proposal that references a control/screen get_grounding does NOT
  # contain is hallucinated — withdraw_proposal(id, reason) without even driving it.
  if not progressed:            # no-progress guard — avoid spinning forever
    mark_unverifiable each stuck target with a reason
```

## Termination

Each iteration removes at least one proposal from `proposed` — via a confirmed or
refuted observation, or via the no-progress guard (`mark_unverifiable`). The
`proposed` set is finite and strictly decreasing, and resolved proposals leave the
active worklist, so `loopDone` is reached. Never loop on a target you've already
tried and parked.

## Withdraw-on-hallucination (the self-healing part)

A proposal is hallucinated when, after looking, it cannot be true:

- it names a control or screen that `get_grounding` / `get_graph` does not contain → `withdraw_proposal`.
- a runtime attempt refuted it → already auto-`rejected` by `report_observation`; nothing more to do.
- it's plausible but you cannot reach/drive it now (feature flag, external dependency, auth you lack) → `mark_unverifiable`, not withdraw.

A withdrawn or unverifiable proposal vanishes from `get_proposal_graph`,
`next_to_verify`, and planning — but never from the audit trail (`get_proposals`
with a `status` filter still lists it with its `reason`). The proven graph is never
touched by any of this.

## Worked sketch (sample app)

1. `get_loop_status` → `loopDone: false`, `worklistSize: 3`, `resolution.openCount: 2`.
2. `next_to_verify` → `[{kind:'edge', from:'n_products', to:'n_products_id', modality:'may'}, {kind:'proposal', id:'p_modal', from:'n_checkout', to:'<modal>'}, ...]`.
3. Verify the may-edge: `gen_spec(n_products, n_products_id)`, drive, `report_observation(confirmed)` → runtime edge minted.
4. Proposal `p_modal` claims a confirm dialog; `describe_screen(n_checkout)` shows the button → drive it; dialog appears → `report_observation(n_checkout, m_n_checkout_0, 'click', 'confirmed', 'p_modal')` → archived.
5. Proposal `p_dragdrop` names a control no grounding shows → `withdraw_proposal('p_dragdrop', 'no draggable control on this screen')`.
6. `get_loop_status` → `loopDone: true`. Stop.
