// UI-graph verification gate: proves a UI change matches its approved AC
// contract. Pure matcher functions here; CLI + pipeline added by later tasks.
// Spec: docs/superpowers/specs/2026-07-19-uigraph-verification-gate-design.md

/** Convert a minimal glob (only ** and *) to an anchored RegExp. */
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*/g, '\x00').replace(/\*/g, '[^/]*').replace(/\x00/g, '.*')
  return new RegExp(`^${body}$`)
}

/** Match one spec field against an actual value: `~`-suffix = case-insensitive substring, else strict equality. */
export function fieldMatches(spec, key, actual) {
  if (key.endsWith('~')) {
    const v = actual[key.slice(0, -1)]
    return typeof v === 'string' && v.toLowerCase().includes(String(spec).toLowerCase())
  }
  return actual[key] === spec
}

/** True when every field of `spec` matches `actual`; `control` nests exact field matches. */
export function itemMatches(spec, actual) {
  for (const [key, want] of Object.entries(spec)) {
    if (key === 'control') {
      if (typeof actual.control !== 'object' || actual.control === null) return false
      for (const [ck, cv] of Object.entries(want)) if (actual.control[ck] !== cv) return false
      continue
    }
    if (!fieldMatches(want, key, actual)) return false
  }
  return true
}

/** Structural check of a contract object; returns "<path>: <problem>" strings, empty when valid. */
export function validateContract(contract) {
  const errors = []
  if (typeof contract?.ticket !== 'string' || contract.ticket === '') errors.push('ticket: required non-empty string')
  if (typeof contract?.requirement !== 'string' || contract.requirement === '') errors.push('requirement: required non-empty string')
  if (typeof contract?.expect !== 'object' || contract.expect === null) errors.push('expect: required object')
  for (const k of ['addedNodes', 'addedEdges', 'changedNodes']) {
    const v = contract?.expect?.[k]
    if (v !== undefined && !Array.isArray(v)) errors.push(`expect.${k}: must be an array`)
  }
  const patterns = contract?.code?.patterns
  if (patterns !== undefined) {
    if (!Array.isArray(patterns)) errors.push('code.patterns: must be an array')
    else patterns.forEach((p, i) => {
      if (p.mode !== 'must' && p.mode !== 'forbid') errors.push(`code.patterns[${i}].mode: must be "must" or "forbid"`)
      if (typeof p.astGrep !== 'string' || !/^(rule|pattern): /.test(p.astGrep))
        errors.push(`code.patterns[${i}].astGrep: must start with "rule: " or "pattern: "`)
    })
  }
  const impactAllow = contract?.code?.impactAllow
  if (impactAllow !== undefined && !Array.isArray(impactAllow)) errors.push('code.impactAllow: must be an array')
  const behavioral = contract?.behavioral
  if (behavioral !== undefined) {
    if (!Array.isArray(behavioral)) errors.push('behavioral: must be an array')
    else behavioral.forEach((b, i) => {
      for (const f of ['id', 'text', 'spec'])
        if (typeof b?.[f] !== 'string') errors.push(`behavioral[${i}].${f}: required string`)
    })
  }
  return errors
}

/** Match an approved contract against a GraphDiff; the machine verdict for the structure layer. */
export function matchContract(contract, diff) {
  const expect = contract.expect ?? {}
  const results = []
  const claimedNodes = new Set()
  const claimedEdges = new Set()
  for (const spec of expect.addedNodes ?? []) {
    const hit = diff.addedNodes.find((n) => itemMatches(spec, n)) ?? null
    if (hit) claimedNodes.add(hit.id)
    results.push({ kind: 'addedNodes', spec, matched: hit ? hit.id : null })
  }
  for (const spec of expect.addedEdges ?? []) {
    const hit = diff.addedEdges.find((e) => itemMatches(spec, e)) ?? null
    if (hit) claimedEdges.add(hit.id)
    results.push({ kind: 'addedEdges', spec, matched: hit ? hit.id : null })
  }
  for (const spec of expect.changedNodes ?? []) {
    const hit = diff.changedNodes.find((ch) => itemMatches(spec, ch.after)) ?? null
    if (hit) claimedNodes.add(hit.id)
    results.push({ kind: 'changedNodes', spec, matched: hit ? hit.id : null })
  }
  const removalViolations = expect.forbidRemovals === true ? diff.removedNodes.map((n) => n.id) : []
  const uncovered = {
    nodes: diff.addedNodes.filter((n) => !claimedNodes.has(n.id)).map((n) => n.id),
    edges: diff.addedEdges.filter((e) => !claimedEdges.has(e.id)).map((e) => e.id),
  }
  const unmatched = results.some((r) => r.matched === null)
  const strictFail = expect.strict === true && (uncovered.nodes.length > 0 || uncovered.edges.length > 0)
  return { pass: !unmatched && removalViolations.length === 0 && !strictFail, results, removalViolations, uncovered }
}
