# HITL-Gate — User Guide

## What is HITL-Gate?

HITL-Gate sits between your AI coding agents (Claude Code, Codex) and your codebase. When an agent tries to write a file, HITL-Gate intercepts the action, evaluates how risky it is, and asks you to approve or reject it before it happens.

You stay in control. The agent proposes, you decide.

---

## Setup

### 1. Install the extension

```bash
# From source
git clone https://github.com/arodroz/gait.git && cd gait
npm install && npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension gait-quality-gate-0.4.0.vsix
```

Or press **F5** in the cloned repo to launch the Extension Development Host.

### 2. Initialize your project

Open your project in VS Code, then:

```
Cmd+Shift+P → HITL-Gate: Initialize Project
```

This creates `.gait/` in your project root with:
- `config.toml` — your configuration
- `pending/` — IPC: bridge writes here
- `decisions/` — IPC: extension writes here
- `diffs/` — stored patches
- `snapshots/` — git snapshot refs

### 3. Install Claude Code hooks

When prompted after init (or manually):

```
Cmd+Shift+P → HITL-Gate: Install Claude Code Hooks
```

This writes `.claude/settings.json` so Claude Code calls `hitlgate-bridge` before every file write. You can verify:

```bash
cat .claude/settings.json
```

You should see a `PreToolUse` hook pointing to `hitlgate-bridge.js`.

---

## How it works in practice

### With Claude Code

1. You give Claude Code a task: *"Add a POST /users endpoint"*
2. Claude starts writing files
3. **Before each file write**, Claude's hook calls `hitlgate-bridge`
4. The bridge writes a pending action to `.gait/pending/`
5. HITL-Gate's interceptor detects it, evaluates it, and shows you a prompt
6. You accept or reject
7. The bridge reads your decision and tells Claude to proceed or stop

### What you see

Depending on how risky the action is, you'll see one of three things:

**Low severity** (e.g., editing a utility file with no API changes):
> A toast notification in the bottom-right. Auto-accepts after 10 seconds unless you click "Reject".

**Medium severity** (e.g., changing an exported interface):
> A warning message with "Accept", "Reject", and "Reject with Note" buttons. No auto-accept — you must decide.

**High severity** (e.g., deleting a file, modifying a production path):
> A blocking modal dialog. Nothing proceeds until you explicitly click Accept or Reject.

### With Codex

```
Cmd+Shift+P → HITL-Gate: Run Codex Task
```

Enter a task description. HITL-Gate wraps the Codex CLI, intercepts its approval prompts, and routes them through the same evaluation system.

---

## Configuration

Edit `.gait/config.toml`:

### Mode

```toml
[project]
name = "my-project"
mode = "dev"    # or "prod"
```

- **`dev`** — low-severity actions auto-accept after timeout, medium/high require approval
- **`prod`** — nothing auto-accepts, every action requires explicit approval

### Production paths

```toml
[prod]
paths = [
  "src/api/**",
  "src/db/**",
  "migrations/**",
  "*.config.ts"
]
```

Any file matching these globs triggers **high severity** — always a blocking modal, always requires explicit approval.

### Auto-accept behavior

```toml
[interception]
auto_accept_low = true          # toast auto-accepts after timeout
auto_accept_timeout_ms = 10000  # 10 seconds
```

Set `auto_accept_low = false` to require approval for everything, even low-severity actions.

### Reviewer

```toml
[reviewer]
enabled = true
on_severity = ["medium", "high"]
timeout_ms = 8000
```

The reviewer calls the *other* agent's API to analyze the action. Set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in your environment. If keys aren't available, the reviewer is skipped gracefully — you can still accept/reject manually.

### Decision point toggles

```toml
[decision_points]
interface_change = true
file_deleted = true
file_renamed = true
schema_change = true
cross_agent_conflict = true
intent_drift = true
public_api_change = true
cross_agent_conflict_window_s = 14400  # 4 hours
```

If a detector produces too many false positives, set it to `false`.

---

## What gets detected

| Detection | What triggers it | Weight |
|-----------|-----------------|--------|
| **interface_change** | An exported function/class signature was modified (not just the body) | medium |
| **public_api_change** | An exported symbol was added or removed | medium |
| **file_deleted** | A file was removed | high |
| **file_renamed** | A file was moved/renamed | low |
| **schema_change** | A migration, `.sql`, `.graphql`, `.proto`, or schema file was modified | medium |
| **cross_agent_conflict** | The same file was modified by a different agent within the last 4 hours | medium |
| **prod_file** | A file matches one of your `[prod] paths` globs | high |

### Severity rules

- No detections → **low**
- 1 medium-weight detection → **medium**
- 1 high-weight detection, or 2+ medium-weight detections → **high**
- In `prod` mode: everything is at least **medium**, prod files are always **high**

---

## The cross-agent reviewer

When a medium or high severity action is detected, HITL-Gate fires a cross-agent review in parallel:

