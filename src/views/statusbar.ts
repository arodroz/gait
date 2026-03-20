import * as vscode from "vscode";
import type { StageName, StageStatus } from "../core/pipeline";

const ICONS: Record<StageStatus, string> = {
  pending: "$(circle-outline)",
  running: "$(loading~spin)",
  passed: "$(check)",
  failed: "$(error)",
  skipped: "$(dash)",
};

const COLORS: Record<StageStatus, string | undefined> = {
  pending: undefined,
  running: "statusBarItem.warningBackground",
  passed: undefined,
  failed: "statusBarItem.errorBackground",
  skipped: undefined,
};

export class StatusBarManager {
  private items: Map<StageName, vscode.StatusBarItem> = new Map();
  private gateItem: vscode.StatusBarItem;

  constructor() {
    this.gateItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.gateItem.command = "gait.gate";
    this.gateItem.text = "$(shield) Gait";
    this.gateItem.tooltip = "Run quality gate";
    this.gateItem.show();
  }

  ensureStage(name: StageName): vscode.StatusBarItem {
    let item = this.items.get(name);
    if (!item) {
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99 - this.items.size);
      item.command = `gait.run${capitalize(name)}`;
      this.items.set(name, item);
      item.show();
    }
    return item;
  }

  setStageStatus(name: StageName, status: StageStatus, duration?: number): void {
    const item = this.ensureStage(name);
    const icon = ICONS[status];
    const dur = duration ? ` (${(duration / 1000).toFixed(1)}s)` : "";
    item.text = `${icon} ${capitalize(name)}${dur}`;
    item.backgroundColor = COLORS[status]
      ? new vscode.ThemeColor(COLORS[status]!)
      : undefined;
    item.tooltip = `${capitalize(name)}: ${status}${dur}`;
  }

  setGateStatus(passed: boolean, duration: number): void {
    const dur = (duration / 1000).toFixed(1);
    if (passed) {
      this.gateItem.text = `$(shield) Gate ✓ ${dur}s`;
      this.gateItem.backgroundColor = undefined;
    } else {
      this.gateItem.text = `$(shield) Gate ✗ ${dur}s`;
      this.gateItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    }
  }

  resetAll(stages: StageName[]): void {
    for (const name of stages) {
      this.setStageStatus(name, "pending");
    }
    this.gateItem.text = "$(shield) Gait";
    this.gateItem.backgroundColor = undefined;
  }

  dispose(): void {
    this.gateItem.dispose();
    for (const item of this.items.values()) item.dispose();
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
