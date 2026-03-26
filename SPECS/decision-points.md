# Spec — decision-points.ts

## Types

```typescript
export type DecisionPoint =
  | "interface_change"      // exported function/method signature changed
  | "file_deleted"          // file removal
  | "file_renamed"          // file rename/move
  | "schema_change"         // DB schema, JSON schema, shared type definitions
  | "cross_agent_conflict"  // same file touched by the other agent recently
  | "prod_file"             // file matches a prod path glob
  | "intent_drift"          // agent action diverges from stated intent
  | "public_api_change"     // exported symbol modified in a public module

export type Severity = "low" | "medium" | "high"

export interface EvaluationResult {
  points: DecisionPoint[]
  severity: Severity
  presentation: "notification" | "panel" | "modal"
  requires_cross_review: boolean
  explanations: Record<DecisionPoint, string>  // human-readable reason per point
}
```

## Severity computation

```
No points detected              → low
1+ low-weight points            → low
interface_change OR
  public_api_change OR
  schema_change OR
  cross_agent_conflict          → medium
file_deleted OR
  intent_drift (high confidence) OR
  prod_file OR
  2+ medium-weight points       → high
mode == "prod" (any action)     → minimum medium, prod_file → high
```

Weight table:
- `file_renamed`: low
- `cross_agent_conflict`: medium
- `interface_change`: medium
- `public_api_change`: medium
- `schema_change`: medium
- `file_deleted`: high
- `prod_file`: high
- `intent_drift`: medium → high based on confidence

## Detection implementations

### `interface_change` and `public_api_change`

Parse unified diff for changes to exported symbols. Look for diff lines (`+` or `-`) containing:

TypeScript patterns:
```
export (function|class|interface|type|const|let|enum)
export default
^  [a-zA-Z]+\s*\(   # method signature in class
```

Python patterns:
```
^def [a-zA-Z]
^class [a-zA-Z]
```

If any removed line matches an export pattern AND any added line changes the signature (different parameter count, different parameter names, different return type annotation): flag as `interface_change`.

If an exported symbol is added or removed (not just modified): flag as `public_api_change`.

Do NOT flag if only the function body changed (no signature line in diff).

### `file_deleted`

Diff header contains `deleted file mode` or file appears as `--- a/path` with no corresponding `+++ b/path`.

### `file_renamed`

Diff header contains `rename from` / `rename to` OR similarity index line.

### `schema_change`

Flag if any of:
- File path matches: `**/migrations/**`, `**/*.sql`, `**/schema.*`, `**/prisma/schema.prisma`, `**/*.graphql`, `**/*.proto`
- File contains changes to lines matching: `CREATE TABLE`, `ALTER TABLE`, `type.*=.*{` in shared types files, `interface.*{` with 3+ property changes

### `cross_agent_conflict`

Query `action-logger` for records where:
- `files` array intersects with current action's `files`
- `agent` !== current action's `agent`
- `ts` is within `cross_agent_conflict_window_s` seconds of now
- `human_decision` === "accept" (only care about accepted changes)

If any match found: flag as `cross_agent_conflict`.

### `prod_file`

For each file in action, test against each glob in `config.prod.paths` using `micromatch` or manual glob matching. Flag if any file matches.

### `intent_drift`

Requires LLM call — only run if `config.decision_points.intent_drift === true`.

Input:
- `action.intent` — what the agent said it would do
- `action.diff_preview` — what it actually did (first 100 lines of diff)
- `action.session_context` — the original user request

Prompt (fast, cheap — use smallest available model):
```
Given:
USER REQUEST: <session_context>
AGENT STATED INTENT: <intent>
ACTUAL DIFF (first 100 lines): <diff_preview>

Does the actual diff match the stated intent and user request?
Reply with JSON only: {"drift": true|false, "confidence": "low"|"medium"|"high", "reason": "one sentence"}
```

If `drift: true` AND `confidence: "medium"|"high"`: flag as `intent_drift`.
If API call fails or times out (3s max): skip this detection, do not flag.

## `evaluate()` function signature

```typescript
export async function evaluate(
  action: PendingAction,
  config: HitlConfig,
  recentActions: ActionRecord[]   // from action-logger, for cross_agent_conflict
): Promise<EvaluationResult>
```

## Presentation mapping

```typescript
function computePresentation(severity: Severity, mode: "dev" | "prod"): EvaluationResult["presentation"] {
  if (mode === "prod") return severity === "low" ? "panel" : "modal"
  if (severity === "high") return "modal"
  if (severity === "medium") return "panel"
  return "notification"
}
```

## `requires_cross_review` mapping

```typescript
function computeRequiresCrossReview(points: DecisionPoint[], config: HitlConfig): boolean {
  if (!config.reviewer.enabled) return false
  const severity = computeSeverity(points)
  return config.reviewer.on_severity.includes(severity)
}
```

## Tests

Write tests in `src/tests/decision-points.test.ts`.

Fixtures needed (put in `src/tests/fixtures/diffs/`):
- `interface-change.patch` — TypeScript file with exported function signature changed
- `file-deleted.patch` — file deletion diff
- `file-renamed.patch` — file rename diff  
- `schema-change.patch` — SQL migration file modified
- `no-change.patch` — only comments and whitespace changed (should produce no points)
- `body-only-change.patch` — function body changed, signature untouched (should NOT flag interface_change)

Test each detector in isolation with its fixture. Test severity computation with combinations.
