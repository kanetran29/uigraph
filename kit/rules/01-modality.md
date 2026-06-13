# Modality: must / may / unknown

Every edge carries a modality — how certain its firing is.

- **must** — the transition always fires when the event occurs. Only a
  static-proven edge (literal navigation, no guard) or a runtime-confirmed
  observation may claim `must`.
- **may** — conditional or guarded: behind an `if`, a route guard, a success/error
  branch, an over-approximated non-literal target. Carries a symbolic `guard`
  string. Any edit you make through the overlay is **at most `may`** — `update_graph`
  downgrades a `must` you submit to `may`, because you are not a deterministic
  witness.
- **unknown** — the destination is computed at runtime (`history.push(someVar)`,
  `router.push(\`/x/${id}\`)`) and cannot be decided statically. Modeled as an edge
  into a `u_<screen>` sink. This is the verify frontier: drive it to learn where it
  actually lands.

When you plan, treat `may`/`unknown` as hypotheses to confirm, not as ground truth.
