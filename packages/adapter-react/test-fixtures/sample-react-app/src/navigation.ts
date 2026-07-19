import type { NavigateFunction } from 'react-router-dom'

// Shared navigation helpers used across pages. The literal route lives two calls
// away from the click (goDashboard -> goTo -> navigate), so a single handler-body
// scan misses it; the adapter's call-graph reachability (F2.8) resolves it.

/** Navigate to an explicit path. */
export function goTo(navigate: NavigateFunction, path: string): void {
  navigate(path)
}

/** Navigate back to the dashboard. */
export function goDashboard(navigate: NavigateFunction): void {
  goTo(navigate, '/dashboard')
}
