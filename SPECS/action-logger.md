# Spec — action-logger.ts

## Responsibility

Append-only JSONL log of all agent actions and their human decisions. The source of truth for the decisions journal, cross-agent conflict detection, and decoration data.

## ActionRecord type

```typescript
export interface ActionRecord {
  id: string
  ts: string                          // ISO 8601
  agent: "claude" | "codex"
  session_id: string
  tool: string
  files: string[]                     // relative to workspace root
  intent: string
  diff_ref?: string                   // relative path: .gait/diffs/<id>.patch
  decision_points: DecisionPoint[]
  severity: Severity
  human_decision: "accept" | "reject" | "edit" | "auto_accept" | "timeout_reject"
  human_note?: string
  reviewer_agent?: "claude" | "codex"
  reviewer_analysis?: ReviewerAnalysis
  snapshot_ref?: string               // git ref of snapshot taken before this action
  cost_estimate_usd?: number
  duration_ms?: number
}
```

## Module interface

```typescript
export class ActionLogger {
  constructor(private readonly gaitDir: string) {}
  
  // Append a new record — never modifies existing records
  async append(record: ActionRecord): Promise<void>
  
  // Read last n records (or all if n undefined)
  async readRecent(n?: number): Promise<ActionRecord[]>
  
  // Find a specific record by id
  async findById(id: string): Promise<ActionRecord | null>
  
  // Read all records matching a filter
  async query(filter: Partial<ActionRecord>): Promise<ActionRecord[]>
  
  // Store diff patch for a record
  async storeDiff(id: string, patch: string): Promise<string>  // returns diff_ref
}
```

## File location

`path.join(gaitDir, 'actions.jsonl')`

## `append()` implementation

```typescript
async append(record: ActionRecord): Promise<void> {
  const line = JSON.stringify(record) + '\n'
  await fs.promises.appendFile(
    path.join(this.gaitDir, 'actions.jsonl'),
    line,
    'utf8'
  )
}
```

Never overwrite. Never parse-and-rewrite the whole file. Append only.

## `readRecent()` implementation

Read file as text, split on newlines, parse each line, return last n. Filter out empty lines and unparseable lines (log warning, continue).

For large files (>10MB): read only the last N bytes using a stream or `fs.read` with offset. Reasonable assumption: 10k records ≈ 5MB.

## `storeDiff()` implementation

```typescript
async storeDiff(id: string, patch: string): Promise<string> {
  const diffsDir = path.join(this.gaitDir, 'diffs')
  await fs.promises.mkdir(diffsDir, { recursive: true })
  const filename = `${id}.patch`
  await fs.promises.writeFile(path.join(diffsDir, filename), patch, 'utf8')
  return `.gait/diffs/${filename}`
}
```

## Integration with cost-tracker

The existing `cost-tracker.ts` in the fork tracks agent costs. Absorb this: `ActionRecord.cost_estimate_usd` replaces the separate cost tracker. The `ActionLogger` constructor can accept an optional cost estimator function, or cost can be passed in directly when building the record.

Keep the existing cost estimation logic from `cost-tracker.ts` — just call it when building the `ActionRecord` before appending.

## Concurrency

Multiple actions can be logged concurrently (Claude + Codex running in parallel). `appendFile` with `\n` terminator is safe for concurrent appends on most filesystems — each `appendFile` call is atomic at the OS level for small writes. No locking needed.

## Tests

- Test `append` + `readRecent` round-trip
- Test `findById` on a file with 100 records
- Test `query` with filter
- Test graceful handling of corrupted line in JSONL (skip line, continue)
- Test concurrent appends (race condition test)
