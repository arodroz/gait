import * as vscode from "vscode";
import type { StageName, StageStatus, StageResult } from "../core/pipeline";

// ── Pipeline Tree ──

type PipelineNode = StageTreeItem | ErrorLineItem;

export class PipelineTreeProvider implements vscode.TreeDataProvider<PipelineNode> {
  private _onDidChange = new vscode.EventEmitter<PipelineNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private stages: Map<StageName, StageResult> = new Map();
  private lastGate?: { passed: boolean; duration: number };

  refresh(results?: StageResult[]): void {
    if (results) {
      for (const r of results) this.stages.set(r.name, r);
    }
    this._onDidChange.fire(undefined);
  }

  reset(stageNames: StageName[]): void {
    this.stages.clear();
    for (const name of stageNames) {
      this.stages.set(name, { name, status: "pending", output: "", error: "", duration: 0 });
    }
    this.lastGate = undefined;
    this._onDidChange.fire(undefined);
  }

  setGateResult(passed: boolean, duration: number): void {
    this.lastGate = { passed, duration };
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: PipelineNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PipelineNode): PipelineNode[] {
    if (!element) {
      // Root level: gate summary + stages
      const items: PipelineNode[] = [];
      if (this.lastGate) {
        const gate = new StageTreeItem({
          name: "gate" as StageName,
          status: this.lastGate.passed ? "passed" : "failed",
          output: "",
          error: "",
          duration: this.lastGate.duration,
        });
        gate.label = this.lastGate.passed ? "Gate Passed" : "Gate Blocked";
        gate.iconPath = new vscode.ThemeIcon(
          this.lastGate.passed ? "shield" : "shield",
          new vscode.ThemeColor(this.lastGate.passed ? "testing.iconPassed" : "testing.iconFailed"),
        );
        gate.command = { command: "gait.gate", title: "Run Gate" };
        gate.collapsibleState = vscode.TreeItemCollapsibleState.None;
        items.push(gate);
      }
      items.push(...[...this.stages.values()].map((r) => new StageTreeItem(r)));
      return items;
    }
    // Children: error lines for failed stages
    if (element instanceof StageTreeItem && element.result.status === "failed" && element.result.error) {
      return element.result.error
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 8)
        .map((line) => new ErrorLineItem(line));
    }
    return [];
  }
}

class StageTreeItem extends vscode.TreeItem {
  constructor(public result: StageResult) {
    super(
      cap(result.name),
      result.status === "failed" && result.error
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.iconPath = this.getIcon();
    this.description = this.getDescription();
    this.tooltip = this.getTooltip();
    this.contextValue = result.status === "failed" ? "failedStage" : "stage";
    this.command = {
      command: `gait.run${cap(result.name)}`,
      title: `Run ${result.name}`,
    };
  }

  private getIcon(): vscode.ThemeIcon {
    const icons: Record<StageStatus, string> = {
      pending: "circle-outline",
      running: "loading~spin",
      passed: "pass-filled",
      failed: "error",
      skipped: "circle-slash",
    };
    const colors: Record<StageStatus, string | undefined> = {
      pending: undefined,
      running: "charts.yellow",
      passed: "testing.iconPassed",
      failed: "testing.iconFailed",
      skipped: "disabledForeground",
    };
    const icon = icons[this.result.status] ?? "circle-outline";
    const color = colors[this.result.status];
    return new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
  }

  private getDescription(): string {
    if (this.result.status === "pending") return "";
    const dur = this.result.duration > 0 ? `${(this.result.duration / 1000).toFixed(1)}s` : "";
    return dur;
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${cap(this.result.name)}** \u2014 ${this.result.status}`);
    if (this.result.duration > 0) {
      md.appendMarkdown(` (${(this.result.duration / 1000).toFixed(1)}s)`);
    }
    if (this.result.error) {
      md.appendMarkdown("\n\n---\n\n");
      md.appendCodeblock(this.result.error.slice(0, 500), "text");
    }
    return md;
  }
}

class ErrorLineItem extends vscode.TreeItem {
  constructor(line: string) {
    super(line.trim(), vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("dash", new vscode.ThemeColor("testing.iconFailed"));
    this.tooltip = line;

    // Try to parse file:line references for navigation
    const fileMatch = line.match(/([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,4}):(\d+)/);
    if (fileMatch) {
      this.command = {
        command: "vscode.open",
        title: "Open file",
        arguments: [
          vscode.Uri.file(fileMatch[1]),
          { selection: new vscode.Range(parseInt(fileMatch[2], 10) - 1, 0, parseInt(fileMatch[2], 10) - 1, 0) },
        ],
      };
    }
  }
}

// ── Quick Actions Tree ──

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionItem> {
  getTreeItem(element: ActionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ActionItem[] {
    return [
      new ActionItem("Run Gate", "gait.gate", "shield", "Cmd+Shift+G"),
      new ActionItem("Open Dashboard", "gait.openDashboard", "dashboard", "Cmd+Shift+D"),
      new ActionItem("Run Agent", "gait.runAgent", "hubot", ""),
      new ActionItem("Rollback", "gait.rollback", "discard", ""),
      new ActionItem("Release", "gait.release", "tag", ""),
      new ActionItem("Install Hook", "gait.installHook", "git-commit", ""),
      new ActionItem("Run Script", "gait.runScript", "terminal", ""),
      new ActionItem("Generate AGENTS.md", "gait.generateAgentsMd", "file-text", ""),
      new ActionItem("Environment Check", "gait.preflight", "checklist", ""),
      new ActionItem("Recover", "gait.recover", "trash", ""),
    ];
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label: string, commandId: string, icon: string, shortcut: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command: commandId, title: label };
    this.description = shortcut;
    this.tooltip = shortcut ? `${label} (${shortcut})` : label;
  }
}

// ── Project Info Tree ──

export class InfoTreeProvider implements vscode.TreeDataProvider<InfoItem> {
  private _onDidChange = new vscode.EventEmitter<InfoItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: InfoItem[] = [];

  update(data: { branch: string; stacks: string[]; clean: boolean; project: string }): void {
    this.items = [
      new InfoItem("Project", data.project, "folder"),
      new InfoItem("Branch", data.branch, "git-branch"),
      new InfoItem("Status", data.clean ? "Clean" : "Dirty", data.clean ? "check" : "warning"),
      new InfoItem("Stacks", data.stacks.join(", ") || "none", "layers"),
    ];
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: InfoItem): vscode.TreeItem {
    return element;
  }

  getChildren(): InfoItem[] {
    return this.items;
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = `${label}: ${value}`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
