// The `uigraph` CLI entry point (milestone M4): a commander program tying the
// whole workspace together — map (extract via an adapter), diff, serve (the local
// API), dash (serve + dashboard instructions), and mcp (the stdio MCP server).
// Command bodies live in commands.ts / server.ts so they stay directly testable;
// this file is only the commander wiring and is run via tsx.

import { argv as processArgv } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { startServer } from '@uigraph/mcp'
import { formatDiff, formatMapSummary, runDiff, runMap, type AdapterName } from './commands'
import { startApiServer } from './server'

/** Build the commander program with every uigraph subcommand registered. */
export function buildProgram(): Command {
  const program = new Command()
  program.name('uigraph').description('UI transition graph IR — extract, diff, serve, and expose to agents.')

  program
    .command('map')
    .description('Extract the UI graph from a project directory using an adapter.')
    .argument('<dir>', 'project directory to map')
    .requiredOption('--adapter <name>', 'adapter to use: react | angular')
    .option('--out <file>', 'output graph path (default <dir>/ui-graph.json)')
    .action(async (dir: string, opts: { adapter: string; out?: string }) => {
      const summary = await runMap({ dir, adapter: opts.adapter as AdapterName, out: opts.out })
      console.log(formatMapSummary(summary))
    })

  program
    .command('diff')
    .description('Diff two graph files by stable id and print a human-readable summary.')
    .argument('<a>', 'first graph file')
    .argument('<b>', 'second graph file')
    .action((a: string, b: string) => {
      console.log(formatDiff(runDiff({ a, b })))
    })

  program
    .command('serve')
    .description('Start the local API server that serves the merged graph + overlay for the dashboard.')
    .argument('<dir>', 'workspace directory holding ui-graph.json')
    .option('--port <port>', 'port to listen on', '4317')
    .action(async (dir: string, opts: { port: string }) => {
      const { url } = await startApiServer({ dir, port: Number(opts.port) })
      console.log(`uigraph API serving ${dir} at ${url}`)
      console.log(`  GET  ${url}/api/graph`)
      console.log(`  GET  ${url}/api/soundiness`)
      console.log(`  POST ${url}/api/overlay`)
    })

  program
    .command('dash')
    .description('Start the API server and print instructions to run the dashboard against it.')
    .argument('<dir>', 'workspace directory holding ui-graph.json')
    .option('--port <port>', 'API port to listen on', '4317')
    .action(async (dir: string, opts: { port: string }) => {
      const { url } = await startApiServer({ dir, port: Number(opts.port) })
      console.log(`uigraph API serving ${dir} at ${url}`)
      console.log('To view the dashboard, run its dev server and point it at this API URL:')
      console.log(`  UIGRAPH_API=${url} pnpm --filter @uigraph/dashboard dev`)
    })

  program
    .command('mcp')
    .description('Start the model-free stdio MCP server exposing the merged graph to an agent.')
    .argument('<dir>', 'workspace directory holding ui-graph.json')
    .action(async (dir: string) => {
      await startServer({ dir })
    })

  return program
}

/**
 * Drop the leading `--` separator that `pnpm run <script> -- <args>` injects
 * between the [node, script] prefix and the user's arguments, so the documented
 * `pnpm --filter @uigraph/cli run uigraph -- map ...` invocation reaches commander
 * as if `--` were absent. A `--` anywhere else is left for commander to handle.
 */
function stripPnpmSeparator(argv: string[]): string[] {
  if (argv[2] === '--') return [...argv.slice(0, 2), ...argv.slice(3)]
  return argv
}

/** Parse argv and run the selected command; the module entry point. */
export async function main(argv: string[] = processArgv): Promise<void> {
  await buildProgram().parseAsync(stripPnpmSeparator(argv))
}

/** True when this module is the process entry point (run via tsx), not imported. */
function isEntryPoint(): boolean {
  const entry = processArgv[1]
  if (entry === undefined) return false
  return fileURLToPath(import.meta.url) === entry
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
