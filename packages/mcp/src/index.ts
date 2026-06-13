// Public entry point for @uigraph/mcp (milestone M5): a model-free stdio MCP
// server exposing the merged UI graph to an agent. It NEVER calls an LLM. The
// pure, directly-testable tool functions are exported alongside the server so
// consumers (and tests) can call them without a transport.

export { startServer, createServer, type StartServerOptions } from './server'

export {
  getGraph,
  getProposals,
  planPathTool,
  updateGraph,
  reportObservation,
  diffTool,
  loadMergedGraph,
  readObservations,
  getProposalGraph,
  describeScreen,
  getCoverage,
  nextToVerifyTool,
  dbPath,
  DB_FILE,
  type DescribeScreenArgs,
  type ScreenDescription,
  type NextToVerifyArgs,
  type ToolContext,
  type GetGraphResult,
  type GetProposalsArgs,
  type GetProposalsResult,
  type PlanPathArgs,
  type PlanPathStep,
  type PlanPathResult,
  type UpdateOp,
  type UpdateGraphArgs,
  type UpdateGraphResult,
  type ReportObservationArgs,
  type ObservationEntry,
  type DiffArgs,
} from './tools'
