# gait — Guarded Agent Integration Tool

> VS Code extension that acts as quality gate and pilot for AI coding agents (Claude Code, Codex CLI, etc).

**Core philosophy: nothing ships without proof it doesn't break things.**

gait sits between you and your codebase. It runs your lint, typecheck, and tests before every commit. It scans for secrets. It tracks regressions. It monitors AI agents in real time and kills them if they go off the rails. It simulates rollbacks in isolated worktrees before touching your working tree.

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Dashboard](#dashboard)
- [Commands](#commands)
- [Quality Gate](#quality-gate)
- [Secret Scanning](#secret-scanning)
- [Pre-Commit Hook](#pre-commit-hook)
- [AI Agent Integration](#ai-agent-integration)
- [Rollback Assistant](#rollback-assistant)
- [Release Flow](#release-flow)
- [Regression Detection](#regression-detection)
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
git clone https://github.com/tuni/gait.git
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

gait auto-detects your stack (Go, Python, TypeScript, Swift) from manifest files and configures lint/test/build commands. Everything is stored in `.gait/config.toml` — commit it so your team shares the same gate.

---

## Dashboard

The webview dashboard is the main interface. Open it with `Cmd+Shift+D` or **Gait: Open Dashboard**.

**What it shows:**

- **Header** — project name, version, branch, clean/dirty status, stack badges
- **Stage badges** — clickable; shows status (pending/running/passed/failed) with timing
- **Gate result banner** — green PASSED or red BLOCKED after a gate run
- **Agent panel** — when an agent is running: kind, prompt, pause/resume/kill controls
- **Changed files** — live git diff stats (files, additions, deletions)
- **Event log** — timestamped history of every action, scrollable, color-coded by level
- **Action bar** — Run Gate, Lint, Test, Typecheck, Build, Agent, Rollback, Release

The dashboard buttons are context-aware: stages without configured commands are hidden, and agent controls appear only when an agent is active.

---

## Commands

All commands are available via `Cmd+Shift+P`:

| Command | Keybinding | Description |
|---------|-----------|-------------|
| **Gait: Initialize Project** | — | Create `.gait/` config from detected stacks |
| **Gait: Run Quality Gate** | `Cmd+Shift+G` | Full pipeline: lint → typecheck → test, with secret scan |
| **Gait: Open Dashboard** | `Cmd+Shift+D` | Open the webview dashboard panel |
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

---

## Quality Gate

The gate runs your pipeline stages in dependency order with early abort:

```
lint → typecheck → test
```

If lint fails, typecheck and test are skipped. Each stage shells out to the command in your `.gait/config.toml`:

```toml
[stacks.typescript]
Lint = "npx tsc --noEmit"
Test = "npx vitest run"
Typecheck = "npx tsc --noEmit"
Build = "npm run build"
```

The gate also scans staged diffs for secrets before running the pipeline. If secrets are found, the gate blocks immediately.

Results appear in three places:
- **Status bar** — live badges with spinners while running
- **Sidebar** — tree view with pass/fail icons
- **Dashboard** — full detail with timing, log entries, and error output

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

This writes a hook to `.git/hooks/pre-commit` that signals the VS Code extension to run the gate. The hook waits for the result and blocks the commit if the gate fails.

- The hook creates `.gait/.hook-trigger` → the extension picks it up → runs the gate → writes `.gait/.hook-result` (pass/fail) → the hook reads it and exits 0 or 1.
- To bypass: `git commit --no-verify`
- To uninstall: delete `.git/hooks/pre-commit`

---

## AI Agent Integration

```
Cmd+Shift+P → Gait: Run Agent
```

1. Pick an agent: **Claude** (`claude -p`) or **Codex** (`codex`)
2. Enter a prompt
3. The agent runs in the background; output streams to the dashboard log

**Mid-flight controls** (appear in dashboard when agent is active):
- **Pause** — sends `SIGSTOP` to freeze the agent process
- **Resume** — sends `SIGCONT` to continue
- **Kill** — sends `SIGKILL` to terminate immediately

**Post-task auto-pipeline:** when the agent finishes, gait automatically runs the full quality gate to verify the agent's changes didn't break anything.

**Token/context estimation:** gait tracks output lines as a proxy for token usage (~20 tokens/line) and estimates context window usage against a 200k token budget.

---

## Rollback Assistant

```
Cmd+Shift+P → Gait: Rollback Assistant
```

1. Pick a recent commit to revert from a quick pick list
2. gait creates a **temporary git worktree** (isolated copy of the repo)
3. Reverts the commit in the worktree
4. Runs your test suite there
5. Reports: files affected, tests pass/fail, whether it's safe to revert
6. If safe, you can apply the revert to your real working tree

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

5. Generates a grouped markdown changelog
6. Runs the quality gate
7. Asks: **Tag Only** or **Tag + Push**
8. Creates an annotated git tag

The changelog and version analysis are shown in an output channel before you confirm.

---

## Regression Detection

gait tracks test baselines per branch as JSON files in `.gait/`:

- **Baseline** — a snapshot of which tests pass on a given branch
- **Regression** — a test that was passing in the baseline but now fails
- **New test** — a test that doesn't exist in the baseline
- **Branch-aware** — each branch gets its own baseline file (`baseline_main.json`, `baseline_feat_login.json`)

The `BaselineStore` provides a `diff()` method that compares current results against the baseline and categorizes every test.

**Flaky test tracking:** tests that flip between pass and fail 3+ times are flagged as flaky and can be exempted from regression alerts. The `FlakyTracker` persists flip counts in `.gait/flaky.json`.

---

## Monorepo Support

gait detects workspace configurations:

| Type | Detection |
|------|-----------|
| **Go** | `go.work` file with `use` directives |
| **npm/yarn** | `package.json` `"workspaces"` field |
| **Python** | Subdirectories containing `pyproject.toml` |

The `affected()` function takes a list of changed files and returns only the workspaces that contain those changes — so you can run tests for affected packages only, instead of the full suite.

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
```

**Multi-stack:** projects with both `go.mod` and `package.json` get both stacks configured. The pipeline uses the first non-empty command it finds per stage across all stacks.

### `.gait/` Directory

| File | Git | Purpose |
|------|-----|---------|
| `config.toml` | **committed** | Pipeline and stack configuration |
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
├── extension.ts                ← VS Code entry point, command wiring
├── core/
│   ├── runner.ts               ← Shell-out executor (spawn + timeout + capture)
│   ├── config.ts               ← TOML config loader + stack auto-detection
│   ├── pipeline.ts             ← Stage runner, pipeline orchestrator, topo-sort
│   ├── git.ts                  ← Git operations (branch, diff, log, status)
│   ├── secrets.ts              ← Secret scanning (regex patterns + Shannon entropy)
│   ├── baseline.ts             ← Test baseline store, regression diffing
│   ├── flaky.ts                ← Flaky test tracker (flip count → threshold)
│   ├── hooks.ts                ← Pre-commit hook install/uninstall/signal
│   ├── agent.ts                ← Agent runner (Claude/Codex), SIGSTOP/SIGCONT/SIGKILL
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

2. **Pipeline is the center** — the dashboard visualizes it, the commit hook runs it, agents trigger it after finishing, rollback simulates it in worktrees.

3. **Safe webview rendering** — the dashboard uses DOM builders (`document.createElement`), not `innerHTML`, to prevent XSS. All user content is inserted via `textContent`.

4. **Config committed, state gitignored** — `.gait/config.toml` and `.gait/scripts/` are shared with the team. Baselines, history, and flaky data are local.

5. **Pure TypeScript** — single language, single build (esbuild), no native dependencies, no binary to ship.

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
npm run lint           # Type check (tsc --noEmit)
npm test               # Run all tests (vitest)
npm run package        # Minified build for distribution
```

### Test

```bash
npm test               # 110 tests across 14 files
npm run test:watch     # Watch mode
```

Tests cover every core module: runner, config, pipeline, secrets, baseline, semver, history, hooks, flaky tracking, monorepo detection, script management, script detection, and AGENTS.md generation.

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
