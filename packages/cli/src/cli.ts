#!/usr/bin/env node
// The `uigraph` CLI entry point (milestone M4): a commander program tying the
// whole workspace together — map (extract via an adapter), diff, serve (the local
// API), dash (serve + dashboard instructions), and mcp (the stdio MCP server).
// Command bodies live in commands.ts / server.ts so they stay directly testable;
// this file is only the commander wiring and is run via tsx.

import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { argv as processArgv } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { startServer } from '@ui-graph/mcp'
import { formatDiff, formatDiffSinceLast, formatGenSummary, formatMapSummary, formatMigrateSummary, formatStatus, formatWorkspaceList, runDiff, runDiffSinceLast, runExport, runGen, runKitInstall, runKitPrint, runMap, runMigrate, runStatus, runWorkspaceAdd, runWorkspaceList, runWorkspaceRemove, type AdapterName } from './commands'
import { startApiServer } from './server'
import { runLogin, runVerify, runVerifyUntilDone } from './runner'

/**
 * Locate the built dashboard (apps/dashboard/dist) relative to this module, for
 * both the tsx-run source layout (packages/cli/src) and the built layout
 * (packages/cli/dist). Returns null when no build exists yet.
 */
function findDashboardDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const rel of ['../../../apps/dashboard/dist', '../../../../apps/dashboard/dist']) {
    const candidate = resolve(here, rel)
    if (existsSync(resolve(candidate, 'index.html'))) return candidate
  }
  return null
}

/** Open a URL in the platform default browser, detached; failures are silent (the URL is printed anyway). */
function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref()
  } catch {
    return
  }
}

