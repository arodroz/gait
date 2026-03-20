# gait — Guarded Agent Integration Tool

> VS Code extension that acts as quality gate and pilot for AI coding agents (Claude Code, Codex CLI, etc).

**Core philosophy: nothing ships without proof it doesn't break things.**

gait sits between you and your codebase. It runs your lint, typecheck, and tests before every commit. It scans for secrets. It tracks regressions. It monitors AI agents in real time and kills them if they go off the rails. It simulates rollbacks in isolated worktrees before touching your working tree. When something fails, it can send the error to an agent and fix it automatically.

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Dashboard](#dashboard)
- [Sidebar](#sidebar)
- [Commands](#commands)
- [Quality Gate](#quality-gate)
- [Pipeline Profiles](#pipeline-profiles)
- [Autofix](#autofix)
- [Secret Scanning](#secret-scanning)
- [Pre-Commit Hook](#pre-commit-hook)
- [AI Agent Integration](#ai-agent-integration)
- [Prompt Templates](#prompt-templates)
- [Snapshot & Restore](#snapshot--restore)
- [Live Agent Diff](#live-agent-diff)
- [Cost Tracker](#cost-tracker)
- [Rollback Assistant](#rollback-assistant)
- [Release Flow](#release-flow)
- [PR Generator](#pr-generator)
- [Multi-Agent Workflows](#multi-agent-workflows)
- [Regression Detection](#regression-detection)
- [Coverage Detection](#coverage-detection)
- [Test Impact Analysis](#test-impact-analysis)
- [Monorepo Support](#monorepo-support)
- [Script Management](#script-management)
- [Notification Hooks](#notification-hooks)
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

Press **F5** in VS Code to launch the Extension Development Host.

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
4. `Cmd+Shift+G` to run the quality gate

`gait init` auto-detects your stack (Go, Python, TypeScript, Swift), configures lint/test/build commands, creates default scripts, sets up linter configs (ESLint, golangci-lint, ruff, swiftlint), and generates prompt templates and example workflows.

**Re-running `gait init`** on an existing project is safe — it asks: Re-initialize (with backup), Merge (additive only), or Cancel.

---

## Dashboard

Open with **Gait: Open Dashboard** (`Cmd+Shift+D`, available after init).

- **Header** — project name, version (from git tag), branch, clean/dirty, stack badges
- **Gate banner** — green passed / red blocked with timing
- **Regression warnings** — tests that were passing but now fail, with flaky exemptions
- **Pipeline** — Vercel-style connected stages with status icons, click to re-run, **Fix** button on failed stages
- **Agent panel** — kind, prompt, elapsed time, token count, context bar, pause/resume/kill
- **Post-task review** — task, agent, duration, tokens, file changes, gate result
- **Coverage section** — collapsible, shows untested functions or "all tested"
- **Changed files** — click for diff view, Cmd+click to jump to first change, arrow icon to open file
- **Log** — timestamped, color-coded, collapsible
- **Actions** — Run Gate, stage buttons, Agent, Rollback, Release, Profile switch, Snapshot restore, Create PR
- **Commit gate modal** — overlay triggered by pre-commit hook with Commit/Cancel
- **Keyboard shortcuts** — G (gate), L (lint), T (test), A (agent)

All sections are collapsible (click the chevron).

---

## Sidebar

The Gait activity bar icon shows four panels:

**Pipeline** — gate result summary, stages with pass/fail icons, failed stages auto-expand to show error lines (clickable — jumps to file:line), rich markdown tooltips.

**Scripts** — all `.gait/scripts/*.sh` with name, description, dependency info. Click to run.

**Quick Actions** — 10 commands with icons and keyboard shortcuts: Run Gate, Open Dashboard, Run Agent, Rollback, Release, Install Hook, Run Script, Generate AGENTS.md, Environment Check, Recover.

**Project** — live info: project name, branch, clean/dirty, stacks, monorepo workspaces (affected highlighted).

---

## Commands

All 22 commands via `Cmd+Shift+P`:

| Command | Keybinding | Description |
|---------|-----------|-------------|
| **Gait: Initialize Project** | — | Create `.gait/`, detect stacks, set up linters, create prompts + workflows |
| **Gait: Run Quality Gate** | `Cmd+Shift+G` | Pipeline + secret scan + regression check + coverage |
| **Gait: Open Dashboard** | `Cmd+Shift+D`* | Webview dashboard |
| **Gait: Run Lint** | — | Single stage |
| **Gait: Run Tests** | — | Single stage |
| **Gait: Run Typecheck** | — | Single stage |
| **Gait: Run Build** | — | Single stage |
| **Gait: Run Agent** | — | Launch Claude/Codex with prompt template picker |
| **Gait: Rollback Assistant** | — | Simulate revert in isolated worktree |
| **Gait: Release** | — | Semver bump, changelog, tag, optional push |
| **Gait: Install Pre-Commit Hook** | — | Git hook that runs gate before commits |
| **Gait: Run Script** | — | Pick and run a `.gait/scripts/*.sh` with dependency resolution |
| **Gait: List Scripts** | — | Show all scripts with metadata |
| **Gait: Detect Script Patterns** | — | Find repeated commands in history, save as scripts |
| **Gait: Environment Check** | — | Verify tools on PATH |
| **Gait: Generate AGENTS.md** | — | Create AGENTS.md from config |
| **Gait: Recover (Cleanup)** | — | Remove stale worktrees, lock files, temp dirs |
| **Gait: Take Snapshot** | — | Manual snapshot of current working tree |
| **Gait: Restore Snapshot** | — | Pick and restore a previous snapshot |
| **Gait: Switch Pipeline Profile** | — | Toggle between quick/full/custom profiles |
| **Gait: Create Pull Request** | — | Generate PR summary, push, create via `gh` |
| **Gait: Run Workflow** | — | Multi-step agent orchestration |
| **Gait: Cost Summary** | — | Daily/weekly/monthly agent spend breakdown |

*`Cmd+Shift+D` active after `gait init`.

---

## Quality Gate

Runs stages in dependency order with early abort: `lint → typecheck → test`. Also:

1. **Secret scan** on staged diffs
2. **Regression check** against branch baseline
3. **Test impact analysis** log
4. **Coverage detection** for untested functions
5. **Autofix** (if enabled) on failure

---

## Pipeline Profiles

Switch between gate speeds:

```
Cmd+Shift+P → Gait: Switch Pipeline Profile
```

- **quick** — lint only (fast feedback during dev)
- **full** — all stages (lint + typecheck + test)
- **custom** — define in config

Pre-commit hook always forces the `commit_profile` (default: `full`).

```toml
[pipeline.profiles.quick]
stages = ["lint"]
timeout = "30s"

[pipeline]
commit_profile = "full"
```

---

## Autofix

When a stage fails, three layers:

- **Click "Fix"** on the failed stage → scoped prompt with error + source + blame context → user reviews → agent fixes → auto-gate
- **Shift+click "Fix"** → auto-fix loop (up to 3 attempts), blame-enhanced, no human in loop
- **Config flag** `autofix = true` → auto-fix runs on every gate failure

All fix prompts include: the exact command, error output, relevant source files, and git blame context identifying the commit that introduced the problem.

```toml
[pipeline]
autofix = true
autofix_max_attempts = 3
autofix_agent = "claude"
```

---

## Secret Scanning

Scans `git diff --cached` for AWS keys, API tokens, private keys, GitHub tokens, bearer tokens, and high-entropy strings (Shannon entropy > 4.5). Blocks the gate if found.

---

## Pre-Commit Hook

```
Cmd+Shift+P → Gait: Install Pre-Commit Hook
```

On commit: hook signals VS Code → dashboard opens with commit gate modal → pipeline runs with `full` profile → Commit/Cancel buttons. Bypass: `git commit --no-verify`.

---

## AI Agent Integration

```
Cmd+Shift+P → Gait: Run Agent
```

1. Budget check (blocks if daily limit exceeded)
2. Prompt template picker (built-in or custom from `.gait/prompts/`)
3. Snapshot taken automatically before agent runs
4. Agent launches: `claude -p '<prompt>' --allowedTools Edit Write Bash Read Glob Grep` or `codex --full-auto`
5. Dashboard shows: kind, status, prompt, token count, context bar, elapsed time
6. Controls: Pause (SIGSTOP), Resume (SIGCONT), Kill (SIGKILL)
7. Live diff: file changes polled every 2s with real add/del counts
8. On done: cost recorded, auto-gate runs, post-task review shown, notification sent, snapshots pruned

---

## Prompt Templates

Templates in `.gait/prompts/*.md` with frontmatter:

```markdown
---
name: fix-lint
description: Fix linting errors
variables: [error, file, command]
---
The lint command `{{command}}` failed on `{{file}}`.
## Error
{{error}}
Fix ONLY the lint error. Do not refactor.
```

Built-in defaults: `fix-lint.md`, `fix-test.md`, `add-tests.md`, `refactor.md`. Created on `gait init`.

---

## Snapshot & Restore

Before every agent session and workflow, gait creates a lightweight git tag as a restore point.

- **Take**: `Cmd+Shift+P` → Gait: Take Snapshot (also automatic before agents)
- **Restore**: `Cmd+Shift+P` → Gait: Restore Snapshot → pick from list → hard reset + clean
- **Prune**: old snapshots (>24h) auto-pruned after each agent session

---

## Live Agent Diff

While an agent is running, gait polls `git diff` every 2 seconds and updates the dashboard's Changed Files section with real addition/deletion counts per file. Click any file to see the diff.

---

## Cost Tracker

Tracks estimated API spend per agent session.

```
Cmd+Shift+P → Gait: Cost Summary
```

Shows today / this week / this month costs, session count, and budget usage. Budget enforcement blocks agents when daily limit is exceeded.

```toml
[pipeline]
daily_budget_usd = 10.00
```

---

## Rollback Assistant

```
Cmd+Shift+P → Gait: Rollback Assistant
```

Pick a commit → worktree created → revert simulated → tests run (with symlinked node_modules) → impact reported → confirm or cancel before touching working tree.

---

## Release Flow

```
Cmd+Shift+P → Gait: Release
```

Finds latest tag, parses conventional commits, detects semver bump (patch/minor/major), shows changelog, runs gate, asks Tag Only / Tag + Push / Cancel.

---

## PR Generator

```
Cmd+Shift+P → Gait: Create Pull Request
```

Builds PR body from git log + diff stats + conventional commit grouping + test plan checklist. Pushes branch and creates PR via `gh pr create`. Title editable before submission.

---

## Multi-Agent Workflows

Define workflows in `.gait/workflows/*.yaml`:

```yaml
name: implement-and-test
description: Agent implements then writes tests
steps:
  - agent: claude
    prompt: "{{task}}"
  - gate
    profile: quick
  - agent: claude
    prompt: "Write tests for the changes"
  - gate
    profile: full
```

Run with `Cmd+Shift+P` → Gait: Run Workflow. Snapshot taken before, auto-restore offered on failure.

---

## Regression Detection

Per-branch baselines in `.gait/baseline_<branch>.json`. After each gate:
- Test output parsed (vitest, Go, pytest formats)
- Diffed against baseline → regressions flagged
- Flaky tests (3+ flips) exempted
- Baseline saved on passing runs
- Notifications sent on regression

---

## Coverage Detection

After every gate, runs coverage per stack (vitest --coverage, go test -coverprofile, pytest-cov), cross-references with changed files, reports untested functions in the dashboard's collapsible Coverage section.

---

## Test Impact Analysis

Maps source files to test files via coverage data and naming conventions. Logs how many test files are affected by current changes. (Used for informational purposes; scoped test execution planned for future.)

---

## Monorepo Support

Detects workspaces (go.work, npm workspaces, python pyproject.toml). During dev, scopes lint/test to affected packages only. Pre-commit hook runs full suite. Sidebar shows workspaces with affected indicators.

---

## Script Management

Scripts in `.gait/scripts/` with `gait:` metadata headers (name, description, expect, timeout, depends). Run with dependency resolution. Pattern detection from action history.

---

## Notification Hooks

```toml
[notifications]
slack_webhook = "https://hooks.slack.com/..."
discord_webhook = "https://discord.com/api/webhooks/..."
events = ["gate.failed", "regression.detected", "agent.done", "release.tagged"]
```

Events: `gate.passed`, `gate.failed`, `agent.done`, `release.tagged`, `regression.detected`.

---

## Configuration

### `.gait/config.toml`

```toml
[project]
name = "myproject"

[stacks.typescript]
Lint = "npx eslint src/"
Test = "npx vitest run"
Typecheck = "npx tsc --noEmit"
Build = "npm run build"

[pipeline]
stages = ["lint", "typecheck", "test"]
timeout = "300s"
# autofix = true
# autofix_max_attempts = 3
# autofix_agent = "claude"
# daily_budget_usd = 10.00
# commit_profile = "full"
# snapshot_retention = "24h"

# [pipeline.profiles.quick]
# stages = ["lint"]
# timeout = "30s"

# [notifications]
# slack_webhook = "https://hooks.slack.com/..."
# events = ["gate.failed", "regression.detected"]
```

### Linter Setup

`gait init` creates linter configs when none exist: `eslint.config.js` (TS), `.golangci.yml` (Go), `ruff.toml` (Python), `.swiftlint.yml` (Swift).

### `.gait/` Directory

| Path | Git | Purpose |
|------|-----|---------|
| `config.toml` | committed | Pipeline, stack, autofix, notifications config |
| `scripts/*.sh` | committed | Repeatable operations with metadata |
| `prompts/*.md` | committed | Agent prompt templates with variables |
| `workflows/*.yaml` | committed | Multi-agent workflow definitions |
| `.gitignore` | committed | Keeps state files out of git |
| `baseline_*.json` | gitignored | Test baseline per branch |
| `coverage.json` | gitignored | Per-function coverage data |
| `flaky.json` | gitignored | Flaky test flip counts |
| `costs.json` | gitignored | Agent cost tracking |
| `impact-map.json` | gitignored | Test impact mapping |
| `snapshots.json` | gitignored | Snapshot index |
| `history/*.jsonl` | gitignored | Action log |

---

## Architecture

```
src/
├── extension.ts                ← VS Code entry point, 22 commands, lifecycle
├── core/
│   ├── runner.ts               ← Shell executor (spawn + shell escape + timeout)
│   ├── config.ts               ← TOML config, stack detection, validation
│   ├── pipeline.ts             ← Stage runner, orchestrator, topo-sort
│   ├── profiles.ts             ← Pipeline profiles (quick/full/custom)
│   ├── git.ts                  ← Git operations (branch, diff, log, status)
│   ├── secrets.ts              ← Secret scanning (regex + Shannon entropy)
│   ├── baseline.ts             ← Test baselines, regression diffing
│   ├── flaky.ts                ← Flaky test tracker
│   ├── test-parser.ts          ← Parse Go/vitest/pytest output into results
│   ├── coverage.ts             ← Per-stack coverage, untested code detection
│   ├── impact.ts               ← Test impact analysis (source → test mapping)
│   ├── hooks.ts                ← Pre-commit hook install/signal
│   ├── agent.ts                ← Agent runner (Claude/Codex), SIGSTOP/CONT/KILL
│   ├── autofix.ts              ← Fix prompt builder, auto-fix loop
│   ├── blame.ts                ← Git blame for error root cause
│   ├── prompts.ts              ← Prompt templates (.gait/prompts/)
│   ├── diff-watcher.ts         ← Live diff polling during agent
│   ├── snapshot.ts             ← Snapshot/restore via git tags
│   ├── cost-tracker.ts         ← Agent cost estimation, budget enforcement
│   ├── linter-setup.ts         ← Per-stack linter config generation
│   ├── rollback.ts             ← Worktree-based revert simulation
│   ├── release.ts              ← Tag analysis, semver bump, execution
│   ├── semver.ts               ← Version parsing, conventional commits, changelog
│   ├── pr-generator.ts         ← PR summary generation, gh CLI integration
│   ├── workflow.ts             ← Multi-agent workflow runner
│   ├── scripts.ts              ← Script parser, runner, dependency resolution
│   ├── script-detect.ts        ← History pattern detection
│   ├── monorepo.ts             ← Workspace detection, affected-only scoping
│   ├── prereq.ts               ← Environment prerequisite checks
│   ├── recover.ts              ← Stale worktree/lockfile cleanup
│   ├── agentsmd.ts             ← AGENTS.md generator
│   ├── notify.ts               ← Slack/Discord/webhook notifications
│   ├── history.ts              ← JSONL action logger
│   ├── util.ts                 ← Duration parsing, formatting
│   └── util-glob.ts            ← Simple glob for workspace patterns
├── views/
│   ├── statusbar.ts            ← VS Code status bar badges
│   ├── sidebar.ts              ← 4 tree views (Pipeline, Scripts, Actions, Project)
│   └── dashboard.ts            ← Webview panel (HTML/CSS/state push)
└── webview/
    └── main.ts                 ← Dashboard UI (safe DOM, keyboard shortcuts)
```

---

## Development

```bash
npm install
npm run compile        # Build extension + webview
npm run watch          # Rebuild on change
npm run lint           # tsc --noEmit + eslint
npm test               # 181 tests across 28 files
npm run test:watch     # Watch mode
npm run package        # Minified build
```

Press **F5** to debug. Package with `npx @vscode/vsce package --no-dependencies`.

---

## License

MIT
