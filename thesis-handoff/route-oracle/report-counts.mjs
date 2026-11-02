// The counts and shares that more than one generator prints, in one place so that two of them
// cannot disagree about a figure. results.json stores a conversion ratio already rounded to four
// places; rounding that again moved mifos's 2 of 1344 (0.149 %) to 0.2 in one place and left
// 0.1 in another, and 54,766 of the counts n/d with d up to 1500 round differently in the two
// ways. Every percentage here is taken from the counts.

/** `n` of `d` as a percentage, unrounded: the one expression every printed share is made from. */
export const share = (n, d) => (100 * n) / d

/** `n` of `d` as a percentage to one decimal, from the counts themselves. */
export const pct1 = (n, d) => share(n, d).toFixed(1)

/**
 * The loss ledger of an application, which every plot drawn from it needs: a missing one is not
 * a zero.
 */
export function ledger(r) {
  if (!r.loss?.tally || !r.loss.constructs) throw new Error(`${r.slug}: results.json holds no loss ledger, so its constructs cannot be drawn`)
  return r.loss
}

/**
 * The ledger classes that are not transitions to count: a query-only navigation stays on its
 * screen, and the two exclusions name no destination or a named outlet. The chapter's in-scope
 * constructs are the ledger's constructs less these, the same set round2-to-latex.mjs and
 * loss-breakdown.mjs call in scope.
 */
export const OUT_OF_SCOPE = ['QUERY_ONLY', 'EXCLUDED_NAMED_OUTLET', 'EXCLUDED_NO_COMMANDS']

/** The in-scope constructs of a loss ledger. */
export const inScope = (l) => l.constructs - OUT_OF_SCOPE.reduce((a, k) => a + (l.tally[k] || 0), 0)

/**
 * An application's must conversion as a percentage, unrounded, from its ledger: the constructs
 * that earn a must edge over its in-scope constructs. Null when the result holds no ledger, or no
 * in-scope construct, which a table prints as a dash rather than as a zero.
 */
export function conversion(r) {
  const l = r.loss
  if (!l?.tally || !l.constructs) return null
  const d = inScope(l)
  return d > 0 ? share(l.tally.CONVERTED_MUST || 0, d) : null
}

/**
 * The sites of a witness-check result on which the check compared the construct's target with the
 * edge's destination and reached a verdict. Not counted are the over-approximated sites, for which
 * no target agreement is claimed, and every site whose target was not read (TARGET_UNREAD): a must,
 * may or unknown site whose construct names no destination the check can read, or whose edge
 * reaches a node that is no address. Such a site is neither a pass nor a failure, so it is out of
 * both the numerator and the denominator of a clean share; the witness check records it as a
 * finding and not as clean for that reason, which is what makes `b.clean` a count of compared sites.
 */
export function judgedSites(b) {
  return b.sites - (b.tally?.OVER_APPROX ?? 0) - (b.tally?.TARGET_UNREAD ?? 0)
}
