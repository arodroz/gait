import * as vscode from "vscode";
import type { ActionRecord } from "../core/action-logger";

// ── Decisions Tree ──

export class DecisionsTreeProvider implements vscode.TreeDataProvider<DecisionItem> {
  private _onDidChange = new vscode.EventEmitter<DecisionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private records: ActionRecord[] = [];

  update(records: ActionRecord[]): void {
    this.records = records.slice(-20).reverse();
    this._onDidChange.fire(undefined);
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: DecisionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): DecisionItem[] {
    if (this.records.length === 0) {
      const empty = new DecisionItem("No decisions yet", "circle-outline", "");
      empty.description = "Actions will appear here";
      return [empty];
    }

    return this.records.map((r) => {
      const isAccepted = r.human_decision === "accept" || r.human_decision === "auto_accept";
      const icon = isAccepted ? "pass-filled" : "error";
      const color = isAccepted ? "testing.iconPassed" : "testing.iconFailed";
      const files = r.files.slice(0, 2).join(", ") + (r.files.length > 2 ? ` +${r.files.length - 2}` : "");
      const label = `${r.agent} · ${r.tool}`;

      const item = new DecisionItem(label, icon, files);
      item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
      item.tooltip = new vscode.MarkdownString(
        `**${r.agent}** · ${r.tool}\n\n` +
        `*${r.intent}*\n\n` +
        `Files: ${r.files.join(", ")}\n\n` +
        `Severity: **${r.severity}** · Decision: **${r.human_decision}**` +
        (r.human_note ? `\n\n> ${r.human_note}` : ""),
      );

      return item;
    });
  }
}

class DecisionItem extends vscode.TreeItem {
  constructor(label: string, icon: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description;
  }
}

// ── Quick Actions Tree ──

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionItem> {
  getTreeItem(element: ActionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ActionItem[] {
    return [
      new ActionItem("Open Dashboard", "gait.openDashboard", "dashboard", "Cmd+Shift+D"),
      new ActionItem("Run Agent", "gait.runAgent", "hubot", ""),
      new ActionItem("Run Codex", "gait.runCodex", "hubot", ""),
      new ActionItem("Decisions Journal", "gait.openJournal", "book", ""),
      new ActionItem("AI Code Review", "gait.codeReview", "eye", ""),
      new ActionItem("Generate AGENTS.md", "gait.generateAgentsMd", "file-text", ""),
      new ActionItem("Take Snapshot", "gait.snapshot", "history", ""),
      new ActionItem("Rollback", "gait.rollback", "discard", ""),
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

  update(data: {
    branch: string;
    stacks: string[];
    clean: boolean;
    project: string;
    mode?: string;
  }): void {
    this.items = [
      new InfoItem("Project", data.project, "folder"),
      new InfoItem("Branch", data.branch, "git-branch"),
      new InfoItem("Status", data.clean ? "Clean" : "Dirty", data.clean ? "check" : "warning"),
      new InfoItem("Mode", data.mode ?? "dev", data.mode === "prod" ? "shield" : "beaker"),
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

// ── Agents Tree ──

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentItem> {
  private _onDidChange = new vscode.EventEmitter<AgentItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private claudeEnabled = false;
  private codexEnabled = false;

  update(claude: boolean, codex: boolean): void {
    this.claudeEnabled = claude;
    this.codexEnabled = codex;
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: AgentItem): vscode.TreeItem {
    return element;
  }

  getChildren(): AgentItem[] {
    return [
      new AgentItem("Claude Code", this.claudeEnabled, "gait.installClaudeHooks"),
      new AgentItem("Codex", this.codexEnabled, "gait.runCodex"),
    ];
  }
}

class AgentItem extends vscode.TreeItem {
  constructor(label: string, enabled: boolean, commandId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = enabled ? "enabled" : "disabled";
    this.iconPath = new vscode.ThemeIcon(
      enabled ? "check" : "circle-outline",
      enabled ? new vscode.ThemeColor("testing.iconPassed") : undefined,
    );
    this.command = { command: commandId, title: label };
  }
}
