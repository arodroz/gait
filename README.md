<p align="center">
  <img src="https://img.shields.io/badge/gait-quality%20gate-7C3AED?style=for-the-badge&logo=shield&logoColor=white" alt="gait" />
</p>

<h3 align="center">Quality gate and pilot for AI coding agents</h3>

<p align="center">
  <em>Nothing ships without proof it doesn't break things.</em>
</p>

<p align="center">
  <a href="https://github.com/arodroz/gait/actions"><img src="https://img.shields.io/badge/tests-216%20passed-10B981?style=flat-square" alt="tests" /></a>
  <a href="https://github.com/arodroz/gait"><img src="https://img.shields.io/badge/modules-34-3B82F6?style=flat-square" alt="modules" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6B7280?style=flat-square" alt="license" /></a>
  <a href="https://code.visualstudio.com"><img src="https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC?style=flat-square&logo=visualstudiocode" alt="VS Code" /></a>
</p>

---

## What gait does

gait is a VS Code extension that runs your pipeline, watches your agents, and blocks bad code from shipping.

<table>
<tr>
<td width="50%">

**Gate** — lint, typecheck, test in dependency order with early abort. Secret scanning on every commit. Regression detection against per-branch baselines.

**Agents** — launch Claude or Codex from VS Code. Live token tracking, context bar, pause/resume/kill. Auto-gate after every agent session.

**Autofix** — failed stage? Click Fix. Agent gets the error, blame context, and source code. Auto-fix loop retries up to 3x.

</td>
<td width="50%">

**Review** — AI code review as a pipeline stage. Structured findings with severity levels. Squiggly lines in your editor.

**Memory** — agents remember your project: conventions, past corrections, "never do this" rules. Context persists across sessions.

**Workflows** — multi-agent orchestration. Define agent → gate → agent → gate pipelines in YAML. Snapshot before, restore on failure.

</td>
</tr>
</table>

---

## Quick Start

```bash
# Install from source
git clone https://github.com/arodroz/gait.git && cd gait
npm install && npm run compile
# Press F5 in VS Code to launch
```

Then:

```
Cmd+Shift+P → Gait: Initialize Project
Cmd+Shift+G → Run Quality Gate
```

`gait init` detects your stack, configures commands, creates scripts, sets up linters, generates prompt templates and example workflows. One command, everything ready.

---

## Features

### Pipeline

| Stage | What happens |
|-------|-------------|
| **Lint** | Runs your linter (eslint, go vet, ruff, swiftlint) |
| **Typecheck** | Type checker (tsc, go vet, mypy) |
| **Test** | Test suite with output parsing for regression detection |
| **Audit** | Dependency vulnerability scan (npm audit, pip-audit, go mod verify) |
| **Review** | AI code review with structured JSON findings |

Stages run in dependency order. First failure aborts. Profiles switch between **quick** (lint only) and **full** (everything).

### Agent Integration

```
Cmd+Shift+P → Gait: Run Agent
```

- Pick a **prompt template** or type custom
- **Snapshot** taken automatically before agent runs
- Dashboard shows: tokens, context %, elapsed, pause/resume/kill
- **Live diff** updates every 2s as agent writes code
- **Auto-gate** runs when agent finishes
- **Cost tracking** with daily budget enforcement
- **Memory** prepended to every prompt — agents get smarter over time

### Autofix

When a stage fails, the dashboard shows a **Fix** button:

- **Click** → scoped prompt (error + source + blame) → agent fixes → auto-gate
- **Shift+click** → auto-fix loop (3 attempts, no human in loop)
- **Config** → `autofix = true` makes it fully automatic

### More

| Feature | Description |
|---------|-------------|
| **Secret scanning** | AWS keys, tokens, private keys, high-entropy strings |
| **Pre-commit hook** | Gate runs before every commit, modal in dashboard |
| **Rollback** | Simulate revert in worktree, verify tests pass, then apply |
| **Release** | Conventional commits → semver bump → changelog → tag |
| **PR generator** | Structured PR body from git log, push + create via `gh` |
| **Regression detection** | Per-branch baselines, flaky test exemption |
| **Coverage detection** | Find untested functions in changed files |
| **Test generation** | Agent writes tests for uncovered code |
| **Monorepo** | Affected-only testing for go.work, npm workspaces, python |
| **Scripts** | `.gait/scripts/` with metadata headers and dependency resolution |
| **Notifications** | Slack, Discord, webhook on gate/agent/regression events |
| **Impact analysis** | Map source files → test files, log affected tests |
| **Hooks suite** | pre-commit, pre-push, post-merge, post-checkout |
| **AGENTS.md** | Auto-generated agent instructions from config |
| **Environment check** | Verify required tools are on PATH |

---

## Commands

29 commands via `Cmd+Shift+P`:

<details>
<summary><b>Pipeline & Gate</b></summary>

| Command | Keybinding |
|---------|-----------|
| Gait: Initialize Project | — |
| Gait: Run Quality Gate | `Cmd+Shift+G` |
| Gait: Run Lint | — |
| Gait: Run Tests | — |
| Gait: Run Typecheck | — |
| Gait: Run Build | — |
| Gait: Switch Pipeline Profile | — |
| Gait: AI Code Review | — |
| Gait: Audit Dependencies | — |

</details>

<details>
<summary><b>Agents & AI</b></summary>

