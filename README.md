# gait — Guarded Agent Integration Tool

> VS Code extension that acts as quality gate and pilot for AI coding agents (Claude Code, Codex CLI, etc).

**Core philosophy: nothing ships without proof it doesn't break things.**

gait sits between you and your codebase. It runs your lint, typecheck, and tests before every commit. It scans for secrets. It tracks regressions. It monitors AI agents in real time and kills them if they go off the rails. It simulates rollbacks in isolated worktrees before touching your working tree. When something fails, it can send the error to an agent and fix it automatically.

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Dashboard](#dashboard)
- [Commands](#commands)
- [Quality Gate](#quality-gate)
- [Autofix](#autofix)
- [Secret Scanning](#secret-scanning)
- [Pre-Commit Hook](#pre-commit-hook)
- [AI Agent Integration](#ai-agent-integration)
- [Rollback Assistant](#rollback-assistant)
- [Release Flow](#release-flow)
- [Regression Detection](#regression-detection)
- [Coverage Detection](#coverage-detection)
- [Monorepo Support](#monorepo-support)
- [Script Management](#script-management)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Development](#development)
- [License](#license)

---

## Install

### From Source

```bash
git clone https://github.com/arodroz/gait.git
cd gait
npm install
npm run compile
```

Then open the `gait` folder in VS Code and press **F5** to launch the Extension Development Host.

### As VSIX

```bash
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension gait-0.1.0.vsix
```

---

## Quick Start

1. Open any project in VS Code
2. `Cmd+Shift+P` → **Gait: Initialize Project**
3. `Cmd+Shift+P` → **Gait: Open Dashboard**
4. `Cmd+Shift+G` to run the full quality gate

`gait init` auto-detects your stack (Go, Python, TypeScript, Swift), configures lint/test/build commands, creates default scripts, and sets up linter configs (ESLint, golangci-lint, ruff, swiftlint) with appropriate rules. Everything is stored in `.gait/` — commit the config and scripts so your team shares the same gate.

**Re-running `gait init`** on an existing project is safe. It asks you to choose:
- **Re-initialize** — overwrites config with fresh defaults (backs up existing `config.toml`)
- **Merge** — keeps existing config, only adds missing stacks and scripts
- **Cancel** — do nothing

---

## Dashboard

The webview dashboard is the main interface. Open it with **Gait: Open Dashboard** (`Cmd+Shift+D`, available after init).

**What it shows:**

- **Header** — project name, branch, clean/dirty indicator, stack badges
- **Gate result banner** — green PASSED or red BLOCKED after a gate run
- **Regression warnings** — tests that were passing but now fail, with flaky test exemptions
- **Stage badges** — clickable; shows status (pending/running/passed/failed) with timing. Failed stages show a **Fix** button.
- **Agent panel** — when an agent is running: kind, prompt, elapsed time, estimated token count, context window usage bar, pause/resume/kill controls
- **Post-task review** — after an agent finishes: task description, agent kind, duration, tokens, file changes summary, gate pass/fail
- **Changed files** — live git diff stats (files, additions, deletions)
- **Event log** — timestamped history of every action, scrollable, color-coded by level
- **Commit gate modal** — full-screen overlay triggered by pre-commit hook with per-stage results and Commit/Cancel buttons
- **Action bar** — Run Gate, individual stage buttons, Agent, Rollback, Release (only shows buttons for configured stages)

---

## Commands

All commands are available via `Cmd+Shift+P`:

| Command | Keybinding | Description |
|---------|-----------|-------------|
| **Gait: Initialize Project** | — | Create `.gait/` config, scripts, and linter configs from detected stacks |
| **Gait: Run Quality Gate** | `Cmd+Shift+G` | Full pipeline + secret scan + regression check + coverage detection |
| **Gait: Open Dashboard** | `Cmd+Shift+D`* | Open the webview dashboard panel |
| **Gait: Run Lint** | — | Run lint stage only |
| **Gait: Run Tests** | — | Run test stage only |
| **Gait: Run Typecheck** | — | Run typecheck stage only |
| **Gait: Run Build** | — | Run build stage only |
| **Gait: Run Agent** | — | Launch Claude or Codex with a prompt |
| **Gait: Rollback Assistant** | — | Simulate a revert in an isolated worktree |
| **Gait: Release** | — | Semver bump, changelog, tag, optional push |
| **Gait: Install Pre-Commit Hook** | — | Add git hook that runs the gate before commits |
| **Gait: Run Script** | — | Pick and run a `.gait/scripts/*.sh` script |
| **Gait: List Scripts** | — | Show all scripts with metadata |
| **Gait: Detect Script Patterns** | — | Find repeated commands in history, save as scripts |
| **Gait: Environment Check** | — | Verify required tools are on PATH |
| **Gait: Generate AGENTS.md** | — | Create AGENTS.md from config for AI agents |
| **Gait: Recover (Cleanup)** | — | Remove stale worktrees, lock files, temp dirs |

*`Cmd+Shift+D` is only active after `gait init` has been run (`gait.initialized` context).

---

## Quality Gate

The gate runs your pipeline stages in dependency order with early abort:

```
lint → typecheck → test
```

If lint fails, typecheck and test are skipped. Each stage shells out to the command in your `.gait/config.toml`:

```toml
[stacks.typescript]
Lint = "npx eslint src/"
Test = "npx vitest run"
Typecheck = "npx tsc --noEmit"
Build = "npm run build"
```

The gate also:
1. **Scans staged diffs for secrets** before running the pipeline
2. **Checks for regressions** against the branch baseline after tests run
3. **Detects untested new code** by running coverage and cross-referencing changed files

Results appear in three places:
- **Status bar** — live badges with spinners while running
- **Sidebar** — tree view with pass/fail icons
- **Dashboard** — full detail with timing, log entries, and error output

---

## Autofix

When a stage fails, gait can send the error to an AI agent and fix it automatically. Three modes, layered by trust level:

### Click "Fix" on a failed stage badge

Builds a targeted prompt containing the exact error output, the command that was run, source code of referenced files, and strict minimal-fix instructions. You can add extra context before sending. The agent fixes the code, then the gate re-runs automatically.

### Shift+click "Fix" — Auto-fix loop

Agent fixes → gate re-runs → repeat up to 3 attempts or until green. No human in the loop.

### Config flag — Fully automatic

Add to `.gait/config.toml`:

```toml
[pipeline]
stages = ["lint", "typecheck", "test"]
timeout = "300s"
autofix = true
autofix_max_attempts = 3
autofix_agent = "claude"
```

When `autofix = true`, every gate failure automatically triggers the fix loop.

---

## Secret Scanning

Before every gate run, gait scans `git diff --cached` for:

| Pattern | Example |
|---------|---------|
| AWS Access Keys | `AKIA...` |
| AWS Secret Keys | `aws_secret_access_key = ...` |
| API Keys | `api_key: sk-...` |
| Passwords/Tokens | `password = "..."` |
| Private Keys | `-----BEGIN RSA PRIVATE KEY-----` |
| GitHub Tokens | `ghp_...`, `ghs_...` |
| Bearer Tokens | `Bearer eyJ...` |
| High-entropy strings | Shannon entropy > 4.5, 20-200 chars |

If any finding is detected, the gate blocks and shows the findings in the dashboard log.

---

## Pre-Commit Hook

```
Cmd+Shift+P → Gait: Install Pre-Commit Hook
```

Writes a hook to `.git/hooks/pre-commit` that signals the VS Code extension to run the gate. When triggered:

1. The hook creates `.gait/.hook-trigger`
2. The extension detects it, opens the dashboard, and runs the gate
3. A **commit gate modal** appears in the dashboard with per-stage results and a pass/fail banner
4. If passed: click **Commit** to allow, or **Cancel** to abort
5. The extension writes `.gait/.hook-result` (pass/fail) → the hook reads it and exits 0 or 1

To bypass: `git commit --no-verify`. To uninstall: delete `.git/hooks/pre-commit`.

---

## AI Agent Integration

```
Cmd+Shift+P → Gait: Run Agent
```

1. gait checks which agents are available on PATH (graceful degradation if none installed)
2. Pick an agent: **Claude** or **Codex**
3. Enter a prompt
4. The agent runs in the background with file write permissions

**How agents are invoked:**
- **Claude**: `claude -p '<prompt>' --allowedTools Edit Write Bash Read Glob Grep`
- **Codex**: `codex --full-auto '<prompt>'`

**Dashboard agent panel** shows:
- Agent kind and status (running/paused)
- Current prompt
- Estimated token count (~20 tokens per output line)
- Context window usage bar (% of 200k)
- Elapsed time

**Mid-flight controls** (appear in dashboard when agent is active):
- **Pause** — sends `SIGSTOP` to freeze the agent process
- **Resume** — sends `SIGCONT` to continue
- **Kill** — sends `SIGKILL` to terminate immediately

**Post-task auto-pipeline:** when the agent finishes, gait automatically runs the full quality gate.

**Post-task review:** the dashboard shows a summary of the agent session: task description, duration, token usage, files changed (+/-), and whether the gate passed.

---

## Rollback Assistant

```
Cmd+Shift+P → Gait: Rollback Assistant
```

1. Pick a recent commit from a quick pick list
2. gait creates a **temporary git worktree** (isolated copy of the repo)
3. Reverts the commit in the worktree with `git revert --no-commit`
4. Runs your test suite there
5. Reports: files affected, tests pass/fail, whether it's safe to revert
6. If safe: click **Revert** to apply to your real working tree

This means you see the impact of a revert **before** it touches your code. If the revert would cause test failures, gait warns you and does not apply it.

---

## Release Flow

```
Cmd+Shift+P → Gait: Release
```

1. Checks for clean working tree
2. Finds the latest git tag
3. Parses all commits since that tag using [Conventional Commits](https://www.conventionalcommits.org/)
4. Detects the semver bump:

   | Commit type | Bump |
   |------------|------|
   | `fix:`, `chore:`, `docs:`, `refactor:` | **patch** |
   | `feat:` | **minor** |
   | `feat!:`, `BREAKING CHANGE` | **major** |

5. Shows the changelog and version analysis in an output channel
6. Runs the quality gate
7. Asks: **Tag Only**, **Tag + Push**, or **Cancel**
8. Creates an annotated git tag

---

## Regression Detection

gait tracks test baselines per branch as JSON files in `.gait/`:

- **Baseline** — a snapshot of which tests pass on a given branch
- **Regression** — a test that was passing in the baseline but now fails
- **New test** — a test that doesn't exist in the baseline
- **Branch-aware** — each branch gets its own baseline file (`baseline_main.json`, `baseline_feat_login.json`)

After every gate run, gait diffs current results against the baseline and surfaces regressions in the dashboard.

**Flaky test tracking:** tests that flip between pass and fail 3+ times are flagged as flaky and exempted from regression alerts. Flip counts persist in `.gait/flaky.json`.

---

## Coverage Detection

After every gate run, gait checks whether new or modified functions have test coverage. It runs the appropriate coverage tool per stack:

| Stack | Coverage tool |
|-------|--------------|
| **Go** | `go test -coverprofile` + `go tool cover -func` |
| **TypeScript** | `vitest --coverage` with JSON reporter |
| **Python** | `pytest --cov --cov-report=json` |

Changed files (from git diff) are cross-referenced with coverage data. Uncovered functions are logged as warnings in the dashboard.

---

## Monorepo Support

gait detects workspace configurations:

| Type | Detection |
|------|-----------|
| **Go** | `go.work` file with `use` directives |
| **npm/yarn** | `package.json` `"workspaces"` field |
| **Python** | Subdirectories containing `pyproject.toml` |

Detected workspaces are logged when the dashboard opens. The `affected()` function takes changed files and returns only affected workspaces for scoped testing.

---

## Script Management

Scripts live in `.gait/scripts/` and use metadata headers:

```bash
#!/usr/bin/env bash
# gait:name test
# gait:description Run all tests for all packages
# gait:expect exit:0
# gait:timeout 120s
# gait:depends lint, typecheck
set -euo pipefail

npm test
```

**Metadata fields:**

| Header | Description |
|--------|-------------|
| `gait:name` | Script identifier |
| `gait:description` | Human-readable description |
| `gait:expect` | Expected exit code (default: `exit:0`) |
| `gait:timeout` | Max execution time (default: `120s`) |
| `gait:depends` | Comma-separated list of scripts to run first |

**Commands:**
- **Gait: Run Script** — quick pick to select and execute
- **Gait: List Scripts** — show all scripts with metadata
- **Gait: Detect Script Patterns** — analyzes the last 30 days of action history, finds commands run 3+ times, filters out already-scripted ones, and offers to save them as new scripts

`gait init` creates default scripts for each detected stack.

---

## Configuration

### `.gait/config.toml`

Auto-generated by `gait init`. Commit this to your repo.

```toml
[project]
name = "myproject"

[stacks.go]
Lint = "go vet ./..."
Test = "go test ./..."
Typecheck = "go vet ./..."
Build = "go build ./..."

[stacks.typescript]
Lint = "npx eslint ."
Test = "npx vitest run"
Typecheck = "npx tsc --noEmit"
Build = "npm run build"

[pipeline]
stages = ["lint", "typecheck", "test"]
timeout = "300s"

# Optional: auto-fix failed stages with an AI agent
# autofix = true
# autofix_max_attempts = 3
# autofix_agent = "claude"
```

**Multi-stack:** projects with both `go.mod` and `package.json` get both stacks configured. The pipeline uses the first non-empty command it finds per stage across all stacks.

### Linter Setup

`gait init` also creates linter configs when none exist:

| Stack | Config file created |
|-------|-------------------|
| **TypeScript** | `eslint.config.js` + installs `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` |
| **Go** | `.golangci.yml` |
| **Python** | `ruff.toml` |
| **Swift** | `.swiftlint.yml` |

Existing configs are never overwritten. Stub files (< 30 chars) are treated as empty and replaced.

### `.gait/` Directory

| File | Git | Purpose |
|------|-----|---------|
| `config.toml` | **committed** | Pipeline, stack, and autofix configuration |
| `scripts/*.sh` | **committed** | Repeatable operations with metadata |
| `.gitignore` | **committed** | Keeps state files out of git |
| `baseline_*.json` | gitignored | Test baseline per branch |
| `coverage.json` | gitignored | Per-function coverage data |
| `flaky.json` | gitignored | Flaky test flip counts |
| `history/*.jsonl` | gitignored | Action log (timestamped JSONL) |
| `.hook-trigger` | gitignored | Pre-commit hook signal file |
| `.hook-result` | gitignored | Pre-commit hook result file |

---

## Architecture

```
src/
├── extension.ts                ← VS Code entry point, command wiring, lifecycle
├── core/
│   ├── runner.ts               ← Shell-out executor (spawn + shell escape + timeout)
│   ├── config.ts               ← TOML config loader, stack auto-detection, validation
│   ├── pipeline.ts             ← Stage runner, pipeline orchestrator, topo-sort
│   ├── git.ts                  ← Git operations (branch, diff, log, status)
│   ├── secrets.ts              ← Secret scanning (regex patterns + Shannon entropy)
│   ├── baseline.ts             ← Test baseline store, regression diffing
│   ├── flaky.ts                ← Flaky test tracker (flip count → threshold)
│   ├── coverage.ts             ← Per-stack coverage collection, untested-code detection
│   ├── hooks.ts                ← Pre-commit hook install/uninstall/signal protocol
│   ├── agent.ts                ← Agent runner (Claude/Codex), SIGSTOP/SIGCONT/SIGKILL
│   ├── autofix.ts              ← Fix prompt builder, auto-fix loop (agent → gate → retry)
│   ├── linter-setup.ts         ← Per-stack linter config generation + dep installation
│   ├── rollback.ts             ← Worktree-based revert simulation
│   ├── release.ts              ← Tag analysis, semver bump, release execution
│   ├── semver.ts               ← Version parsing, conventional commit detection, changelog
│   ├── scripts.ts              ← Script parser (gait: headers), runner, default generator
│   ├── script-detect.ts        ← History analysis for repeated command patterns
│   ├── monorepo.ts             ← Workspace detection (go.work, npm, python)
│   ├── prereq.ts               ← Environment prerequisite checks
│   ├── recover.ts              ← Stale worktree/lockfile/tempdir cleanup
│   ├── agentsmd.ts             ← AGENTS.md generator from config
│   ├── history.ts              ← JSONL action logger
│   ├── util.ts                 ← Duration parsing, formatting
│   └── util-glob.ts            ← Simple glob for workspace patterns
├── views/
│   ├── statusbar.ts            ← VS Code status bar items (per-stage badges)
│   ├── sidebar.ts              ← TreeView provider (pipeline stages)
│   └── dashboard.ts            ← Webview panel manager (HTML/CSS/state push)
└── webview/
    └── main.ts                 ← Dashboard UI (safe DOM builders, message passing)
```

### Design Decisions

1. **Shell-out everywhere** — gait orchestrates existing tools (`go test`, `eslint`, `vitest`, `git`), never reimplements them. Works with any tool version.

2. **Pipeline is the center** — the dashboard visualizes it, the commit hook runs it, agents trigger it after finishing, rollback simulates it in worktrees, autofix loops around it.

3. **Safe webview rendering** — the dashboard uses DOM builders (`document.createElement`), not `innerHTML`, to prevent XSS. All user content is inserted via `textContent`.

4. **Config committed, state gitignored** — `.gait/config.toml` and `.gait/scripts/` are shared with the team. Baselines, history, and flaky data are local.

5. **Non-destructive init** — re-running `gait init` on an existing project offers Re-initialize (with backup), Merge, or Cancel. Existing configs, scripts, and linter setups are never silently overwritten.

6. **Pure TypeScript** — single language, single build (esbuild), no native dependencies, no binary to ship.

---

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- VS Code 1.85+

### Build

```bash
npm install
npm run compile        # Build extension + webview
npm run watch          # Rebuild on change
npm run lint           # Type check (tsc --noEmit) + ESLint
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run package        # Minified build for distribution
```

### Test

```bash
npm test               # 121 tests across 16 files
```

Tests cover: runner, config, pipeline, secrets, baseline, semver, history, hooks, flaky tracking, monorepo detection, script management, script detection, AGENTS.md generation, autofix prompt builder, and linter setup.

### Debug

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded. The `.vscode/launch.json` is pre-configured.

### Package

```bash
npx @vscode/vsce package --no-dependencies
```

Produces `gait-x.y.z.vsix` that can be installed with `code --install-extension`.

---

## License

MIT
