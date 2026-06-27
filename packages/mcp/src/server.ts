// MCP SDK wiring for the @uigraph/mcp server (milestone M5). This is the thin
// transport layer: it maps tools/list and tools/call onto the pure functions in
// tools.ts. It uses the low-level Server with JSON-Schema tool declarations (no
// zod), so no LLM is ever invoked and the model-free guarantee is preserved.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolContext } from './tools'
import { listKit, readKitAll, readKitFile } from './kit'
import {
  describeScreen,
  diffTool,
  diffSinceLastTool,
  genSpec,
  getCoverage,
  getGraph,
  getGrounding,
  getProposalGraph,
  getProposals,
  getState,
  listCases,
  getFrontier,
  listScenarios,
  nextToVerifyTool,
  planPathTool,
  setScenario,
  reportObservation,
  reconcileProposalsTool,
  withdrawProposal,
  markUnverifiable,
  parkEdge,
  unparkEdge,
  getLoopStatus,
  getFreshness,
  updateGraph,
  type DescribeScreenArgs,
  type DiffArgs,
  type GenSpecArgs,
  type SetScenarioArgs,
  type GetGroundingArgs,
  type GetProposalsArgs,
  type GetStateArgs,
  type ListCasesArgs,
  type GetFrontierArgs,
  type NextToVerifyArgs,
  type PlanPathArgs,
  type ReportObservationArgs,
  type ResolveProposalArgs,
  type ParkEdgeArgs,
  type UpdateGraphArgs,
} from './tools'

/** Options for starting the server: the workspace dir and an optional transport. */
export interface StartServerOptions {
  dir: string
  transport?: Transport
}

/** The URI scheme the server exposes the bundled agent kit under. */
const KIT_SCHEME = 'uigraph-kit://'