- If **Claude** wrote the code → **Codex** reviews it
- If **Codex** wrote the code → **Claude** reviews it

The reviewer uses a hardcoded adversarial prompt (cannot be changed by config or by agents) that looks for:
- Divergences between what the agent said it would do and what it actually did
- Risks, especially for production files
- A recommendation: accept, reject, or modify (with a specific suggestion)

The review result appears in the decision modal/panel before you decide. If the review takes too long (>8s), you can decide without it.

**Requires API keys:** Set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in your shell environment. If neither is set, the reviewer is skipped silently.

---

## Dashboard

```
Cmd+Shift+D → Open Dashboard
```

Two tabs:

**Dashboard** — Shows pending decision (if any), agent status, changed files, and event log. When a pending action arrives, the decision panel shows severity, intent, files, detection flags, reviewer analysis, and Accept/Reject buttons.

**Decisions** — History of recent decisions. Click a row to expand details. Keyboard: `J` for decisions tab, `D` for dashboard tab.

---

## Sidebar

The HITL-Gate activity bar (shield icon) has four sections:

- **Decisions** — Last 20 decisions with accept/reject icons, agent name, files
- **Quick Actions** — One-click access to common commands
- **Project** — Branch, status, mode, detected stacks
- **Agents** — Claude Code and Codex enabled/disabled status

---

## Decisions journal

```
Cmd+Shift+P → HITL-Gate: Open Decisions Journal
```

Browse all decisions with filters:
- All / Claude only / Codex only / Rejected only / High severity

Each entry shows: decision, agent, severity, files, intent, reviewer analysis, human notes.

### Export

```
Cmd+Shift+P → HITL-Gate: Export Journal as Markdown
```

Generates a markdown report with summary stats and per-decision details. Useful for audits or team reviews.

---

## Learned patterns

On extension startup, HITL-Gate scans your last 50 decisions. If the same directory has been rejected 3+ times, it surfaces a suggestion:

> *"HITL-Gate: 1 path pattern(s) frequently rejected. View suggestions?"*

Click "View" to see which paths to add to `[prod] paths` in your config.

---

## AGENTS.md generation

```
Cmd+Shift+P → HITL-Gate: Generate AGENTS.md
```

Creates an `AGENTS.md` file in your project root with:
- HITL-Gate mode and protected paths
- Recent rejection patterns (so agents learn from past rejections)
- Project conventions

Place this in your repo so agents read it as context.

---

## Gutter decorations

After an agent action is accepted, the modified lines get a colored gutter mark:
- **Blue (C)** — modified by Claude
- **Green (X)** — modified by Codex

Hover to see: agent name, when, intent, and human decision. Decorations clear on git commit.

---

## Snapshots and rollback

HITL-Gate takes git snapshots before agent sessions.

```
Cmd+Shift+P → HITL-Gate: Take Snapshot       # manual snapshot
Cmd+Shift+P → HITL-Gate: Restore Snapshot     # pick and restore
Cmd+Shift+P → HITL-Gate: Rollback Assistant   # revert a commit
```

---

## All commands

| Command | Description |
|---------|-------------|
| `Initialize Project` | Create `.gait/` config and directories |
| `Install Claude Code Hooks` | Wire Claude Code's PreToolUse hook |
| `Open Dashboard` | Webview with decisions, logs, history |
| `Run Agent` | Launch Claude or Codex with tracking |
| `Run Codex Task` | Run Codex CLI with interception |
| `Open Decisions Journal` | Browse/filter decision history |
| `Export Journal as Markdown` | Generate audit report |
| `AI Code Review` | Run AI review on current diff |
| `Generate AGENTS.md` | Create agent guidance file |
| `Take Snapshot` | Manual git snapshot |
| `Restore Snapshot` | Restore from snapshot list |
| `Rollback Assistant` | Simulate and apply commit revert |
| `Cost Summary` | Show token/cost tracking |
| `Edit Agent Memory` | Open context.md for editing |
| `View Memory` | Show formatted memory |
| `Environment Check` | Run prerequisite checks |
| `Recover (Cleanup)` | Clean up failed operations |
| `Run Workflow` | Execute multi-step workflow |

All commands are prefixed with `HITL-Gate:` in the command palette.

---

## Troubleshooting

**"No AI agents on PATH"** — Claude Code (`claude`) or Codex (`codex`) CLI must be installed and on your PATH.

**Reviewer shows "unavailable"** — Set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in your environment before launching VS Code.

**Hooks not triggering** — Run `HITL-Gate: Install Claude Code Hooks` again. Check `.claude/settings.json` exists with a `PreToolUse` entry.

**Actions auto-accepting too fast** — Increase `auto_accept_timeout_ms` in config, or set `auto_accept_low = false`.

**Too many false positives from a detector** — Disable it in `[decision_points]` section of config (e.g., `file_renamed = false`).

**Extension not activating** — HITL-Gate activates when `.gait/config.toml` exists. Run `Initialize Project` first.
