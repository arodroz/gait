# Spec — Webview UI (Decision Panel)

## Context

The existing `DashboardPanel` webview in `src/views/dashboard.ts` and `src/webview/main.ts` is adapted — not rewritten. The quality gate UI sections are replaced with the decision UI.

## New webview state fields

Add to the existing state object sent to the webview:

```typescript
interface WebviewState {
  // ... existing fields kept ...
  
  // New: pending decision awaiting human response
  pendingDecision?: {
    action: PendingAction
    evaluation: EvaluationResult
    reviewerAnalysis: ReviewerAnalysis | null
    reviewerLoading: boolean    // true while reviewer is in flight
  }
  
  // New: recent decisions for the history tab
  recentDecisions: ActionRecord[]
}
```

## New webview messages (webview → extension)

```typescript
// Human made a decision
{ command: 'decision', data: { id: string, decision: 'accept' | 'reject' | 'edit', note?: string } }

// Human clicked "View full diff"
{ command: 'openDiff', data: string }  // file path

// Human clicked "Edit prompt" — extension opens input box
{ command: 'editPrompt', data: string }  // action id
```

## Decision panel layout

When `pendingDecision` is set, the dashboard shows the decision view as the primary content:

```
┌─────────────────────────────────────────────────┐
│  ⚡ Action Pending Review                        │
│  claude · Edit · 2 files                         │
├─────────────────────────────────────────────────┤
│  INTENT                                          │
│  "Add POST /users route with validation"         │
├─────────────────────────────────────────────────┤
│  FILES                                           │
│  📄 src/api/routes.ts          +47 -12           │
│  📄 src/middleware/auth.ts     +8  -0   ⚠️       │
├─────────────────────────────────────────────────┤
│  DECISION POINTS                                 │
│  ⚠️ interface_change  Exported interface changed  │
│  🔴 prod_file         Production file            │
├─────────────────────────────────────────────────┤
│  REVIEWER (codex) ●●●●○  high confidence        │
│  ┌──────────────────────────────────────────┐   │
│  │ ⚠ DIVERGENCE: You asked for a new route, │   │
│  │   but auth middleware was also modified.  │   │
│  │                                           │   │
│  │ RISK: Middleware change affects ALL       │   │
│  │       existing routes.                    │   │
│  │                                           │   │
│  │ → REJECT — ask agent to scope changes     │   │
│  │   to new route only                       │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│  [View Diff]  [Accept ✓]  [Reject ✗]  [Edit →]  │
└─────────────────────────────────────────────────┘
```

### Reviewer loading state

While reviewer is in flight, show in the reviewer section:
```
│  REVIEWER (codex)  ⏳ Analyzing...               │
```

When reviewer resolves, update in-place (no panel close/reopen).

### Decision point icons

```typescript
const POINT_ICONS: Record<DecisionPoint, string> = {
  interface_change: '⚠️',
  file_deleted: '🗑️',
  file_renamed: '✏️',
  schema_change: '🗄️',
  cross_agent_conflict: '⚡',
  prod_file: '🔴',
  intent_drift: '🎯',
  public_api_change: '📤',
}
```

### Confidence indicator

Reviewer confidence shown as filled/empty dots:
- `low` → `●○○`
- `medium` → `●●○`  
- `high` → `●●●`

### Recommendation badge colors

- `accept` → green background
- `reject` → red background
- `modify` → orange background

## History tab

A second tab in the dashboard: "Decisions"

Shows `recentDecisions` as a scrollable list:

```
✓ accept  claude  src/api/routes.ts      2 min ago
✗ reject  codex   src/db/schema.ts       1 hour ago  "scope too broad"
✓ accept  claude  src/utils/format.ts    3 hours ago
```

Click on a row → expand to show full details (intent, reviewer analysis, human note).

## CSS approach

Use CSS variables for theming (already done in fork). Key new variables:

```css
--hitlgate-claude: #6495ED;
--hitlgate-codex: #50B478;
--hitlgate-accept: #4CAF50;
--hitlgate-reject: #f44336;
--hitlgate-modify: #FF9800;
--hitlgate-warning: #FF9800;
--hitlgate-critical: #f44336;
```

Use `var(--vscode-*)` variables for all background/text colors to respect VS Code themes.

## Webview message handler additions (extension side)

In `extension.ts` `state.dashboard.onAction()`:

```typescript
case 'decision': {
  const { id, decision, note } = msg.data
  // Write decision file
  const decisionPath = path.join(config.gaitDir(state.cwd), 'decisions', `${id}.json`)
  await fs.promises.writeFile(decisionPath, JSON.stringify({
    id, decision, note, ts: new Date().toISOString()
  }))
  // Clear pending decision from state
  state.dashboard.updateState({ pendingDecision: undefined })
  break
}

case 'editPrompt': {
  const note = await vscode.window.showInputBox({
    prompt: 'Add a note for the agent (will be included in rejection message)',
    placeHolder: 'Scope changes to the new route only, do not modify existing middleware'
  })
  // Write reject decision with note
  const decisionPath = path.join(config.gaitDir(state.cwd), 'decisions', `${msg.data}.json`)
  await fs.promises.writeFile(decisionPath, JSON.stringify({
    id: msg.data, decision: 'reject', note, ts: new Date().toISOString()
  }))
  state.dashboard.updateState({ pendingDecision: undefined })
  break
}
```
