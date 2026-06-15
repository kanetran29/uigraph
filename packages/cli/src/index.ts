// Public entry point for @uigraph/cli (milestone M4). The runnable program lives
// in cli.ts (run via tsx); this module re-exports the directly-testable command
// handlers and the local API server so other tooling can drive them as functions.

export {
  runMap,
  runDiff,
  runMigrate,
  formatMapSummary,
  formatMigrateSummary,
  formatDiff,
  pickAdapter,
  makeContext,
  consoleLogger,
  readSoundiness,
  dbPathFor,
  DB_FILE,
  runWorkspaceAdd,
  runWorkspaceList,
  runWorkspaceRemove,
  formatWorkspaceList,
  type AdapterName,
  type RunMapOptions,
  type RunDiffOptions,
  type MapSummary,
} from './commands'

export {
  handleApiRequest,
  createApiServer,
  createConfiguredServer,
  registryConfig,
  singleConfig,
  startApiServer,
  type ApiRequest,
  type ApiResponse,
  type ServeConfig,
  type StartApiServerOptions,
} from './server'
