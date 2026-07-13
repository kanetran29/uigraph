// Pure helper for the "Export graph as PNG" feature. The actual capture (toPng +
// getNodesBounds + getViewportForBounds) stays inline in GraphCanvas where the live
// React Flow nodes + instance are in scope; only the filename is pure + tested here.

import type { UiGraph } from '@ui-graph/core'

/** Lowercase to a filename-safe slug: runs of non-alphanumerics collapse to a single '-'. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The download filename for a graph PNG: `uigraph-<adapter slug>-<YYYY-MM-DD>.png`. */
export function pngFilename(graph: UiGraph, now: Date = new Date()): string {
  const slug = slugify(graph.meta?.adapter ?? '') || 'graph'
  return `uigraph-${slug}-${now.toISOString().slice(0, 10)}.png`
}
