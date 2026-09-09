// Screen screenshots: pictures captured by the runner while the browser was
// provably on a node's screen (a confirmed landing, or a settled goto of a
// concrete route). Kept as a sidecar keyed by node id and attached to the
// merged graph by the fold — the base graph never carries them, so a re-map
// keeps every shot whose node id survives.

import type { UiGraph } from './ir'

/** One captured screenshot: workspace-relative path, capture time, base hash it was taken on, how the runner got there, and `url` — the concrete URL the picture was taken at (a parameterized screen is pictured at ONE instance, e.g. /profile/johndoe for /profile/:username; recording it keeps the picture honest). */
export interface ScreenShot {
  path: string
  ts: string
  base: string
  source: 'landing' | 'goto'
  url?: string
}

/** Screenshots keyed by node id. */
export type ScreenShots = Record<string, ScreenShot>

/**
 * Return a copy of the graph where `screenshot` comes ONLY from the sidecar: every
 * node with a shot gets the shot's path, every other node has no `screenshot` at
 * all. An incoming value (an overlay-added/edited or hand-migrated node carrying
 * its own path) is dropped — a picture must never be attached to a screen the
 * runner did not reach. Shot ids not in the graph are ignored. Pure.
 */
export function attachScreenshots(graph: UiGraph, shots: ScreenShots): UiGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(({ screenshot: _incoming, ...n }) => (shots[n.id] === undefined ? n : { ...n, screenshot: shots[n.id]!.path })),
  }
}
