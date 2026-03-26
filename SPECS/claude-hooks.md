# Spec — claude-hooks.ts

## Responsibility

Generates and installs the `.claude/settings.json` hooks configuration that makes Claude Code call `hitlgate-bridge` before file writes.

## Functions

```typescript
// Generate the hooks config object
export function generateHooksConfig(bridgePath: string): object

// Install hooks into .claude/settings.json (merge with existing)
export async function installHooks(
  workspaceRoot: string,
  bridgePath: string
): Promise<void>

// Check if hooks are installed and point to the correct bridge path
export async function checkHooksInstalled(
  workspaceRoot: string,
  bridgePath: string
): Promise<{ installed: boolean; stale: boolean }>

// Remove HITL-Gate hooks from .claude/settings.json
export async function uninstallHooks(workspaceRoot: string): Promise<void>
```

## Generated hooks config

```typescript
export function generateHooksConfig(bridgePath: string): object {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}"`,
              // Tag so we can identify and update/remove our hook later
              _hitlgate: true
            }
          ]
        }
      ]
    }
  }
}
```

## Merge strategy

When installing, read existing `.claude/settings.json`. If it already has a `PreToolUse` array:
- Check if any entry is tagged `_hitlgate: true` → update in place
- If no existing hitlgate entry → append to the array

Never remove non-hitlgate hooks.

## Staleness check

The bridge path is absolute (includes extension path which changes on update). Check if the installed path still exists. If the extension was updated and the path changed: `stale: true` → user should reinstall hooks.

Show a warning notification if stale hooks detected on activation:
```
"HITL-Gate: Claude Code hooks may be outdated. Run 'Gait: Install Claude Hooks' to update."
```

## PostToolUse hook (for diff capture)

Also install a `PostToolUse` hook to capture the actual diff after Claude writes:

```typescript
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command", 
          "command": `node "${bridgePath}" --post`,
          "_hitlgate": true
        }
      ]
    }
  ]
}
```

In `--post` mode, the bridge:
1. Reads stdin (PostToolUse payload includes the result)
2. Runs `git diff HEAD -- <file>` to get the actual patch
3. Writes patch to `.gait/diffs/<id>.patch`
4. Updates the action record's `diff_ref` field

The `id` is passed via environment variable `HITLGATE_ACTION_ID` set by the PreToolUse hook:
```typescript
// In PreToolUse hook command:
command: `HITLGATE_ACTION_ID=${id} node "${bridgePath}"`
```

Wait — environment variable injection is not directly supported in the hooks config. Instead, write the pending id to a temp file that PostToolUse can read. Use `.gait/last_action_id` as a simple last-write-wins file.

## Error handling

If `.claude/` directory doesn't exist: create it. If Claude Code is not installed (can't find the settings path): show informative error, suggest manual setup with the config snippet.
