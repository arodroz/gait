import * as vscode from "vscode";

export class StatusBarManager {
  private mainItem: vscode.StatusBarItem;

  constructor() {
    this.mainItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.mainItem.command = "gait.openDashboard";
    this.mainItem.text = "$(shield) HITL-Gate";
    this.mainItem.tooltip = "Open HITL-Gate Dashboard";
    this.mainItem.show();
  }

  update(projectName: string, mode: string): void {
    const modeIcon = mode === "prod" ? "$(lock)" : "$(beaker)";
    this.mainItem.text = `$(shield) ${projectName} ${modeIcon}`;
    this.mainItem.tooltip = `HITL-Gate — ${projectName} (${mode})`;
    if (mode === "prod") {
      this.mainItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.mainItem.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.mainItem.dispose();
  }
}
