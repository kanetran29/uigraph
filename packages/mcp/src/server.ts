// MCP SDK wiring for the @uigraph/mcp server (milestone M5). This is the thin
// transport layer: it maps tools/list and tools/call onto the pure functions in
// tools.ts. It uses the low-level Server with JSON-Schema tool declarations (no
// zod), so no LLM is ever invoked and the model-free guarantee is preserved.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolContext } from './tools'
import {
  diffTool,
  getGraph,
  getProposals,
  planPathTool,
  reportObservation,
  updateGraph,
  type DiffArgs,
  type GetProposalsArgs,
  type PlanPathArgs,
  type ReportObservationArgs,
  type UpdateGraphArgs,
} from './tools'

/** Options for starting the server: the workspace dir and an optional transport. */
export interface StartServerOptions {
  dir: string
  transport?: Transport
}

/** The fixed catalogue of model-free tools the server advertises. */
const TOOLS: Tool[] = [
  {
    name: 'get_graph',
    description: 'Return the merged UI transition graph (base + manual overlay) with node/edge counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_proposals',
    description:
      'Return the quarantined Tier-2 proposals (a reviewer agent\'s long-tail behavior hypotheses: read-more, load-more, drag-drop, keyboard, async states...). These are leads to explore/confirm at runtime, NOT proven edges. Optional filters: screen, category, evidencedOnly, minConfidence.',
    inputSchema: {
      type: 'object',
      properties: {
        screen: { type: 'string', description: 'filter to one screen node id (or "app" for global)' },
        category: { type: 'string', description: 'filter to one category, e.g. keyboard, async-state, disclosure' },
        evidencedOnly: { type: 'boolean', description: 'only proposals grounded in concrete source' },
        minConfidence: { type: 'number', description: '0..1 lower bound on confidence' },
      },
    },
  },
  {
    name: 'plan_path',
    description: 'Plan the shortest route between two node ids over the merged graph; "no path" when unreachable.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'source node id' },
        to: { type: 'string', description: 'target node id' },
        allow: { type: 'array', items: { type: 'string', enum: ['must', 'may', 'unknown'] } },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'update_graph',
    description: 'Apply a manual edit (addNode|addEdge|editEdge|remove) to the overlay only; the base is never mutated.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'object', description: 'an overlay edit: { kind, ... }' },
      },
      required: ['op'],
    },
  },
  {
    name: 'report_observation',
    description: 'Append a runtime observation to observations.log.jsonl (append-only; no replay in v1).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        event: { type: 'string' },
        outcome: { type: 'string' },
      },
      required: ['from', 'to', 'event', 'outcome'],
    },
  },
  {
    name: 'diff',
    description: 'Diff two graph files by stable id, returning added/removed nodes+edges and changed-edge field lists.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'path to the first graph file' },
        b: { type: 'string', description: 'path to the second graph file' },
      },
      required: ['a', 'b'],
    },
  },
]

/** Wrap any JSON-serializable payload as a single text content block. */
function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

/** Wrap an error message as an error content block. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Dispatch one tools/call to its pure tool function. Arguments arrive untyped
 * from the wire and are cast to the tool's arg shape; any thrown error becomes a
 * non-fatal error result so a bad call never crashes the server.
 */
function dispatch(ctx: ToolContext, name: string, args: Record<string, unknown>): CallToolResult {
  try {
    switch (name) {
      case 'get_graph':
        return jsonResult(getGraph(ctx))
      case 'get_proposals':
        return jsonResult(getProposals(ctx, args as unknown as GetProposalsArgs))
      case 'plan_path':
        return jsonResult(planPathTool(ctx, args as unknown as PlanPathArgs))
      case 'update_graph':
        return jsonResult(updateGraph(ctx, args as unknown as UpdateGraphArgs))
      case 'report_observation':
        return jsonResult(reportObservation(ctx, args as unknown as ReportObservationArgs))
      case 'diff':
        return jsonResult(diffTool(args as unknown as DiffArgs))
      default:
        return errorResult(`unknown tool: ${name}`)
    }
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Build the MCP Server bound to a workspace dir, registering the tools/list and
 * tools/call handlers. Exposed separately from startServer so tests can drive the
 * server without a transport.
 */
export function createServer(dir: string): Server {
  const ctx: ToolContext = { dir }
  const server = new Server(
    { name: '@uigraph/mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    dispatch(ctx, request.params.name, request.params.arguments ?? {}),
  )

  return server
}

/**
 * Start the model-free stdio MCP server for a workspace directory. Connects over
 * stdio by default; an explicit transport (e.g. an in-memory pair) may be passed
 * for tests. Resolves once the transport is connected.
 */
export async function startServer(opts: StartServerOptions): Promise<Server> {
  const server = createServer(opts.dir)
  const transport = opts.transport ?? new StdioServerTransport()
  await server.connect(transport)
  return server
}
