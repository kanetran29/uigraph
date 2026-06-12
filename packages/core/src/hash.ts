// Deterministic, portable content hashing for graphs. Uses canonical JSON +
// FNV-1a (64-bit) so the same logical graph always hashes the same regardless of
// key order, with no Node-only crypto dependency (the dashboard bundles this).

/**
 * Serialize a value to JSON with object keys sorted recursively, so two values
 * that differ only in key order produce identical strings.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
  return '{' + entries.join(',') + '}'
}

/** FNV-1a 64-bit hash of a string, returned as zero-padded 16-char hex. */
export function fnv1a(input: string): string {
  const prime = 1099511628211n
  const mask = (1n << 64n) - 1n
  let hash = 14695981039346656037n
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** Content hash of any JSON-serializable value via canonical JSON + FNV-1a. */
export function hashValue(value: unknown): string {
  return fnv1a(stableStringify(value))
}