| Command | Description |
|---------|-------------|
| Gait: Run Agent | Launch Claude/Codex with template picker |
| Gait: Edit Agent Memory | Open `.gait/context.md` |
| Gait: View Memory | Show corrections, patterns, rules |
| Gait: Generate Tests for File | Agent writes tests for uncovered code |
| Gait: Cost Summary | Daily/weekly/monthly spend |

</details>

<details>
<summary><b>Git & Release</b></summary>

| Command | Description |
|---------|-------------|
| Gait: Install Pre-Commit Hook | Gate before commits |
| Gait: Install All Hooks | pre-commit + pre-push + post-merge + post-checkout |
| Gait: Manage Hooks | Toggle individual hooks |
| Gait: Rollback Assistant | Simulate revert in worktree |
| Gait: Release | Semver bump + changelog + tag |
| Gait: Create Pull Request | Generate + push + `gh pr create` |
| Gait: Take Snapshot | Manual working tree snapshot |
| Gait: Restore Snapshot | Pick and restore |

</details>

<details>
<summary><b>Tools</b></summary>

| Command | Description |
|---------|-------------|
| Gait: Open Dashboard | `Cmd+Shift+D` |
| Gait: Run Script | Execute `.gait/scripts/*.sh` |
| Gait: List Scripts | Show all with metadata |
| Gait: Detect Script Patterns | Find repeated commands → save as scripts |
| Gait: Run Workflow | Multi-agent orchestration |
| Gait: Generate AGENTS.md | Agent instructions from config |
| Gait: Environment Check | Verify tools on PATH |
| Gait: Recover | Clean stale worktrees/locks |

</details>

---

## Configuration

```toml
[project]
name = "myproject"

[stacks.typescript]
Lint = "npx eslint src/"
Test = "npx vitest run"
Typecheck = "npx tsc --noEmit"
Build = "npm run build"

[pipeline]
stages = ["lint", "typecheck", "test", "audit", "review"]
timeout = "300s"
autofix = true
autofix_agent = "claude"
daily_budget_usd = 10.00
commit_profile = "full"

[review]
agent = "claude"
block_on = "error"

[notifications]
slack_webhook = "https://hooks.slack.com/..."
events = ["gate.failed", "regression.detected"]
```

<details>
<summary><b>.gait/ directory structure</b></summary>

| Path | Git | Purpose |
|------|-----|---------|
| `config.toml` | committed | All configuration |
| `scripts/*.sh` | committed | Repeatable operations |
| `prompts/*.md` | committed | Agent prompt templates |
| `workflows/*.yaml` | committed | Multi-agent workflows |
| `context.md` | committed | Agent project context |
| `.gitignore` | committed | State file exclusions |
| `baseline_*.json` | gitignored | Test baselines per branch |
| `flaky.json` | gitignored | Flaky test tracking |
| `costs.json` | gitignored | Agent cost data |
| `impact-map.json` | gitignored | Test impact mapping |
| `snapshots.json` | gitignored | Snapshot index |
| `memory.json` | gitignored | Agent corrections/patterns |
| `history/*.jsonl` | gitignored | Action log |

</details>

---

## Architecture

```
src/
├── extension.ts              ← 29 commands, lifecycle, event wiring
├── core/                     ← 34 modules
│   ├── pipeline.ts           ← Stage runner, topo-sort, early abort
│   ├── runner.ts             ← Shell executor (spawn + escape + timeout)
│   ├── config.ts             ← TOML config, stack detection
│   ├── agent.ts              ← Claude/Codex, SIGSTOP/CONT/KILL
│   ├── autofix.ts            ← Fix prompt builder, auto-fix loop
│   ├── review.ts             ← AI code review, JSON finding parser
│   ├── memory.ts             ← Persistent agent context + corrections
│   ├── blame.ts              ← Git blame for error root cause
│   ├── secrets.ts            ← Regex + Shannon entropy scanning
│   ├── baseline.ts           ← Test baselines, regression diffing
│   ├── coverage.ts           ← Per-stack coverage detection
│   ├── dep-audit.ts          ← npm/go/python vulnerability audit
│   ├── snapshot.ts           ← Git tag snapshots, restore, prune
│   ├── profiles.ts           ← Pipeline profiles (quick/full)
│   ├── prompts.ts            ← Template parser, variable interpolation
│   ├── workflow.ts           ← Multi-agent YAML workflows
│   ├── cost-tracker.ts       ← Token/cost estimation, budget
│   ├── pr-generator.ts       ← PR summary, gh CLI integration
│   ├── notify.ts             ← Slack/Discord/webhook notifications
│   ├── ...                   ← + 15 more (git, hooks, scripts, etc.)
│
├── views/
│   ├── statusbar.ts          ← Status bar badges
│   ├── sidebar.ts            ← 4 tree views
│   └── dashboard.ts          ← Webview panel
│
└── webview/
    └── main.ts               ← Dashboard UI (safe DOM)
```

---

## Development

```bash
npm install              # dependencies
npm run compile          # build extension + webview
npm run lint             # tsc + eslint
npm test                 # 216 tests / 33 files
npm run watch            # rebuild on change
```

Press **F5** to debug. Package: `npx @vscode/vsce package --no-dependencies`

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with Claude Opus 4.6 &middot; <a href="https://github.com/arodroz/gait">github.com/arodroz/gait</a></sub>
</p>
