import * as vscode from "vscode";
import { DASHBOARD_CSS } from "./dashboard-styles";

/** State sent to the webview */
export interface DashboardState {
  project: string;
  version: string;
  branch: string;
  stacks: string[];
  clean: boolean;
  log: LogEntry[];
  files: FileChange[];
  agentRunning?: boolean;
  agentPaused?: boolean;
  agentKind?: string;
  agentPrompt?: string;
  agentTokens?: number;
  agentContextPct?: number;
  agentElapsed?: number;
  // Post-task review
  review?: {
    taskDesc: string;
    agentKind: string;
    duration: number;
    tokens: number;
    filesChanged: number;
    additions: number;
    deletions: number;
    gatePassed: boolean;
  };
  // HITL decision UI
  pendingDecision?: {
    action: {
      id: string;
      agent: string;
      tool: string;
      files: string[];
      intent: string;
      diff_preview?: string;
    };
    evaluation: {
      points: string[];
      severity: string;
      explanations: Record<string, string>;
    };
    reviewerAnalysis?: {
      reviewerAgent: string;
      recommendation: string;
      confidence: number;
      divergences: string[];
      risks: string[];
      suggestion?: string;
      understood_intent: string;
      actual_action: string;
    } | null;
    reviewerLoading?: boolean;
  };
  recentDecisions?: Array<{
    id: string;
    agent: string;
    tool: string;
    files: string[];
    intent: string;
    severity: string;
    human_decision: string;
    human_note?: string;
    ts: string;
  }>;
}

export interface LogEntry {
  time: string;
  message: string;
  level: "info" | "success" | "error" | "warn";
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export class DashboardPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: DashboardState;
  private extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private _onAction = new vscode.EventEmitter<{ command: string; data?: unknown }>();
  readonly onAction = this._onAction.event;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.state = {
      project: "",
      version: "0.0.0",
      branch: "",
      stacks: [],
      clean: true,
      log: [],
      files: [],
    };
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "gait.dashboard",
      "HITL-Gate Dashboard",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
      },
    );

    this.panel.iconPath = new vscode.ThemeIcon("shield");
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this._onAction.fire(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    }, undefined, this.disposables);

    // Send initial state
    this.pushState();
  }

  updateState(partial: Partial<DashboardState>): void {
    Object.assign(this.state, partial);
    this.pushState();
  }

  addLog(message: string, level: LogEntry["level"] = "info"): void {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    this.state.log.push({ time, message, level });
    if (this.state.log.length > 200) {
      this.state.log = this.state.log.slice(-200);
    }
    this.pushState();
  }

  private pushState(): void {
    this.panel?.webview.postMessage({ type: "state", data: this.state });
  }

  dispose(): void {
    this.panel?.dispose();
    this._onAction.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(webview: vscode.Webview): string {
    const css = DASHBOARD_CSS;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gait Dashboard</title>
  <style>${css}</style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
