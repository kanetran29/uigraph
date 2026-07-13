# @ui-graph/cli

The command-line entry point for [UI-graph](https://github.com/kanetran29/uigraph) —
your app generates its own **verified** UI transition graph (screens as nodes,
guarded `(event, effect)` transitions as edges), then you prove it against the
running app.

```bash
npm i -g @ui-graph/cli
uigraph map ~/work/your-app --controls        # extract (React / Vue / Angular / Next, auto-detected)
uigraph dash                                  # graph + coverage + freshness dashboard, one command
uigraph verify ~/work/your-app --app-url http://localhost:3000 --until-done   # drive it, confirmations need proof
uigraph mcp ~/work/your-app                   # model-free stdio MCP server for Claude Code / Cursor / Copilot
```

## Commands

| Command | What it does |
| --- | --- |
| `map <dir> [--controls]` | Static extraction → a `uigraph.db` workspace (committable) |
| `verify <dir> --app-url … [--all] [--until-done]` | Tier-3: drive uncertain transitions in a real browser; proof-gated |
| `login <url> --out auth.json` | Capture a session once (any auth scheme) for authenticated verify runs |
| `dash [dir]` | Serve the dashboard + API on one port; without `<dir>`, all registered projects |
| `gen <dir> <from> <to>` | Generate a Playwright spec for a planned path |
| `diff` / `diff --since-last <dir>` | Structural / temporal graph diff |
| `mcp <dir>` | stdio MCP server (27 tools); `kit install --claude` ships the agent kit |
| `serve` / `workspace` | Local API server; multi-project registry |

Nothing calls an LLM — the connecting agent brings its own model (BYOA). Full
docs, the proof-gated verification model, and the open-core split:
[github.com/kanetran29/uigraph](https://github.com/kanetran29/uigraph).

MIT © Kane Tran