/** Build the commander program with every uigraph subcommand registered. */
export function buildProgram(): Command {
  const program = new Command()
  program.name('uigraph').description('UI transition graph IR — extract, diff, serve, and expose to agents.')

  program
    .command('map')
    .description('Extract the UI graph from a project directory using an adapter (auto-detected from package.json when --adapter is omitted).')
    .argument('<dir>', 'project directory to map')
    .option('--adapter <name>', 'adapter to use: react | angular | vue | next (default: auto-detect from package.json)')
    .option('--out <file>', 'output database path (default <dir>/uigraph.db)')
    .option('--controls', 'also extract interactive controls (buttons/inputs/etc.) as nested nodes')
    .option('--no-register', 'do not add this workspace to the ~/.uigraph registry')
    .option('--name <name>', 'display name in the workspace registry / dashboard switcher (default the dir basename)')
    .action(async (dir: string, opts: { adapter?: string; out?: string; controls?: boolean; register?: boolean; name?: string }) => {
      const summary = await runMap({ dir, adapter: opts.adapter as AdapterName | undefined, out: opts.out, controls: opts.controls ?? false, register: opts.register, name: opts.name })
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
    .option('--all', 'verify-all sweep: also drive must-static proofs to upgrade them to runtime-witnessed')
    .option('--until-done', 'loop rounds until 100% accounted-for: drive, then park the undrivable remainder with reasons')
    .option('--max-rounds <n>', 'cap for --until-done', '10')
    .option('--concurrency <n>', 'parallel browser pages driving targets at once (1-16)', '8')
    .option('--pattern-sample <n>', 'representatives driven per over-approximation nav pattern before the rest are accounted by pattern', '1')
    .action(async (dir: string, opts: { appUrl: string; limit: string; storageState?: string; all?: boolean; untilDone?: boolean; maxRounds: string; concurrency: string; patternSample: string }) => {
      const concurrency = Number(opts.concurrency)
      const patternSample = Number(opts.patternSample)
      if (opts.all === true && opts.untilDone === true) {
        console.error('--all is a single-pass sweep; run it without --until-done (the loop would park unproven statics it could not drive)')
        process.exitCode = 1
        return
      }
      if (opts.untilDone === true) {
        const s = await runVerifyUntilDone({ dir, appUrl: opts.appUrl, limit: Number(opts.limit), storageState: opts.storageState, maxRounds: Number(opts.maxRounds), concurrency, patternSample })
        console.log(
          `verify --until-done: ${s.rounds} round(s), ${s.confirmed} confirmed, ${s.parkedEdges} edge(s) + ${s.parkedProposals} proposal(s) parked\n` +
            `  loopDone: ${s.loopDone} (${s.exitReason})\n` +
            `  accounted-for: ${Math.round(s.accountedRatio * 100)}% · runtime-verified: ${Math.round(s.runtimeRatio * 100)}%`,
        )
        return
      }
      const s = await runVerify({ dir, appUrl: opts.appUrl, limit: Number(opts.limit), storageState: opts.storageState, includeProven: opts.all === true, concurrency, patternSample })
      const pat = s.patternParked > 0 ? ` · ${s.patternParked} accounted by pattern` : ''
      console.log(`verify: ${s.confirmed} confirmed / ${s.refuted} refuted of ${s.attempted} target(s)${pat}`)
      if (s.refutedProven > 0) {
        console.error(`WARNING: ${s.refutedProven} must-static edge(s) REFUTED at runtime — the extraction and the running app disagree; inspect these edges (diff, soundiness) before trusting the graph`)
        process.exitCode = 1
      }
    })

  program
    .command('login')
    .description('Open a headed browser to log in manually (any auth scheme), then save the session for authenticated verify runs.')
    .argument('<app-url>', 'URL of the running app (e.g. http://localhost:3000/login)')
    .option('--out <file>', 'where to save the Playwright storageState JSON', 'auth.json')
    .action(async (appUrl: string, opts: { out: string }) => {
      await runLogin({ appUrl, out: opts.out })
      console.log(`session saved to ${opts.out}`)
      console.log(`authenticated verify: uigraph verify <dir> --app-url ${appUrl} --storage-state ${opts.out}`)
      process.exit(0)
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
    .description('Diff two graphs by stable id (.db or .json). With --since-last <dir>: diff a workspace\'s current map against its previous one.')
    .argument('[a]', 'first graph (.db or .json), or the workspace dir with --since-last')
    .argument('[b]', 'second graph (.db or .json)')
    .option('--since-last', 'diff the current base graph against the previous map for this workspace (pass the workspace dir as <a>)')
    .action((a: string | undefined, b: string | undefined, opts: { sinceLast?: boolean }) => {
      if (opts.sinceLast === true) {
        if (a === undefined || b !== undefined) {
          console.error('usage: uigraph diff <dir> --since-last')
          process.exitCode = 1
          return
        }
        console.log(formatDiffSinceLast(runDiffSinceLast(a)))
        return
      }
      if (a === undefined || b === undefined) {
        console.error('usage: uigraph diff <a> <b>  (or: uigraph diff <dir> --since-last)')
        process.exitCode = 1
        return
      }
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
    .description('Serve the built dashboard + API on one port and open the browser. With <dir>: one workspace. Without: every registered workspace, switchable in the dashboard.')
    .argument('[dir]', 'workspace directory (omit to serve all registered workspaces)')
    .option('--port <port>', 'port to listen on', '4317')
    .option('--no-open', 'do not open the browser automatically')
    .action(async (dir: string | undefined, opts: { port: string; open: boolean }) => {
      if (dir === undefined && runWorkspaceList().entries.length === 0) {
        console.error('No workspaces registered. Run `uigraph map <dir> --adapter <name>` first, or `uigraph dash <dir>`.')
        process.exitCode = 1
        return
      }
      const staticDir = findDashboardDist()
      const { url } = await startApiServer({ dir, port: Number(opts.port), ...(staticDir !== null ? { staticDir } : {}) })
      const what = dir ?? 'all registered workspaces'
      if (staticDir === null) {
        console.log(`uigraph API serving ${what} at ${url} (API only)`)
        console.log('No built dashboard found. Build it once, then re-run dash:')
        console.log('  pnpm --filter @ui-graph/dashboard build')
        return
      }
      console.log(`uigraph dashboard + API serving ${what} at ${url}`)
      if (opts.open) openInBrowser(url)
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
 * `pnpm --filter @ui-graph/cli run uigraph -- map ...` invocation reaches commander
 * as if `--` were absent. A `--` anywhere else is left for commander to handle.
 */
function stripPnpmSeparator(argv: string[]): string[] {
  if (argv[2] === '--') return [...argv.slice(0, 2), ...argv.slice(3)]
  return argv
}

/**
 * Drop a `--debug` token from argv before commander parses, so it can appear in any
 * position (before or after the subcommand) without commander rejecting it as an
 * unknown option. Whether debug was requested is read from the original argv by the
 * top-level catch, not from commander.
 */
function stripDebugFlag(argv: string[]): string[] {
  return argv.filter((a) => a !== '--debug')
}

/** Parse argv and run the selected command; the module entry point. */
export async function main(argv: string[] = processArgv): Promise<void> {
  await buildProgram().parseAsync(stripDebugFlag(stripPnpmSeparator(argv)))
}

/**
 * True when this module is the process entry point, not imported. Both paths are
 * resolved with realpathSync because `process.argv[1]` is frequently a symlink —
 * npm/pnpm install the bin as `.bin/uigraph -> …/dist/cli.js`, and macOS aliases
 * `/var -> /private/var` — so a raw string compare against the real module path
 * fails and the CLI silently no-ops. Resolving both to their canonical path fixes
 * the installed-bin and temp-dir cases.
 */
function isEntryPoint(): boolean {
  const entry = processArgv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

/**
 * True when the user asked for verbose error output, via a `--debug` flag anywhere
 * in argv or the UIGRAPH_DEBUG env var, so the top-level catch can print the full
 * stack instead of just the message.
 */
function wantsDebug(argv: string[]): boolean {
  return argv.includes('--debug') || (process.env.UIGRAPH_DEBUG ?? '') !== ''
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    if (wantsDebug(processArgv) && err instanceof Error && err.stack !== undefined) {
      console.error(err.stack)
    } else {
      console.error(err instanceof Error ? err.message : String(err))
      if (err instanceof Error) console.error('  (re-run with --debug for the full stack)')
    }
    process.exitCode = 1
  })
}
