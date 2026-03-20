import * as vscode from "vscode";
import type { StageName, StageStatus, StageResult } from "../core/pipeline";

export class PipelineTreeProvider implements vscode.TreeDataProvider<StageTreeItem> {
  private _onDidChange = new vscode.EventEmitter<StageTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private stages: Map<StageName, StageResult> = new Map();

  refresh(results?: StageResult[]): void {
    if (results) {
      for (const r of results) this.stages.set(r.name, r);
    }
    this._onDidChange.fire(undefined);
  }

  reset(stageNames: StageName[]): void {
    this.stages.clear();
    for (const name of stageNames) {
      this.stages.set(name, {
        name,
        status: "pending",
        output: "",
        error: "",
        duration: 0,
      });
    }
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: StageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): StageTreeItem[] {
    return [...this.stages.values()].map((r) => new StageTreeItem(r));
  }
}

class StageTreeItem extends vscode.TreeItem {
  constructor(private result: StageResult) {
    super(capitalize(result.name), vscode.TreeItemCollapsibleState.None);
    this.iconPath = this.getIcon();
    this.description = this.getDescription();
    this.tooltip = this.getTooltip();
    this.command = {
      command: `gait.run${capitalize(result.name)}`,
      title: `Run ${result.name}`,
    };
  }

  private getIcon(): vscode.ThemeIcon {
    const map: Record<StageStatus, string> = {
      pending: "circle-outline",
      running: "loading~spin",
      passed: "check",
      failed: "error",
      skipped: "dash",
    };
    const colors: Record<StageStatus, string | undefined> = {
      pending: undefined,
      running: "charts.yellow",
      passed: "testing.iconPassed",
      failed: "testing.iconFailed",
      skipped: undefined,
    };
    const icon = map[this.result.status] ?? "circle-outline";
    const color = colors[this.result.status];
    return new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
  }

  private getDescription(): string {
    if (this.result.status === "pending") return "";
    const dur = this.result.duration > 0 ? ` (${(this.result.duration / 1000).toFixed(1)}s)` : "";
    return `${this.result.status}${dur}`;
  }

  private getTooltip(): string {
    if (this.result.error) return this.result.error.slice(0, 200);
    return `${capitalize(this.result.name)}: ${this.result.status}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
