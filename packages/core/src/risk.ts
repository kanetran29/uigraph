// Edge risk classification (red-team Tier-1 #2). A pure, framework-agnostic
// heuristic that flags destructive / non-undoable effects from an edge's effect
// string, so an agent can gate irreversible actions (require confirmation)
// before traversal. Deliberately a small keyword check, not a parser: it errs
// toward flagging the obviously dangerous verbs and stays silent otherwise.

/** Destructive verbs whose presence in an effect marks an edge irreversible. */
const DESTRUCTIVE = ['delete', 'remove', 'pay', 'purchase', 'submit-order', 'logout', 'reset']

/**
 * Classify whether an effect string denotes an irreversible action. Returns true
 * when the effect mentions a destructive verb as a whole token, false for a
 * null/empty/benign effect. The boundary on each side is "not a lowercase
 * letter", so a trailing capital still counts as a break: this catches "pay",
 * "POST /pay", "state:resetCart", "delete account" while rejecting "payload" or
 * "removalRequested". Matching is case-insensitive on the verb itself.
 */
export function classifyEffectRisk(effect: string | null | undefined): boolean {
  if (!effect) return false
  const normalized = effect.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return DESTRUCTIVE.some((verb) => new RegExp(`(^|[^a-z])${verb}([^a-z]|$)`).test(normalized))
}
