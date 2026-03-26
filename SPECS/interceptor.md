# Spec — interceptor.ts

## Responsibility

The interceptor is the orchestration hub. It:
1. Watches `.gait/pending/` for new files written by `hitlgate-bridge` or `codex-bridge`
2. Parses the pending action
3. Takes a git snapshot (if configured)
4. Evaluates decision points
5. Fires reviewer (non-blocking, in parallel with UI)
6. Presents the appropriate UI based on severity
7. Waits for human decision (or auto-accepts)
8. Writes the decision file
9. Logs the action record

## Module interface

```typescript
export class Interceptor {
  constructor(
    private readonly workspaceRoot: string,
    private readonly gaitDir: string,
    private readonly config: HitlConfig,
    private readonly logger: ActionLogger,
    private readonly reviewer: Reviewer,
    private readonly onDecision: (result: DecisionResult) => void
  ) {}

  start(): vscode.Disposable    // starts the FileSystemWatcher
  stop(): void
  
  // For manual testing / Codex bridge integration
  async processAction(action: PendingAction): Promise<DecisionResult>
}
```

## FileSystemWatcher setup

```typescript
start(): vscode.Disposable {
  const pendingDir = path.join(this.gaitDir, 'pending')
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(pendingDir, '*.json')
  )
  watcher.onDidCreate(uri => this.onPendingFile(uri))
  return watcher
}
```

## `processAction()` flow

```
1. Read and parse PendingAction from file (or parameter)

2. If config.snapshots.auto_snapshot AND action.tool matches Edit/Write/MultiEdit:
     snapshot.create(workspaceRoot, gaitDir)
     → store ref in action record

3. Read recent actions from logger (last 200 records) for cross_agent_conflict detection

4. Call decision-points.evaluate(action, config, recentActions)
   → EvaluationResult

5. If EvaluationResult.requires_cross_review:
     Fire reviewer.review() as a Promise (do NOT await)
     Store the Promise in state.reviewerInFlight

6. Show UI based on EvaluationResult.presentation:
     "notification" → showNotificationDecision()
     "panel"        → showPanelDecision()
     "modal"        → showModalDecision()

7. Wait for decision (each show* function returns Promise<DecisionResult>)
   Meanwhile, if reviewer resolves before human decides:
     → update the panel with reviewer analysis (if panel is open)

8. Write decision to .gait/decisions/<id>.json

9. Append ActionRecord to logger

10. Update decorations (via state.decorations)

11. Return DecisionResult
```

## `showNotificationDecision()`

```typescript
private async showNotificationDecision(
  action: PendingAction,
  evaluation: EvaluationResult
): Promise<DecisionResult> {
  const label = `[${action.agent}] ${action.intent ?? action.tool} — ${action.files.slice(0, 2).join(', ')}${action.files.length > 2 ? ` +${action.files.length - 2}` : ''}`
  
  // Show notification, start auto-accept timer
  let resolved = false
  
  const notifPromise = vscode.window.showInformationMessage(label, 'View', 'Undo')
  
  const autoAcceptPromise = new Promise<"auto_accept">(resolve => {
    setTimeout(() => {
      if (!resolved) resolve("auto_accept")
    }, this.config.interception.auto_accept_timeout_ms)
  })
  
  const result = await Promise.race([notifPromise, autoAcceptPromise])
  resolved = true
  
  if (result === 'Undo') {
    // Restore from snapshot if available
    await this.handleUndo(action)
    return { id: action.id, decision: "reject", ts: new Date().toISOString() }
  }
  
  return {
    id: action.id,
    decision: result === "auto_accept" ? "auto_accept" : "accept",
    ts: new Date().toISOString()
  }
}
```

## `showPanelDecision()`

```typescript
private async showPanelDecision(
  action: PendingAction,
  evaluation: EvaluationResult,
  reviewerPromise: Promise<ReviewerAnalysis> | null
): Promise<DecisionResult> {
  // Open dashboard panel
  state.dashboard.open()
  
  // Send initial decision request to webview
  state.dashboard.updateState({
    pendingDecision: {
      action,
      evaluation,
      reviewerAnalysis: null,  // will update when reviewer resolves
    }
  })
  
  // If reviewer is running, update panel when it resolves
  if (reviewerPromise) {
    reviewerPromise.then(analysis => {
      state.dashboard.updateState({
        pendingDecision: {
          action,
          evaluation,
          reviewerAnalysis: analysis,
        }
      })
    }).catch(() => {
      // Reviewer failed — panel already open, just no analysis
    })
  }
  
  // Wait for human decision via dashboard message
  return new Promise(resolve => {
    const unsub = state.dashboard.onAction(msg => {
      if (msg.command === 'decision' && msg.data?.id === action.id) {
        unsub()
        resolve({
          id: action.id,
          decision: msg.data.decision,
          note: msg.data.note,
          ts: new Date().toISOString()
        })
      }
    })
  })
}
```

## `showModalDecision()`

```typescript
private async showModalDecision(
  action: PendingAction,
  evaluation: EvaluationResult
): Promise<DecisionResult> {
  // Wait briefly for reviewer (max 3s for modal — user is waiting)
  let reviewerAnalysis: ReviewerAnalysis | null = null
  if (state.reviewerInFlight.has(action.id)) {
    reviewerAnalysis = await Promise.race([
      state.reviewerInFlight.get(action.id)!,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
    ]).catch(() => null)
  }
  
  const points = evaluation.points.map(p => `• ${DECISION_POINT_LABELS[p]}`).join('\n')
  const reviewerSummary = reviewerAnalysis
    ? `\n\nReviewer (${reviewerAnalysis.reviewerAgent}): ${reviewerAnalysis.recommendation.toUpperCase()} — ${reviewerAnalysis.divergences[0] ?? 'no divergences'}`
    : ''
  
  const message = [
    `${action.agent === 'claude' ? 'Claude' : 'Codex'} wants to modify: ${action.files.join(', ')}`,
    `\nIntent: ${action.intent ?? '(not stated)'}`,
    `\nFlags: ${evaluation.points.join(', ')}`,
    reviewerSummary
  ].join('')
  
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Accept', 'Reject'
  )
  
  return {
    id: action.id,
    decision: choice === 'Accept' ? 'accept' : 'reject',
    reviewer_analysis: reviewerAnalysis ?? undefined,
    ts: new Date().toISOString()
  }
}
```

## Decision point labels (for UI display)

```typescript
export const DECISION_POINT_LABELS: Record<DecisionPoint, string> = {
  interface_change: "Exported interface changed",
  file_deleted: "File deleted",
  file_renamed: "File renamed",
  schema_change: "Schema or migration modified",
  cross_agent_conflict: "Same file modified by other agent recently",
  prod_file: "Production file",
  intent_drift: "Agent action may diverge from your request",
  public_api_change: "Public API symbol added or removed",
}
```

## Concurrency note

Multiple agents can be running simultaneously. The interceptor must handle concurrent pending files. Each action is processed independently — the `processAction` method is re-entrant. The `state.reviewerInFlight` map is keyed by action id, no collision possible.

If two high-severity modals would appear simultaneously (unlikely but possible): queue them — show one, wait for decision, then show the next.
