# Spec — decorations.ts

## Responsibility

Shows inline gutter markers in the VS Code editor indicating which lines were written by which agent, and when. Provides hover tooltips with action details.

## Decoration types

Two decoration types, created once at extension activation:

```typescript
// Claude decoration — subtle blue gutter icon
const claudeDecorationType = vscode.window.createTextEditorDecorationType({
  gutterIconPath: context.asAbsolutePath('assets/gutter-claude.svg'),
  gutterIconSize: '70%',
  // Light theme
  light: {
    backgroundColor: 'rgba(100, 149, 237, 0.08)',
    borderColor: 'rgba(100, 149, 237, 0.3)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
  },
  // Dark theme  
  dark: {
    backgroundColor: 'rgba(100, 149, 237, 0.10)',
    borderColor: 'rgba(100, 149, 237, 0.4)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
  },
  isWholeLine: false,
})

// Codex decoration — subtle green gutter icon
const codexDecorationType = vscode.window.createTextEditorDecorationType({
  gutterIconPath: context.asAbsolutePath('assets/gutter-codex.svg'),
  gutterIconSize: '70%',
  light: {
    backgroundColor: 'rgba(80, 180, 120, 0.08)',
    borderColor: 'rgba(80, 180, 120, 0.3)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
  },
  dark: {
    backgroundColor: 'rgba(80, 180, 120, 0.10)',
    borderColor: 'rgba(80, 180, 120, 0.4)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
  },
  isWholeLine: false,
})
```

## SVG icons

Create two minimal SVG icons for the gutter. Keep them simple — a small colored dot or letter is sufficient.

`assets/gutter-claude.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="5" fill="#6495ED" opacity="0.8"/>
  <text x="8" y="11.5" text-anchor="middle" font-size="7" font-weight="bold" fill="white" font-family="monospace">C</text>
</svg>
```

`assets/gutter-codex.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="5" fill="#50B478" opacity="0.8"/>
  <text x="8" y="11.5" text-anchor="middle" font-size="7" font-weight="bold" fill="white" font-family="monospace">X</text>
</svg>
```

## Module interface

```typescript
export class DecorationManager {
  constructor(
    private readonly claudeType: vscode.TextEditorDecorationType,
    private readonly codexType: vscode.TextEditorDecorationType,
    private readonly logger: ActionLogger
  ) {}
  
  // Apply decorations to the given editor based on recent action history
  async applyToEditor(editor: vscode.TextEditor): Promise<void>
  
  // Refresh decorations for all open editors
  async refreshAll(): Promise<void>
  
  // Clear all decorations (called on commit)
  clearAll(): void
  
  // Call when a new action is accepted
  async onActionAccepted(record: ActionRecord): Promise<void>
  
  dispose(): void
}
```

## How line ranges are determined

The bridge does not have diff information at `PreToolUse` time (Claude Code hasn't written yet). After the action is accepted and Claude Code has written the file, the `PostToolUse` hook runs and can capture the diff.

For now (Phase 2): use a simplified approach:
- Store the file paths from `ActionRecord.files`
- When decorating, read the current `git diff HEAD -- <file>` for each file
- Parse the diff hunk headers (`@@ -a,b +c,d @@`) to get added line ranges
- Apply decoration to those line ranges

```typescript
async function getAddedLineRanges(
  workspaceRoot: string,
  filePath: string,
  since?: string  // git ref — if provided, diff against that ref
): Promise<vscode.Range[]>
```

Use the existing `git.ts` utilities from the fork.

## Hover message

Each decoration range should have a hover message:

```typescript
{
  hoverMessage: new vscode.MarkdownString(
    `**${record.agent === 'claude' ? 'Claude' : 'Codex'}** · ${timeAgo(record.ts)}\n\n` +
    `*${record.intent}*\n\n` +
    `Decision: **${record.human_decision}**` +
    (record.human_note ? `\n\n> ${record.human_note}` : '')
  )
}
```

## Decoration lifecycle

- **Applied:** when an action is accepted (immediately after decision)
- **Refreshed:** when the editor opens a file that has recent actions
- **Cleared:** after `git commit` (file watcher on `.git/COMMIT_EDITMSG` changes)
- **Persisted across restarts:** decorations are reapplied on extension activation by reading `actions.jsonl`

Do not show decorations for actions older than 7 days (configurable, not in v1).

## Registration in extension.ts

```typescript
// On editor open/change
context.subscriptions.push(
  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) state.decorations.applyToEditor(editor)
  })
)

// On git commit
const commitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/COMMIT_EDITMSG')
commitWatcher.onDidChange(() => state.decorations.clearAll())
context.subscriptions.push(commitWatcher)
```
