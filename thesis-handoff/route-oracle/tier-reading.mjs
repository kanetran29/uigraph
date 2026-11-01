// The gate between the recorded reading of the must tier and the graph it is a reading of.
//
// results-must/tier-reading.json records, for every construct that earns must, what it was read to
// say: the address it resolves to, and the guards that run on the navigation. A reading is only a
// reading of the edges the extractor emits if the two still agree, so the census checks the
// reading against the graph and refuses to report a tier the reading does not cover. The checks
// are on the destination as well as on the construct: a reading that lists a construct and says
// where it goes vouches for that destination only while the must edges citing the construct
// still reach it, and a regression that gave the same construct a new destination would
// otherwise pass on a key the file already holds.
//
// Split out of graph-census.mjs, which runs a census at import time, so that it can be tested.

/** `file:line` of a cited construct, the unit the reading is keyed by. */
const siteKey = (w) => `${w.file}:${w.loc?.line}`

/**
 * The constructs that earn must on their own in a graph, each with the set of addresses the must
 * edges citing it reach. A must edge can also cite constructs that earn only may; those are not
 * the unit RQ1 counts and are left out. Two constructs on one line share a key, so their
 * destinations are pooled and a reading of one of them has to account for both.
 */
export function mustSiteTargets(graph) {
  const route = new Map((graph.nodes || []).map((n) => [n.id, n.route]))
  const sites = new Map()
  for (const e of (graph.edges || []).filter((x) => x.modality === 'must')) {
    for (const w of [e.witness, ...(e.mergedWitnesses || [])]) {
      if (!w || (w.modality ?? 'must') !== 'must') continue
      const k = siteKey(w)
      if (!sites.has(k)) sites.set(k, new Set())
      sites.get(k).add(route.get(e.to) ?? e.to)
    }
  }
  return sites
}

/**
 * The verdict of a reading row for a construct that earns must only in the graph mapped without
 * attribution: attribution holds it at may, so the attributed graph the reading is made on has
 * no must edge for it, and the unattributed graph, which the same reading must cover, does.
 * Without a second verdict such a construct could not be listed: as `must` it would make the
 * exact check on the attributed graph refuse it ("earns no must edge"), and unlisted it would
 * make the subset check on the unattributed graph refuse it, so no reading passed both.
 */
export const MUST_UNATTRIBUTED = 'must-unattributed'

/**
 * What is wrong between the reading and one application's graph, as sentences; empty when the
 * reading covers the graph. A must construct the reading does not list, and a listed construct
 * whose recorded targets differ from the destinations of the must edges that cite it, are always
 * wrong. With `exact` (the default, for the graph the reading was made on) a listed construct
 * that earns no must edge is wrong too, so the file cannot go stale, and so is one listed as
 * must only without attribution that earns must here. Without it the graph is one the reading
 * was not made on, the same corpus mapped without attribution, where the must edges are fewer or
 * different: a `must` construct may be absent there and its destinations a subset, and it may
 * reach, besides its `targets`, the addresses its row lists as `unattributedTargets`, which exist
 * only there (listed in `targets` they would fail the exact check, and unlisted this one). Two
 * kinds of row can be checked on that graph alone and so are checked exactly on it: a row listed
 * as must only without attribution has to earn a must edge there and reach exactly its `targets`,
 * and every `unattributedTargets` entry has to be reached by a must edge citing its construct, so
 * that neither can outlive the construct or the address it records.
 */
export function readingProblems(reading, slug, graph, { exact = true } = {}) {
  const rows = reading.sites.filter((r) => r.app === slug)
  const listed = new Map(rows.filter((r) => r.verdict === 'must' || (!exact && r.verdict === MUST_UNATTRIBUTED)).map((r) => [r.site, r]))
  const unattributed = new Set(rows.filter((r) => r.verdict === MUST_UNATTRIBUTED).map((r) => r.site))
  const found = mustSiteTargets(graph)
  const problems = []
  const unlisted = [...found.keys()].filter((k) => !listed.has(k))
  const earned = unlisted.filter((k) => unattributed.has(k))
  if (earned.length) problems.push(`${earned[0]} is listed as must only without attribution but earns a must edge here`)
  const absent = unlisted.filter((k) => !unattributed.has(k))
  if (absent.length) problems.push(`${absent.length} must construct(s) results-must/tier-reading.json does not list, e.g. ${absent[0]}`)
  for (const [k, targets] of found) {
    const r = listed.get(k)
    if (!r) continue
    const said = new Set(r.targets)
    const reach = [...targets].sort()
    const unattributedOnly = new Set(exact ? [] : r.unattributedTargets ?? [])
    const missing = reach.filter((t) => !said.has(t) && !unattributedOnly.has(t))
    const extra = [...said].filter((t) => !targets.has(t))
    const stale = [...unattributedOnly].filter((t) => !targets.has(t))
    if (missing.length || ((exact || r.verdict === MUST_UNATTRIBUTED) && extra.length) || stale.length) {
      problems.push(`${k}: the reading says it reaches [${[...said, ...unattributedOnly].sort().join(', ')}] but the must edges citing it reach [${reach.join(', ')}]`)
    }
  }
  if (exact) {
    for (const k of [...listed.keys()].filter((x) => !found.has(x))) problems.push(`${k} is listed but earns no must edge in this graph`)
  } else {
    for (const r of listed.values()) {
      if (!found.has(r.site) && (r.verdict === MUST_UNATTRIBUTED || r.unattributedTargets?.length)) problems.push(`${r.site} is listed as earning must without attribution but earns no must edge in this graph`)
    }
  }
  return problems
}
