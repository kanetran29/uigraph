// Shared localStorage helpers: raw string get/set/remove wrapped in try/catch so a
// private-mode or quota error never crashes render. Used by section-collapse, theme,
// language, and layout persistence (each parses its own value from the raw string).

/** Read a raw string from localStorage, or null when absent or localStorage throws. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write a raw string to localStorage, swallowing quota/availability errors. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // best-effort: persistence is optional, never block the UI on it
  }
}

/** Remove a key from localStorage, swallowing errors. */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}
