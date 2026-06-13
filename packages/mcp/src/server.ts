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
  describeScreen,
  diffTool,
  genSpec,
  getCoverage,
  getGraph,
  getGrounding,
  getProposalGraph,
  getProposals,
  listScenarios,
  nextToVerifyTool,
  planPathTool,
  setScenario,
  reportObservation,
  updateGraph,
  type DescribeScreenArgs,
  type DiffArgs,
  type GenSpecArgs,
  type SetScenarioArgs,
  type GetGroundingArgs,
  type GetProposalsArgs,
  type NextToVerifyArgs,
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
    name: 'get_grounding',
    description:
      'Return the Tier-2 grounding digest derived from the proven graph: per screen, the controls that actually exist (with their wired events/effects from call-graph analysis) and the transitions already witnessed. Feed this to a reviewer so it proposes only the uncovered long tail, cites real controls/effects, and prunes hypotheses referencing nothing real. Optional filter: screen.',
    inputSchema: {
      type: 'object',
      properties: {
        screen: { type: 'string', description: 'restrict the digest to one screen node id' },
      },
    },
  },
  {
    name: 'get_proposal_graph',
    description: 'Return the quarantined proposal graph — proposals projected to nodes + edges (proposed transitions), stored separately from the proven graph. Distinct from get_proposals (the raw list).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_screen',
    description: 'Describe one screen as an action surface: its controls (stable selector, events, effects), the transitions PROVEN out of it, and the PROPOSED ones. Answers "I am on screen X — what can I do and where does each action lead?".',
    inputSchema: {
      type: 'object',
      properties: { screen: { type: 'string', description: 'screen node id (e.g. n_checkout)' } },
      required: ['screen'],
    },
  },
  {
    name: 'get_coverage',
    description: 'Runtime-verification coverage of the proven graph: how many edges are runtime-witnessed vs static/manual, by modality/source, plus the list of unverified edges.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'next_to_verify',
    description: 'Ranked worklist of transitions to confirm at runtime next: dynamic-target (unknown) edges, then may edges, then proposed transitions, minus anything already runtime-witnessed. Drives a Tier-3 runner / report_observation.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max targets to return (default 20)' } },
    },
  },
  {
    name: 'gen_spec',
    description: 'Generate a Playwright e2e spec for the route from one node to another: plan the path, then render each leg to a locator action (from the control selector) + assertions (target URL, dialog, request).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'source node id' },
        to: { type: 'string', description: 'target node id' },
        baseUrl: { type: 'string', description: 'base URL prepended to routes' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'list_scenarios',
    description: 'List the planning scenarios (named overlays) and which one is active. Edits + the merged graph target the active scenario.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_scenario',
    description: 'Switch the active planning scenario (creates it empty if new) so you can draft/toggle/compare features independently. The base graph is never touched.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'scenario name to activate' } },
      required: ['name'],
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
    description:
      'Record the result of attempting a transition at runtime (e.g. via Playwright). A confirmed observation is folded into the served graph as a witnessed runtime edge; a refuted one produces no edge. Attach a screenshot path as evidence and a proposalId to confirm a Tier-2 proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'source node id' },
        to: { type: 'string', description: 'target node id' },
        event: { type: 'string' },
        outcome: { type: 'string', enum: ['confirmed', 'refuted'] },
        effect: { type: 'string' },
        proposalId: { type: 'string', description: 'the Tier-2 proposal this verifies, if any' },
        screenshot: { type: 'string', description: 'path to a screenshot captured as evidence' },
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
      case 'get_grounding':
        return jsonResult(getGrounding(ctx, args as unknown as GetGroundingArgs))
      case 'get_proposal_graph':
        return jsonResult(getProposalGraph(ctx))
      case 'describe_screen':
        return jsonResult(describeScreen(ctx, args as unknown as DescribeScreenArgs))
      case 'get_coverage':
        return jsonResult(getCoverage(ctx))
      case 'next_to_verify':
        return jsonResult(nextToVerifyTool(ctx, args as unknown as NextToVerifyArgs))
      case 'gen_spec':
        return jsonResult(genSpec(ctx, args as unknown as GenSpecArgs))
      case 'list_scenarios':
        return jsonResult(listScenarios(ctx))
      case 'set_scenario':
        return jsonResult(setScenario(ctx, args as unknown as SetScenarioArgs))
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
