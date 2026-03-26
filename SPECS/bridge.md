# Spec — hitlgate-bridge.ts

## What it is

A small standalone Node.js script that acts as the IPC layer between Claude Code (which calls it via a shell hook) and the VS Code extension (which watches the filesystem).

It is **not** a VS Code extension component. It runs as a child process spawned by Claude Code's `PreToolUse` hook.

## Build

Built as a separate esbuild entry point:
```bash
esbuild src/bridge/hitlgate-bridge.ts \
  --bundle \
  --outfile=out/hitlgate-bridge.js \
  --platform=node \
  --format=cjs \
  --external:vscode
```

The extension installs it by writing a wrapper script to a known location. See `claude-hooks.ts` for installation logic.

## Invocation by Claude Code

Claude Code calls it via the `PreToolUse` hook. The hook configuration in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/out/hitlgate-bridge.js"
          }
        ]
      }
    ]
  }
}
```

Claude Code passes the hook context via **stdin** as JSON. The bridge reads stdin, processes, and exits.

## Stdin payload (from Claude Code)

Claude Code's `PreToolUse` hook provides this JSON via stdin:

```typescript
interface ClaudeHookPayload {
  tool_name: string              // "Edit" | "Write" | "MultiEdit" | "Bash" | ...
  tool_input: {
    // For Edit/Write:
    path?: string
    file_path?: string
    content?: string
    // For MultiEdit:
    edits?: Array<{ path: string }>
    // For Bash:
    command?: string
    description?: string
  }
  // Additional context Claude Code provides:
  session_id?: string
  transcript_path?: string       // path to session transcript file
}
```

## Bridge behavior

```typescript
async function main() {
  // 1. Read stdin
  const raw = await readStdin()
  let payload: ClaudeHookPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    // Not valid JSON — pass through (don't block Claude)
    process.exit(0)
  }
  
  // 2. Find .gait directory
  const gaitDir = await findGaitDir(process.cwd())
  if (!gaitDir) {
    // No .gait dir — project not initialized, pass through
    process.exit(0)
  }
  
  // 3. Extract action info
  const id = generateActionId()
  const files = extractFiles(payload)
  const intent = extractIntent(payload)
  const sessionId = payload.session_id ?? generateSessionId()
  
  // 4. Build PendingAction
  const action: PendingAction = {
    id,
    agent: "claude",
    session_id: sessionId,
    tool: payload.tool_name,
    files,
    intent,
    diff_preview: undefined,   // Claude Code doesn't provide diff at PreToolUse time
    session_context: await extractSessionContext(payload.transcript_path),
    ts: new Date().toISOString()
  }
  
  // 5. Write pending file
  const pendingPath = path.join(gaitDir, 'pending', `${id}.json`)
  await fs.promises.mkdir(path.dirname(pendingPath), { recursive: true })
  await fs.promises.writeFile(pendingPath, JSON.stringify(action, null, 2))
  
  // 6. Poll for decision
  const decision = await pollForDecision(gaitDir, id)
  
  // 7. Cleanup pending file
  await fs.promises.unlink(pendingPath).catch(() => {})
  
  // 8. Exit based on decision
  if (decision.decision === 'reject') {
    process.stderr.write(
      decision.note 
        ? `HITL-Gate: Action rejected — ${decision.note}`
        : `HITL-Gate: Action rejected by user`
    )
    process.exit(2)  // Claude Code treats exit 2 as block
  }
  
  process.exit(0)  // Accept
}
```

## `pollForDecision()`

```typescript
async function pollForDecision(
  gaitDir: string,
  id: string,
  timeoutMs = 120000,
  intervalMs = 200
): Promise<DecisionResult> {
  const decisionPath = path.join(gaitDir, 'decisions', `${id}.json`)
  const start = Date.now()
  
  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await fs.promises.readFile(decisionPath, 'utf8')
      const decision = JSON.parse(raw) as DecisionResult
      // Cleanup decision file
      await fs.promises.unlink(decisionPath).catch(() => {})
      return decision
    } catch {
      // File not yet written — wait and retry
      await sleep(intervalMs)
    }
  }
  
  // Timeout — auto-reject to be safe
  process.stderr.write('HITL-Gate: Decision timeout — action rejected')
  return { id, decision: 'reject', note: 'timeout', ts: new Date().toISOString() }
}
```

## `extractFiles()`

```typescript
function extractFiles(payload: ClaudeHookPayload): string[] {
  const { tool_name, tool_input } = payload
  
  if (tool_name === 'MultiEdit' && tool_input.edits) {
    return [...new Set(tool_input.edits.map(e => e.path))]
  }
  if (tool_input.path) return [tool_input.path]
  if (tool_input.file_path) return [tool_input.file_path]
  if (tool_name === 'Bash') return []  // No specific file for Bash
  return []
}
```

## `extractSessionContext()`

```typescript
async function extractSessionContext(transcriptPath?: string): Promise<string | undefined> {
  if (!transcriptPath) return undefined
  try {
    const transcript = await fs.promises.readFile(transcriptPath, 'utf8')
    // Extract last user message from transcript
    // Claude Code transcript format: JSONL with role/content
    const lines = transcript.trim().split('\n').reverse()
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.role === 'user' && typeof entry.content === 'string') {
          return entry.content.slice(0, 500)  // truncate
        }
      } catch { continue }
    }
  } catch { return undefined }
}
```

## `findGaitDir()`

Walk up from cwd looking for `.gait/config.toml`:

```typescript
async function findGaitDir(startDir: string): Promise<string | null> {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, '.gait')
    try {
      await fs.promises.access(path.join(candidate, 'config.toml'))
      return candidate
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) return null  // reached filesystem root
    dir = parent
  }
}
```

## ID generation

```typescript
function generateActionId(): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6)
  return `act_${ts}_${rand}`
}
```

## Installation by extension (`claude-hooks.ts`)

```typescript
export async function installHooks(workspaceRoot: string, extensionPath: string): Promise<void> {
  const bridgePath = path.join(extensionPath, 'out', 'hitlgate-bridge.js')
  
  const hooksConfig = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}"`
            }
          ]
        }
      ]
    }
  }
  
  const claudeDir = path.join(workspaceRoot, '.claude')
  const settingsPath = path.join(claudeDir, 'settings.json')
  
  await fs.promises.mkdir(claudeDir, { recursive: true })
  
  // Merge with existing settings if present
  let existing: any = {}
  try {
    existing = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'))
  } catch {}
  
  const merged = deepMergeHooks(existing, hooksConfig)
  await fs.promises.writeFile(settingsPath, JSON.stringify(merged, null, 2))
}
```

## Bash tool handling

The bridge intercepts Bash tool calls too. However, Bash is harder to evaluate (no file list). For Bash actions:
- If the command contains destructive patterns (`rm -rf`, `drop table`, `truncate`, `git reset --hard`): flag as high severity
- Otherwise: pass through as low severity (log only, auto-accept)

Destructive Bash patterns:
```typescript
const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+-rf?\s/i,
  /drop\s+table/i,
  /truncate\s+table/i, 
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-fd/i,
  /:\s*>\s*\w/,   // : > file (truncate)
]
```
