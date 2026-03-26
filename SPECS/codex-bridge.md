# Spec — codex-bridge.ts (Phase 4)

## Context

Codex CLI (OpenAI) uses `--approval-mode=suggest` which prompts the user to confirm before each file write. The Codex bridge wraps the Codex invocation, intercepts these confirmation prompts, and routes them through the same HITL interception system as Claude Code actions.

This is implemented in Phase 4. All other phases use Claude Code exclusively.

## Invocation

Instead of:
```bash
codex --approval-mode=suggest "implement the feature"
```

The user runs (via `gait.runCodex` command):
```bash
node out/codex-bridge.js "implement the feature"
```

Or from VS Code: `Gait: Run Codex Task` command opens an input box for the task description, then invokes the bridge.

## How Codex approval mode works

With `--approval-mode=suggest`, Codex prints a structured confirmation request to stdout before each action. The format is:

```
APPLY PATCH
  file: src/foo.ts
  +++ new content +++
  ...
Accept? [y/N]
```

The bridge reads Codex stdout line by line. When it detects a confirmation prompt, it:
1. Parses the file path and diff from the prompt block
2. Builds a `PendingAction` 
3. Routes it through the same interceptor IPC (writes to `.gait/pending/`)
4. Waits for decision
5. Responds `y\n` or `n\n` to Codex stdin

## Implementation approach

```typescript
import { spawn } from 'child_process'
import * as readline from 'readline'

export async function runCodexWithInterception(
  task: string,
  workspaceRoot: string,
  gaitDir: string
): Promise<void> {
  const proc = spawn('codex', ['--approval-mode=suggest', task], {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'inherit']
  })
  
  const rl = readline.createInterface({ input: proc.stdout! })
  
  let buffer: string[] = []
  let inApprovalBlock = false
  
  rl.on('line', async (line) => {
    // Detect start of approval block
    if (line.includes('APPLY PATCH') || line.includes('Accept?')) {
      // Parse buffer into PendingAction
      // Route through IPC
      // Write y/n to proc.stdin
    } else {
      // Pass through to terminal output
      process.stdout.write(line + '\n')
      buffer.push(line)
    }
  })
  
  return new Promise(resolve => proc.on('close', resolve))
}
```

## Approval block parsing

The exact format of Codex's approval prompt may vary across versions. The bridge must be resilient:
- Detect `Accept? [y/N]` or similar as the confirmation trigger
- Extract file path from preceding lines
- Extract diff from the block
- If parsing fails: pass through to user directly (don't silently accept or reject)

## `gait.runCodex` command

```typescript
export async function cmdRunCodex(): Promise<void> {
  const task = await vscode.window.showInputBox({
    prompt: 'What should Codex do?',
    placeHolder: 'Implement the user authentication feature'
  })
  if (!task) return
  
  // Open terminal, run codex-bridge
  const terminal = vscode.window.createTerminal('Codex (HITL-Gate)')
  const bridgePath = path.join(context.extensionPath, 'out', 'codex-bridge.js')
  terminal.sendText(`node "${bridgePath}" "${task.replace(/"/g, '\\"')}"`)
  terminal.show()
}
```

## Limitations to document

- Codex CLI output format is not formally documented and may change
- The bridge is best-effort: if Codex changes its approval prompt format, the bridge falls back to passing prompts directly to the user
- This is explicitly Phase 4 — if Codex's API or CLI changes significantly before then, the approach may need revision
