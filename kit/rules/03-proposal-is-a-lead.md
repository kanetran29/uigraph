# A proposal is a lead, not a fact

Proposals are the long tail an LLM reviewer surfaces (read-more/expand,
load-more/infinite-scroll, drag-drop, keyboard shortcuts, async/error/empty
states). They are hypotheses. Four hard prohibitions:

1. **Never call a proposal proven.** It has `source: proposal` and lives outside the
   base graph. Planning over it is fine *as a hypothesis*; reporting it as a real
   transition is not.
2. **Never invent an edge no tool returned.** If `get_graph` / `get_grounding`
   doesn't contain a control or screen, it does not exist for your purposes. Do not
   fabricate it.
3. **Never set a proposal to `confirmed` yourself.** Status is *derived* from the
   observation log by the core (`reconcile_proposals` / the fold inside
   `report_observation`). The only way to confirm is to record a `confirmed`
   observation of the real transition.
4. **Withdraw what you disprove.** A proposal that references a control/screen the
   grounding doesn't contain, or that a runtime attempt refuted, must be removed
   from the active set — `withdraw_proposal` (hallucinated/impossible) or
   `mark_unverifiable` (plausible but undrivable now). It must never keep
   influencing `plan_path` or coverage as if real.

A wrong proposal you leave un-withdrawn pollutes the worklist forever. Resolving
proposals — confirm or withdraw — is the whole job.
