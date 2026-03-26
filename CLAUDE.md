# HITL-Gate — Claude Code Project Context

## What this project is

HITL-Gate is a VS Code extension that adds a **Human-in-the-Loop interception layer** on top of AI coding agents (Claude Code, Codex). It intercepts agent actions *before* they write files, evaluates their severity, and presents the human with the right level of decision support at the right time.

This is a **fork of `arodroz/gait`** (https://github.com/arodroz/gait). The scaffold (VS Code extension structure, webview dashboard, snapshot system, git utilities, config system) is reused. The quality gate / pipeline / release machinery is removed and replaced with the HITL interception system.

## Core principle

> The agent proposes. The human decides. Never surprised by what the code became.

The system must maximize the probability that the human intervenes *before* an irreversible action, not after. It is not a blocking system — the human can always say "go ahead". It is a signal amplifier that surfaces the right information at the right moment.

## What exists (the fork base)

The fork base already has:
- VS Code extension scaffold (`activate`, `deactivate`, command registration)
- Centralized `state.ts`
- `DashboardPanel` (webview with bidirectional messaging)
- `StatusBarManager`
- Tree view providers (sidebar)
- `snapshot.ts` — git snapshot/restore
- `git.ts` — git utilities (diff, blame, status)
- `config.ts` — TOML config loader (uses `smol-toml`)
- `cost-tracker.ts` — token/cost estimation
- `util.ts` — helpers

## What is removed from the fork

Everything related to quality gates, pipelines, and release:
- `pipeline.ts`, `cmdGate`, `cmdRunStage`, `cmdRelease`, `cmdCreatePR`
- `hooks.ts` (pre-commit hook system — replaced by claude-hooks.ts)
- `scripts.ts`, `cmdRunScript`, `cmdListScripts`, `cmdDetectScripts`
- `cmdAuditDeps`, `cmdGenerateTests` (out of scope)

## What is built new

See `ARCHITECTURE.md` for the full picture.
See `PHASES.md` for implementation order.
See `SPECS/` for detailed specs per module.

## Language and tooling

- TypeScript strict
- esbuild for bundling (extension + webview separate bundles)
- Vitest for tests
- `smol-toml` for config parsing (already a dependency)
- Anthropic SDK + OpenAI SDK for reviewer API calls (add as dependencies)
- No new runtime dependencies beyond these

## File conventions

- All new core modules go in `src/core/`
- All new agent integration modules go in `src/agents/`
- All new VS Code view modules go in `src/views/`
- All new commands go in `src/commands/`
- The IPC bridge CLI goes in `src/bridge/`
- Tests go in `src/tests/` mirroring the source structure
- `.gait/` is the runtime data directory (gitignored except config.toml and decisions/)

## Key constraints

1. **Never auto-accept a high-severity action.** The human must explicitly click.
2. **The reviewer system prompt is hardcoded.** It cannot be overridden by config. This prevents an agent from generating a permissive prompt for itself.
3. **The bridge binary is the only process Claude Code spawns.** It writes a pending file and waits for a decision file. No direct socket or pipe — file-based IPC only.
4. **Reviewer calls use lightweight models.** `claude-haiku-4-5-20251001` for Claude-as-reviewer, `codex-mini-latest` for Codex-as-reviewer. Cost must stay minimal.
5. **`.gait/actions.jsonl` is append-only.** Never mutate existing lines. Write new lines only.
6. **Mode `prod` disables auto-accept entirely**, regardless of severity.

## Config file location

`.gait/config.toml` in the workspace root. Created by `gait.init` command.

## How to run locally

```bash
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## Testing

```bash
npm test           # vitest run
npm run test:watch # vitest watch
```

Write tests for all core modules. Mock VS Code API and file system where needed.
