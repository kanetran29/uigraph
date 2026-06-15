// The `uigraph` CLI entry point (milestone M4): a commander program tying the
// whole workspace together — map (extract via an adapter), diff, serve (the local
// API), dash (serve + dashboard instructions), and mcp (the stdio MCP server).
// Command bodies live in commands.ts / server.ts so they stay directly testable;
// this file is only the commander wiring and is run via tsx.

import { argv as processArgv } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { startServer } from '@uigraph/mcp'
import { formatDiff, formatGenSummary, formatMapSummary, formatMigrateSummary, formatStatus, formatWorkspaceList, runDiff, runExport, runGen, runKitInstall, runKitPrint, runMap, runMigrate, runStatus, runWorkspaceAdd, runWorkspaceList, runWorkspaceRemove, type AdapterName } from './commands'
import { startApiServer } from './server'
import { runVerify, runVerifyUntilDone } from './runner'

/** Build the commander program with every uigraph subcommand registered. */
export function buildProgram(): Command {
  const program = new Command()
  program.name('uigraph').description('UI transition graph IR — extract, diff, serve, and expose to agents.')

  program
    .command('map')
    .description('Extract the UI graph from a project directory using an adapter.')
    .argument('<dir>', 'project directory to map')
    .requiredOption('--adapter <name>', 'adapter to use: react | angular | vue | next')
    .option('--out <file>', 'output database path (default <dir>/uigraph.db)')
    .option('--controls', 'also extract interactive controls (buttons/inputs/etc.) as nested nodes')
    .option('--no-register', 'do not add this workspace to the ~/.uigraph registry')
    .action(async (dir: string, opts: { adapter: string; out?: string; controls?: boolean; register?: boolean }) => {
      const summary = await runMap({ dir, adapter: opts.adapter as AdapterName, out: opts.out, controls: opts.controls ?? false, register: opts.register })
      console.log(formatMapSummary(summary))
    })

  program
    .command('status')
    .description('Report whether the stored graph is current with the source (fresh / stale / unknown).')
    .argument('<dir>', 'workspace directory holding uigraph.db')
    .action((dir: string) => {
      console.log(formatStatus(runStatus(dir)))
    })

  program
    .command('gen')
    .description('Generate an e2e test spec for the route from <from> to <to> over the workspace graph.')
    .argument('<dir>', 'workspace directory holding uigraph.db')
    .argument('<from>', 'source node id (e.g. n_root)')
    .argument('<to>', 'target node id (e.g. m_n_checkout_0)')
    .option('--framework <name>', 'test framework (only playwright)', 'playwright')
    .option('--out <file>', 'write the spec to a file instead of stdout')
    .option('--base-url <url>', 'base URL prepended to routes', '')
    .action((dir: string, from: string, to: string, opts: { framework: string; out?: string; baseUrl: string }) => {
      console.log(formatGenSummary(runGen({ dir, from, to, framework: opts.framework, out: opts.out, baseUrl: opts.baseUrl })))
    })

  program
    .command('migrate')
    .description('Import legacy JSON sidecars (ui-graph.json, overlay, observations, proposals) into the workspace SQLite database.')
    .argument('<dir>', 'workspace directory holding the legacy JSON files')
    .action((dir: string) => {
      console.log(formatMigrateSummary(dir, runMigrate(dir)))
    })

  program
    .command('verify')
    .description('Tier-3: drive the running app to confirm uncertain transitions + proposals, recording runtime observations.')
    .argument('<dir>', 'workspace directory holding uigraph.db')
    .requiredOption('--app-url <url>', 'base URL of the running app (e.g. http://localhost:3000)')
    .option('--limit <n>', 'max targets to attempt per pass', '10')
    .option('--storage-state <file>', 'Playwright storageState JSON for an authenticated session (drives the app logged in)')
    .option('--until-done', 'loop rounds until 100% accounted-for: drive, then park the undrivable remainder with reasons')
    .option('--max-rounds <n>', 'cap for --until-done', '10')
    .action(async (dir: string, opts: { appUrl: string; limit: string; storageState?: string; untilDone?: boolean; maxRounds: string }) => {
      if (opts.untilDone === true) {
        const s = await runVerifyUntilDone({ dir, appUrl: opts.appUrl, limit: Number(opts.limit), storageState: opts.storageState, maxRounds: Number(opts.maxRounds) })
        console.log(
          `verify --until-done: ${s.rounds} round(s), ${s.confirmed} confirmed, ${s.parkedEdges} edge(s) + ${s.parkedProposals} proposal(s) parked\n` +
            `  loopDone: ${s.loopDone} (${s.exitReason})\n` +
            `  accounted-for: ${Math.round(s.accountedRatio * 100)}% · runtime-verified: ${Math.round(s.runtimeRatio * 100)}%`,
        )
        return
      }
      const s = await runVerify({ dir, appUrl: opts.appUrl, limit: Number(opts.limit), storageState: opts.storageState })
      console.log(`verify: ${s.confirmed} confirmed / ${s.refuted} refuted of ${s.attempted} target(s)`)
    })

  program
    .command('export')
    .description('Render the workspace overlay (planned screens/transitions) as a markdown change spec.')
    .argument('<dir>', 'workspace directory holding uigraph.db')
    .action((dir: string) => {
      console.log(runExport(dir))
    })

  program
    .command('diff')
    .description('Diff two graphs by stable id (.db or .json) and print a human-readable summary.')
    .argument('<a>', 'first graph (.db or .json)')
    .argument('<b>', 'second graph (.db or .json)')
    .action((a: string, b: string) => {
      console.log(formatDiff(runDiff({ a, b })))
    })

  program
    .command('serve')
    .description('Serve the merged graph + overlay for the dashboard. With <dir>: one workspace. Without: registry mode — serve every workspace you have mapped, switchable in the dashboard.')
    .argument('[dir]', 'workspace directory (omit to serve all registered workspaces)')
    .option('--port <port>', 'port to listen on', '4317')
    .action(async (dir: string | undefined, opts: { port: string }) => {
      if (dir === undefined && runWorkspaceList().entries.length === 0) {
        console.error('No workspaces registered. Run `uigraph map <dir> --adapter <name>` first, or `uigraph serve <dir>`.')
        process.exitCode = 1
        return
      }
      const { url } = await startApiServer({ dir, port: Number(opts.port) })
      console.log(`uigraph API serving ${dir ?? 'all registered workspaces'} at ${url}`)
      console.log(`  GET  ${url}/api/workspaces`)
      console.log(`  GET  ${url}/api/graph${dir === undefined ? '?ws=<id>' : ''}`)
    })

  const workspace = program.command('workspace').description('Manage the registry of workspaces (projects) the dashboard can switch between.')
  workspace
    .command('list')
    .description('List registered workspaces (● available · ○ needs re-map).')
    .action(() => {
      console.log(formatWorkspaceList(runWorkspaceList()))
    })
  workspace
    .command('add')
    .description('Register a workspace explicitly.')
    .argument('<dir>', 'workspace directory holding uigraph.db')
    .requiredOption('--adapter <name>', 'adapter: react | angular | vue | next')
    .option('--name <name>', 'display name (default the dir basename)')
    .action((dir: string, opts: { adapter: string; name?: string }) => {
      const e = runWorkspaceAdd(dir, opts.adapter as AdapterName, opts.name)
      console.log(`registered ${e.id} (${e.name}) → ${e.dir}`)
    })
  workspace
    .command('remove')
    .description('Unregister a workspace by id or dir (its uigraph.db is left untouched).')
    .argument('<idOrDir>', 'workspace id or directory')
    .action((idOrDir: string) => {
      runWorkspaceRemove(idOrDir)
      console.log(`removed ${idOrDir} from the registry`)
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

  const kit = program.command('kit').description('The shippable LLM agent kit: skill + rules + guides + the reconciliation-loop playbook.')
  kit
    .command('print')
    .description('Print the whole agent kit to stdout (pipe into an agent prompt or CI).')
    .action(() => {
      console.log(runKitPrint())
    })
  kit
    .command('install')
    .description('Copy the agent kit into a project (default <dir>/.uigraph/kit/, or --claude for a Claude skill).')
    .option('--dir <dir>', 'target project directory', process.cwd())
    .option('--claude', 'install SKILL.md as a Claude Code skill (.claude/skills/uigraph/)')
    .action((opts: { dir: string; claude?: boolean }) => {
      const { written } = runKitInstall({ dir: opts.dir, claude: opts.claude ?? false })
      console.log(`Installed uigraph agent kit (${written.length} file(s)):`)
      for (const f of written) console.log(`  ${f}`)
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
