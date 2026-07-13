// Barrel for the model-free @ui-graph/mcp tool logic (milestone M5). Every tool is
// a PURE function over a small ToolContext { dir } plus its args, built on
// @ui-graph/core + @ui-graph/core/node. No LLM is ever called and no MCP transport
// is touched, so these are directly unit-testable without a server. src/server.ts
// wires these to the SDK; the bulk of the value lives in the sibling modules.
//
// context.ts exports internal helpers (withStore, TIER_ORDER, tierAtLeast) for the
// sibling modules; those are deliberately NOT re-exported here — only the public
// API surface below is, matching what tools.ts historically exposed.

export { DB_FILE, dbPath, loadMergedGraph, readObservations, type ObservationEntry, type ToolContext } from './context'
export * from './read'
export * from './planning'
export * from './mutation'
export * from './loop'
export * from './diff'
export * from './propose'
