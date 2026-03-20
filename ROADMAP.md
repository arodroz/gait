# gait — Roadmap v0.3.0

> 10 features, ordered by dependency and value. Each builds on existing infrastructure.

---

## Phase 1 — Foundation (enables everything else)

### 1. Snapshot & Restore
**Why first**: Every other feature involves agents modifying code. Safe undo must exist before adding more agent autonomy.

**What**:
- Before any agent session, auto-stash or create a lightweight tag `gait/snapshot/<timestamp>`
- Dashboard shows "Restore" button next to agent panel
- One click → hard reset to snapshot → working tree is exactly as it was
- Auto-cleanup: snapshots older than 24h are pruned

**Files**: `src/core/snapshot.ts`, wire into agent start/done in `extension.ts`

**Config**:
```toml
[agent]
auto_snapshot = true
snapshot_retention = "24h"
```

---

### 2. Pipeline Profiles
**Why early**: Quick/full modes affect how every subsequent feature runs the gate.

**What**:
- Define named profiles in config: `quick` (lint only), `full` (lint + typecheck + test + coverage)
- Dashboard toggle: Quick / Full
- Default: `quick` during dev, `full` on commit (pre-commit hook always uses full)
- Agent auto-pipeline uses `quick` for speed, final check uses `full`

**Files**: `src/core/profiles.ts`, update `pipeline.ts` + `extension.ts`

**Config**:
```toml
[pipeline.profiles.quick]
stages = ["lint"]
timeout = "30s"

[pipeline.profiles.full]
stages = ["lint", "typecheck", "test"]
timeout = "300s"

[pipeline]
default_profile = "quick"
commit_profile = "full"
```

---

## Phase 2 — Agent Intelligence

### 3. Prompt Templates
**Why**: Standardizes agent interactions. Teams share proven prompts instead of typing ad-hoc.

**What**:
- `.gait/prompts/*.md` with frontmatter: `name`, `description`, `variables`
- Variables: `{{file}}`, `{{error}}`, `{{diff}}`, `{{branch}}`, `{{stage}}`
- Quick pick to select template, variables auto-filled from context
- Built-in defaults: `fix-lint.md`, `fix-test.md`, `add-tests.md`, `refactor.md`
- `gait init` creates default prompts

**Files**: `src/core/prompts.ts`, update `cmdRunAgent` + `cmdFixStage`

**Template example**:
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

---

### 4. Blame-Aware Fix Routing
**Why**: Makes autofix dramatically more accurate by scoping to the exact commit that caused the problem.

**What**:
- On regression or test failure, `git blame` the failing lines
- Identify the commit that introduced the breakage
- Include that commit's diff in the fix prompt (not the whole file)
- Dashboard shows "Introduced by: `abc123` — John, 2h ago"
- Fix prompt targets the specific change, not the whole file

**Files**: `src/core/blame.ts`, update `autofix.ts`

**Depends on**: #3 (uses prompt templates for the fix)

---

### 5. Live Agent Diff Preview
**Why**: Visibility into what the agent is doing in real time — the core "pilot" experience.

**What**:
- New dashboard section: "Agent Changes" (between agent panel and files)
- As agent writes, poll `git diff` every 2s and render syntax-highlighted diff
- File tabs: click to see per-file diff
- Red/green line-level diff, auto-scroll to latest change
- Pause button freezes the diff view (agent keeps running)

**Files**: `src/core/diff-watcher.ts`, new webview component, update agent event wiring

**Depends on**: Existing agent integration + file watcher

---

## Phase 3 — Efficiency

### 6. Test Impact Analysis
**Why**: Running 139 tests when you changed one file is wasteful. This makes the gate 10x faster during dev.

**What**:
- Build a coverage map: which test files exercise which source files
- On file change, compute the minimal test set
- Dashboard shows: "3 of 18 test files affected"
- Quick profile uses impact analysis, full profile runs everything
- Coverage map rebuilds on full gate runs, cached in `.gait/impact-map.json`

**Files**: `src/core/impact.ts`, update `pipeline.ts` to accept scoped test commands

**Depends on**: #2 (pipeline profiles — quick mode uses impact analysis)

**Config**:
```toml
[pipeline]
use_impact_analysis = true
```

---

### 7. Cost Tracker
**Why**: Agents cost money. Teams need visibility and guardrails.

