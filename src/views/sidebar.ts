import * as vscode from "vscode";
import type { ActionRecord } from "../core/action-logger";

// ── Decisions Tree ──

export class DecisionsTreeProvider implements vscode.TreeDataProvider<DecisionItem> {
  private _onDidChange = new vscode.EventEmitter<DecisionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private records: ActionRecord[] = [];

  update(records: ActionRecord[]): void {
    // Only show interesting decisions: rejections, high/medium severity, or those with reviewer analysis
    const interesting = records.filter((r) =>
      r.human_decision === "reject" ||
      r.human_decision === "edit" ||
      r.severity === "high" ||
      r.severity === "medium" ||
      r.reviewer_analysis !== null && r.reviewer_analysis !== undefined,
    );
    this.records = interesting.slice(-15).reverse();
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: DecisionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): DecisionItem[] {
    if (this.records.length === 0) {
      const empty = new DecisionItem("All clear", "check", "");
      empty.description = "No flagged decisions";
      return [empty];
    }

    return this.records.map((r) => {
      const isRejected = r.human_decision === "reject" || r.human_decision === "edit";
      const severityIcon = r.severity === "high" ? "warning"
        : r.severity === "medium" ? "info"
        : isRejected ? "error" : "pass-filled";
      const severityColor = isRejected ? "testing.iconFailed"
        : r.severity === "high" ? "list.warningForeground"
        : "testing.iconPassed";

      const files = r.files.slice(0, 2).map((f) => f.split("/").pop()).join(", ");
      const filesExtra = r.files.length > 2 ? ` +${r.files.length - 2}` : "";
      const label = `${r.severity.toUpperCase()} · ${isRejected ? "rejected" : "accepted"}`;

      const item = new DecisionItem(label, severityIcon, `${files}${filesExtra}`);
      item.iconPath = new vscode.ThemeIcon(severityIcon, new vscode.ThemeColor(severityColor));

      // Click to open the first modified file
      if (r.files.length > 0) {
        item.command = {
          command: "vscode.open",
          title: "Open file",
          arguments: [vscode.Uri.file(r.files[0])],
        };
      }

      const reviewerLine = r.reviewer_analysis
        ? `\n\nReviewer (${r.reviewer_analysis.reviewerAgent}): **${r.reviewer_analysis.recommendation}**` +
          (r.reviewer_analysis.divergences.length > 0 ? `\n- ${r.reviewer_analysis.divergences.join("\n- ")}` : "")
        : "";

      const flagLines = r.decision_points.length > 0
        ? `\n\nFlags:\n${r.decision_points.map((dp) => `- ${dp.description}`).join("\n")}`
        : "";

      item.tooltip = new vscode.MarkdownString(
        `**${r.agent}** · ${r.tool} · ${r.severity}\n\n` +
        `*${r.intent || "(no intent)"}*\n\n` +
        `Files: ${r.files.join(", ")}` +
        flagLines +
        (r.human_note ? `\n\n> ${r.human_note}` : "") +
        reviewerLine,
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