/** The fixed catalogue of model-free tools the server advertises. */
export const TOOLS: Tool[] = [
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
        status: { type: 'string', enum: ['proposed', 'confirmed', 'rejected', 'unverifiable'], description: "filter by lifecycle status; 'proposed' is the open worklist" },
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
    description: 'Coverage of the proven graph under THREE honest ratios — runtimeRatio (actually witnessed in a browser) ≤ verifiedRatio (witnessed OR a deterministic must-static proof) ≤ accountedRatio (verified + resolved-dynamic + parkedCount) — plus the unverified/open/parked lists and a `staleness` summary (dangling refs / stale-hash sidecars) so coverage is never read as fresh when the base or its sidecars are stale.',
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
    name: 'get_state',
    description: 'Describe one state (node) as a trust-tiered action surface: all out-edges rendered as cases, each with event, guard, outcomeClass (to-node, a real screen or a ps_* sub-state), trustTier (witnessed>proven>asserted>llm-verified>proposed>unknown), an `irreversible` flag (true for destructive/non-undoable actions like delete/pay/logout — gate these behind confirmation), and an evidence cite. Answers "what can I do from state X, how far can I trust each path, and which are destructive?".',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'node id (e.g. n_checkout)' } },
      required: ['id'],
    },
  },
  {
    name: 'list_cases',
    description: 'List behavioral cases across the merged graph + quarantined proposals, each tagged with its trust tier, evidence, and an `irreversible` flag (true for destructive/non-undoable actions — gate behind confirmation), sorted most-trusted first. Optional filters: from (source node), outcomeClass (target node / sub-state), minTier (include only cases at least this trusted, e.g. "proven" → witnessed+proven only).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'filter to cases leaving this node id' },
        outcomeClass: { type: 'string', description: 'filter to cases landing on this to-node / sub-state id' },
        minTier: { type: 'string', enum: ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown'], description: 'include only cases at least this trusted' },
      },
    },
  },
  {
    name: 'get_frontier',
    description: 'The known-unknowns: states with unresolved (unknown-modality / dynamic-sink) out-edges, each with the count and the unknown cases. This is where the map is incomplete — probe or ask before relying. The safety spine: the agent is never silently blind. Optional filter: state (one node id).',
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', description: 'restrict the frontier to one node id' } },
    },
  },
  {
    name: 'plan_path',
    description: 'Plan the shortest route between two node ids over the merged graph; "no path" when unreachable. Optional minTier: any hop below that trust floor is reported in tierWarnings (the path is still returned — low-trust hops are flagged, never silently dropped).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'source node id' },
        to: { type: 'string', description: 'target node id' },
        allow: { type: 'array', items: { type: 'string', enum: ['must', 'may', 'unknown'] } },
        minTier: { type: 'string', enum: ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown'], description: 'flag hops below this trust floor in tierWarnings' },
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
  {
    name: 'diff_since_last',
    description: 'What did the last re-map do to the proven UI graph? Diffs the current base graph against the previous one for this workspace (added/removed nodes+edges, changed-edge fields) plus the two mappedAt timestamps. state: ok | no-prior (only one map) | no-current (never mapped). Proven base only — not overlay/proposals/observations. Distinct from get_freshness (source-file staleness): call this after re-mapping to explain the graph delta to the user.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_loop_status',
    description: 'The deterministic DONE signal for the proposal reconciliation loop. loopDone is true iff the verify worklist is empty AND no proposed proposals remain (100% = every uncertain edge runtime-witnessed AND every proposal resolved). Returns coverage + resolution + worklistSize.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_freshness',
    description: 'Is the stored graph current with the source? Returns state fresh | stale | unknown by comparing a source fingerprint stamped at map time to the source now. stale lists changed/added/removed files — the graph may be wrong, so notify the user to re-run `uigraph map`. unknown = never mapped, or the mapped source is not on this machine; treat as could-be-stale, never assume fresh. Call at session start / before trusting the graph.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reconcile_proposals',
    description: 'Re-derive every proposal status from the observation log (confirmed→archived, refuted→withdrawn); idempotent. Use after observations are appended out-of-band (e.g. by the Tier-3 runner). Returns what changed + the resolution snapshot.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'withdraw_proposal',
    description: 'Withdraw a proposal judged hallucinated/impossible: set status rejected with a reason, removing it from the active worklist. Never touches the proven graph.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'proposal id to withdraw' },
        reason: { type: 'string', description: 'why it is hallucinated / cannot exist' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'mark_unverifiable',
    description: 'Park a plausible-but-undrivable proposal as unverifiable with a reason: it leaves the active worklist (so the loop can terminate) but stays queryable for a human. Distinct from withdraw (a disproven lead).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'proposal id to park' },
        reason: { type: 'string', description: 'why it cannot be driven/reached now' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'park_edge',
    description: 'Park a may/unknown EDGE out of the verify worklist with an auditable reason (unreachable/undrivable now: feature flag, external dep, dead code, dynamic target with no reachable landing). Becomes accounted-for but NEVER runtime-verified and NEVER edits the edge or the proven graph. This is how the loop reaches 100% accounted-for honestly.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'edge id to park' },
        reason: { type: 'string', description: 'why it cannot be driven/reached now' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'unpark_edge',
    description: 'Return a previously parked edge to the verify worklist.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'edge id to un-park' } }, required: ['id'] },
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
      case 'get_state':
        return jsonResult(getState(ctx, args as unknown as GetStateArgs))
      case 'list_cases':
        return jsonResult(listCases(ctx, args as unknown as ListCasesArgs))
      case 'get_frontier':
        return jsonResult(getFrontier(ctx, args as unknown as GetFrontierArgs))
      case 'plan_path':
        return jsonResult(planPathTool(ctx, args as unknown as PlanPathArgs))
      case 'update_graph':
        return jsonResult(updateGraph(ctx, args as unknown as UpdateGraphArgs))
      case 'report_observation':
        return jsonResult(reportObservation(ctx, args as unknown as ReportObservationArgs))
      case 'get_loop_status':
        return jsonResult(getLoopStatus(ctx))
      case 'get_freshness':
        return jsonResult(getFreshness(ctx))
      case 'reconcile_proposals':
        return jsonResult(reconcileProposalsTool(ctx))
      case 'withdraw_proposal':
        return jsonResult(withdrawProposal(ctx, args as unknown as ResolveProposalArgs))
      case 'mark_unverifiable':
        return jsonResult(markUnverifiable(ctx, args as unknown as ResolveProposalArgs))
      case 'park_edge':
        return jsonResult(parkEdge(ctx, args as unknown as ParkEdgeArgs))
      case 'unpark_edge':
        return jsonResult(unparkEdge(ctx, args as unknown as { id: string }))
      case 'diff':
        return jsonResult(diffTool(args as unknown as DiffArgs))
      case 'diff_since_last':
        return jsonResult(diffSinceLastTool(ctx))
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
    { capabilities: { tools: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    dispatch(ctx, request.params.name, request.params.arguments ?? {}),
  )

  // Expose the bundled agent kit as readable resources: one per file plus an
  // aggregate `uigraph-kit://all` that a consumer can read in a single call.
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      { uri: `${KIT_SCHEME}all`, name: 'uigraph agent kit (all)', description: 'The whole kit — skill + rules + guides + loop — concatenated.', mimeType: 'text/markdown' },
      ...listKit().map((f) => ({ uri: `${KIT_SCHEME}${f.path}`, name: f.title, mimeType: f.path.endsWith('.json') ? 'application/json' : 'text/markdown' })),
    ],
  }))
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const uri = request.params.uri
    if (!uri.startsWith(KIT_SCHEME)) throw new Error(`unknown resource: ${uri}`)
    const rel = uri.slice(KIT_SCHEME.length)
    const text = rel === 'all' ? readKitAll() : readKitFile(rel)
    return { contents: [{ uri, mimeType: rel.endsWith('.json') ? 'application/json' : 'text/markdown', text }] }
  })

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
