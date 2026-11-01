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
 * An application's must conversion as a percentage, unrounded, from its ledger: the constructs
 * that earn a must edge over all of its constructs. Null when the result holds no ledger, which a
 * table prints as a dash rather than as a zero.
 */
export function conversion(r) {
  const l = r.loss
  return l?.tally && l.constructs ? share(l.tally.CONVERTED_MUST || 0, l.constructs) : null
}

/**
 * The sites of a witness-check result on which the check reached a verdict about the target. Not
 * counted are the over-approximated sites, for which no target agreement is claimed, and the
 * must sites whose target the check could not read, which are neither a pass nor a failure. The
 * unread ones are out of the denominator of a clean share for the same reason the
 * over-approximated ones are: counting them there makes the share treat as a failure what the
 * must column of the same table treats as no failure.
 */
export function judgedSites(b) {
  return b.sites - (b.tally?.OVER_APPROX ?? 0) - (b.tally?.TARGET_UNREAD ?? 0)
}
