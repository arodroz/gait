# HITL-Gate — Architecture

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Workspace (git repo)                      │
│                                                                   │
│   Claude Code                    Codex CLI                       │
│       │                              │                           │
│       │ PreToolUse hook              │ --approval-mode=suggest   │
│       │                              │                           │
│       ▼                              ▼                           │
│  hitlgate-bridge              codex-bridge.ts                    │
│  (writes pending file)        (intercepts confirm prompt)        │
│       │                              │                           │
│       └──────────────┬───────────────┘                          │
│                      │                                           │
│              .gait/pending/<id>.json                             │
│                      │                                           │
│                      ▼                                           │
│            ┌─────────────────┐                                   │
│            │   interceptor   │  ◄── FileSystemWatcher            │
│            │   (extension)   │                                   │
│            └────────┬────────┘                                   │
│                     │                                            │
│          ┌──────────┼──────────┐                                 │
│          │          │          │                                  │
│   decision-     action-    reviewer                              │
│   points.ts    logger.ts    .ts                                  │
│          │          │          │                                  │
│          └──────────┴──────────┘                                 │
│                     │                                            │
│              EvaluationResult                                    │
│                     │                                            │
│         ┌───────────┼────────────┐                              │
│         │           │            │                               │
│    severity:    severity:    severity:                           │
│      low         medium        high                              │
│         │           │            │                               │
│   notification   panel       modal                               │
│   (auto-accept   (sidebar,   (blocking,                          │
│    after 10s)    pausable)    explicit)                          │
│         │           │            │                               │
│         └───────────┴────────────┘                              │
│                     │                                            │
│              Human decision                                      │
│           accept / reject / edit                                 │
│                     │                                            │
│              .gait/decisions/<id>.json                           │
│                     │                                            │
│         ┌───────────┴────────────┐                              │
│         │                        │                               │
│   hitlgate-bridge          codex-bridge                          │
│   reads decision,          reads decision,                       │
│   returns to Claude        returns to Codex                      │
│                                                                   │
│   decorations.ts ──► inline gutter marks in editor              │
└─────────────────────────────────────────────────────────────────┘
```

## Module map

### `src/core/`

| Module | Role | Status |
|--------|------|--------|
| `config.ts` | TOML config loader | ✓ keep from fork |
| `git.ts` | git diff, blame, status | ✓ keep from fork |
| `snapshot.ts` | pre-session snapshots | ✓ keep from fork |
| `util.ts` | helpers (parseDuration etc.) | ✓ keep from fork |
| `cost-tracker.ts` | token/cost estimation | ~ absorb into action-logger |
| `interceptor.ts` | FileSystemWatcher on pending/, orchestrates evaluation | ★ new |
| `decision-points.ts` | diff analysis → DecisionPoint[] + severity | ★ new |
| `reviewer.ts` | cross-agent adversarial review via API | ★ new |
| `action-logger.ts` | append-only JSONL log of all actions | ★ new |

### `src/agents/`

| Module | Role | Status |
|--------|------|--------|
| `claude-hooks.ts` | generates .claude/settings.json hooks config | ★ new |
| `codex-bridge.ts` | wraps codex invocation, intercepts approval prompts | ★ new |

### `src/bridge/`

| Module | Role | Status |
|--------|------|--------|
| `hitlgate-bridge.ts` | standalone Node script, installed by extension, called by Claude Code hooks | ★ new |

### `src/views/`

| Module | Role | Status |
|--------|------|--------|
| `statusbar.ts` | status bar indicator | ~ adapt messages |
| `sidebar.ts` | tree views (remove pipeline tree, add decisions tree) | ~ adapt |
| `dashboard.ts` | webview panel — adapt for decision UI | ~ adapt |
| `decorations.ts` | inline gutter marks per agent | ★ new |

### `src/commands/`

| Module | Role | Status |
|--------|------|--------|
| `helpers.ts` | shared utilities | ✓ keep |
| `init.ts` | initialize project — adapt for new config schema | ~ adapt |
| `decision.ts` | accept/reject/edit commands | ★ new |
| `misc.ts` | snapshot, rollback, preflight — keep, trim bloat | ~ adapt |
| `hooks.ts` | install hooks — repurpose for claude-hooks | ~ adapt |

## IPC protocol (Claude Code ↔ Extension)

### Pending file — written by `hitlgate-bridge`

Path: `.gait/pending/<id>.json`

```typescript
interface PendingAction {
  id: string                    // "act_<timestamp>_<random4>"
  agent: "claude" | "codex"
  session_id: string            // from CLAUDE_SESSION_ID env or generated
  tool: string                  // "Edit" | "Write" | "MultiEdit" | "Bash"
  files: string[]               // relative paths
  intent: string                // extracted from agent reasoning/output
  diff_preview?: string         // unified diff, max 200 lines
  session_context?: string      // last user message / task description
  ts: string                    // ISO timestamp
}
```

### Decision file — written by extension

Path: `.gait/decisions/<id>.json`

```typescript
interface DecisionResult {
  id: string
  decision: "accept" | "reject" | "edit"
  note?: string                 // human's optional note
  reviewer_analysis?: ReviewerAnalysis
  ts: string
}
```

### Bridge behavior

```
hitlgate-bridge:
  1. Receives action context via stdin (JSON from Claude Code hook)
  2. Writes .gait/pending/<id>.json
  3. Polls .gait/decisions/<id>.json every 200ms
  4. Timeout: 120s (configurable) → auto-reject on timeout
  5. On decision found: exit 0 (accept) or exit 2 (reject, stderr = note)
  6. Cleans up pending file on exit
```

## Severity → presentation mapping

| Severity | Presentation | Auto-accept | Blocks editor |
|----------|-------------|-------------|---------------|
| `low` | Toast notification | Yes, after 10s | No |
| `medium` | Panel opens | No | No (sidebar) |
| `high` | Modal dialog | Never | Yes (modal) |
| any + mode=prod | Modal dialog | Never | Yes (modal) |

## Data directory layout

```
.gait/
├── config.toml          # project config — committed
├── actions.jsonl        # action log — gitignored by default, opt-in to commit
├── pending/             # IPC: bridge → extension — gitignored
├── decisions/           # IPC: extension → bridge — gitignored
├── diffs/               # stored patches — gitignored
│   └── act_<id>.patch
└── snapshots/           # git snapshot refs — gitignored
    └── index.json       # maps snapshot ids to git refs
```

`.gitignore` additions (written by `gait.init`):
```
.gait/pending/
.gait/decisions/
.gait/diffs/
.gait/snapshots/
# optionally keep actions.jsonl for team audit trail
```

## State additions (state.ts)

New fields to add to the existing state object:

```typescript
// Add to existing state
pendingActions: Map<string, PendingAction>   // currently awaiting decision
decisionHistory: ActionRecord[]              // last N decisions for UI
activeDecorations: Map<string, vscode.TextEditorDecorationType>
interceptorWatcher?: vscode.FileSystemWatcher
reviewerInFlight: Set<string>               // action ids currently being reviewed
```

## Extension activation changes

The extension already activates on `workspaceContains:.gait/config.toml`.

On activation, add:
1. Start `interceptor.ts` — sets up FileSystemWatcher on `.gait/pending/`
2. Register `decorations.ts` — set up decoration types
3. Register new commands from `decision.ts`
4. Remove registrations for gate/pipeline/release commands

## Dependencies to add

```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "openai": "^4.77.0"
}
```

Both are used only in `reviewer.ts` for API calls. Tree-shaken by esbuild.