**What**:
- Parse agent output for token/cost hints (Claude prints usage at the end)
- Track per-session: tokens in/out, estimated cost, duration
- Daily/weekly/monthly aggregates in `.gait/costs.json`
- Dashboard widget: "Today: $2.40 / $10.00 budget"
- Budget alerts: warn at 80%, block at 100%
- History: cost per session in JSONL

**Files**: `src/core/cost-tracker.ts`, update agent panel in webview

**Config**:
```toml
[agent]
daily_budget_usd = 10.00
warn_at_pct = 80
```

---

## Phase 4 — Team & Workflow

### 8. PR Summary Generator
**Why**: After an agent session (or manual work), creating the PR is manual and tedious.

**What**:
- Command: "Gait: Create PR"
- Gathers: git log since branch point, diff stats, gate results, changelog, agent session summaries
- Generates structured PR body (summary, changes, test results, semver impact)
- Opens in editor for review/edit
- Creates PR via `gh pr create` on confirm
- Dashboard button: "Create PR" (appears when branch != main and gate passed)

**Files**: `src/core/pr-generator.ts`, new command in `extension.ts`

**Depends on**: #7 (includes cost in PR summary), existing semver/changelog

---

### 9. Multi-Agent Orchestration
**Why**: Complex tasks benefit from specialization — one agent writes code, another writes tests.

**What**:
- `.gait/workflows/*.yaml` define agent pipelines:
  ```yaml
  name: implement-feature
  steps:
    - agent: claude
      prompt: "Implement: {{task}}"
    - command: gait gate --profile quick
    - agent: claude
      prompt: "Write tests for the changes"
    - command: gait gate --profile full
  ```
- Command: "Gait: Run Workflow"
- Dashboard shows workflow progress: step 2/4, current agent, gate status
- Steps can depend on previous outputs
- Abort stops the whole workflow and restores snapshot

**Files**: `src/core/workflow.ts`, `src/core/workflow-runner.ts`

**Depends on**: #1 (snapshot), #2 (profiles), #3 (prompt templates)

---

### 10. Notification Hooks
**Why**: Teams need visibility without watching VS Code. CI/CD integration.

**What**:
- Config-driven webhooks for gate/agent/release events
- Slack: formatted message with stage results, timing, diff stats
- Discord: same format
- Generic webhook: POST JSON payload
- Events: `gate.passed`, `gate.failed`, `agent.done`, `release.tagged`, `regression.detected`

**Files**: `src/core/notify.ts`, hook into gate/agent/release flows

**Config**:
```toml
[notifications]
slack_webhook = "https://hooks.slack.com/..."
events = ["gate.failed", "regression.detected", "release.tagged"]

[notifications.discord]
webhook = "https://discord.com/api/webhooks/..."
events = ["gate.failed"]
```

---

## Dependency Graph

```
Phase 1 (foundation):
  1. Snapshot ─────────────────────────────┐
  2. Profiles ──────────────┐              │
                            │              │
Phase 2 (agent intelligence):              │
  3. Prompt Templates ──────┤              │
  4. Blame-Aware Fix ───────┤ (uses #3)    │
  5. Live Agent Diff ───────┘              │
                                           │
Phase 3 (efficiency):                      │
  6. Test Impact ──── (uses #2)            │
  7. Cost Tracker                          │
                                           │
Phase 4 (team & workflow):                 │
  8. PR Generator ─── (uses #7)            │
  9. Multi-Agent ──── (uses #1, #2, #3)  ──┘
  10. Notifications
```

## Estimated Effort

| # | Feature | New files | Complexity | Depends on |
|---|---------|-----------|------------|------------|
| 1 | Snapshot & Restore | 1 | Low | — |
| 2 | Pipeline Profiles | 1 | Low | — |
| 3 | Prompt Templates | 1 | Medium | — |
| 4 | Blame-Aware Fix | 1 | Medium | #3 |
| 5 | Live Agent Diff | 2 | Medium | — |
| 6 | Test Impact Analysis | 1 | High | #2 |
| 7 | Cost Tracker | 1 | Medium | — |
| 8 | PR Summary Generator | 1 | Medium | #7 |
| 9 | Multi-Agent Orchestration | 2 | High | #1, #2, #3 |
| 10 | Notification Hooks | 1 | Low | — |
