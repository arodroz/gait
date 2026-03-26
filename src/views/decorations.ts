import * as vscode from "vscode";
import { ActionLogger } from "../core/action-logger";
import { run } from "../core/runner";

export class DecorationManager {
  private readonly claudeType: vscode.TextEditorDecorationType;
  private readonly codexType: vscode.TextEditorDecorationType;

  constructor(
    private readonly extensionPath: string,
    private readonly workspaceRoot: string,
    private readonly logger: ActionLogger,
  ) {
    this.claudeType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(`${extensionPath}/assets/gutter-claude.svg`).fsPath,
      gutterIconSize: "70%",
      light: {
        backgroundColor: "rgba(100, 149, 237, 0.08)",
        borderColor: "rgba(100, 149, 237, 0.3)",
        borderStyle: "solid",
        borderWidth: "0 0 0 2px",
      },
      dark: {
        backgroundColor: "rgba(100, 149, 237, 0.10)",
        borderColor: "rgba(100, 149, 237, 0.4)",
        borderStyle: "solid",
        borderWidth: "0 0 0 2px",
      },
      isWholeLine: false,
    });

    this.codexType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(`${extensionPath}/assets/gutter-codex.svg`).fsPath,
      gutterIconSize: "70%",
      light: {
        backgroundColor: "rgba(80, 180, 120, 0.08)",
        borderColor: "rgba(80, 180, 120, 0.3)",
        borderStyle: "solid",
        borderWidth: "0 0 0 2px",
      },
      dark: {
        backgroundColor: "rgba(80, 180, 120, 0.10)",
        borderColor: "rgba(80, 180, 120, 0.4)",
        borderStyle: "solid",
        borderWidth: "0 0 0 2px",
      },
      isWholeLine: false,
    });
  }

  async applyToEditor(editor: vscode.TextEditor): Promise<void> {
    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    const records = await this.logger.readRecent(200);
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    const relevant = records.filter(
      (r) =>
        r.files.includes(filePath) &&
        (r.human_decision === "accept" || r.human_decision === "auto_accept") &&
        new Date(r.ts).getTime() > sevenDaysAgo,
    );

    if (relevant.length === 0) {
      editor.setDecorations(this.claudeType, []);
      editor.setDecorations(this.codexType, []);
      return;
    }

    const ranges = await this.getAddedLineRanges(filePath);
    if (ranges.length === 0) {
      editor.setDecorations(this.claudeType, []);
      editor.setDecorations(this.codexType, []);
      return;
    }

    const latestRecord = relevant[relevant.length - 1];
    const hoverMessage = new vscode.MarkdownString(
      `**${latestRecord.agent === "claude" ? "Claude" : "Codex"}** · ${timeAgo(latestRecord.ts)}\n\n` +
        `*${latestRecord.intent}*\n\n` +
        `Decision: **${latestRecord.human_decision}**` +
        (latestRecord.human_note ? `\n\n> ${latestRecord.human_note}` : ""),
    );

    const decorations: vscode.DecorationOptions[] = ranges.map((range) => ({
      range,
      hoverMessage,
    }));

    if (latestRecord.agent === "claude") {
      editor.setDecorations(this.claudeType, decorations);
      editor.setDecorations(this.codexType, []);
    } else {
      editor.setDecorations(this.codexType, decorations);
      editor.setDecorations(this.claudeType, []);
    }
  }

  async refreshAll(): Promise<void> {
    for (const editor of vscode.window.visibleTextEditors) {
      await this.applyToEditor(editor);
    }
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.claudeType, []);
      editor.setDecorations(this.codexType, []);
    }
  }

  dispose(): void {
    this.claudeType.dispose();
    this.codexType.dispose();
  }

  /** Parse git diff hunk headers to find added line ranges. Uses spawn via run(). */
  private async getAddedLineRanges(filePath: string): Promise<vscode.Range[]> {
    try {
      const result = await run("git", ["diff", "HEAD", "-U0", "--", filePath], this.workspaceRoot, 5000);
      const ranges: vscode.Range[] = [];
      const hunkRe = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
      let match;
      while ((match = hunkRe.exec(result.stdout)) !== null) {
        const start = parseInt(match[1], 10) - 1;
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        if (count > 0) {
          ranges.push(new vscode.Range(start, 0, start + count - 1, 0));
        }
      }
      return ranges;
    } catch {
      return [];
    }
  }
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
