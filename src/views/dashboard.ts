import * as vscode from "vscode";
import * as path from "path";
import type { PipelineResult, StageResult, StageName } from "../core/pipeline";

/** State sent to the webview */
export interface DashboardState {
  project: string;
  version: string;
  branch: string;
  stacks: string[];
  clean: boolean;
  stages: StageResult[];
  log: LogEntry[];
  files: FileChange[];
  pipelineRunning: boolean;
  lastGate?: { passed: boolean; duration: number };
  configuredStages: string[];
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
  // Regressions from baseline
  regressions?: string[];
  flakyTests?: string[];
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
      stages: [],
      log: [],
      files: [],
      pipelineRunning: false,
      configuredStages: [],
    };
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "gait.dashboard",
      "Gait Dashboard",
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

  updateStage(result: StageResult): void {
    const idx = this.state.stages.findIndex((s) => s.name === result.name);
    if (idx >= 0) {
      this.state.stages[idx] = result;
    } else {
      this.state.stages.push(result);
    }
    this.pushState();
  }

  setPipelineResult(result: PipelineResult): void {
    this.state.stages = result.stages;
    this.state.pipelineRunning = false;
    this.state.lastGate = { passed: result.passed, duration: result.duration };
    this.pushState();
  }

  resetStages(names: StageName[]): void {
    this.state.stages = names.map((name) => ({
      name,
      status: "pending" as const,
      output: "",
      error: "",
      duration: 0,
    }));
    this.state.pipelineRunning = true;
    this.pushState();
  }

  private pushState(): void {
    this.panel?.webview.postMessage({ type: "state", data: this.state });
  }

  dispose(): void {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(webview: vscode.Webview): string {
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
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --success: var(--vscode-testing-iconPassed);
      --error: var(--vscode-testing-iconFailed);
      --warn: var(--vscode-editorWarning-foreground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      padding: 16px;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 1.3em; font-weight: 600; }
    .header .version { color: var(--muted); }
    .header .branch {
      color: var(--accent);
      font-weight: 500;
    }
    .header .stack-badge {
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .header .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .header .status-dot.clean { background: var(--success); }
    .header .status-dot.dirty { background: var(--warn); }
    .header .spacer { flex: 1; }

    /* Stage badges */
    .stages {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .stage-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      transition: all 0.15s;
    }
    .stage-badge:hover { background: var(--input-bg); }
    .stage-badge.passed { border-color: var(--success); }
    .stage-badge.failed { border-color: var(--error); }
    .stage-badge.running { border-color: var(--warn); }
    .stage-badge .icon { font-size: 1.1em; }
    .stage-badge.passed .icon { color: var(--success); }
    .stage-badge.failed .icon { color: var(--error); }
    .stage-badge.running .icon { color: var(--warn); }
    .stage-badge .dur { color: var(--muted); font-size: 0.8em; margin-left: 4px; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .stage-badge.running .icon { animation: spin 1s linear infinite; }

    /* Sections */
    .section { margin-bottom: 16px; }
    .section-title {
      font-size: 0.8em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--border);
    }

    /* Log */
    .log {
      max-height: 300px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      line-height: 1.6;
    }
    .log-entry { display: flex; gap: 10px; }
    .log-time { color: var(--accent); min-width: 65px; }
    .log-msg { color: var(--muted); }
    .log-msg.success { color: var(--success); }
    .log-msg.error { color: var(--error); }
    .log-msg.warn { color: var(--warn); }
    .log-empty { color: var(--muted); font-style: italic; }

    /* Files */
    .file-list { font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
    .file-row { display: flex; gap: 10px; line-height: 1.6; }
    .file-path { flex: 1; }
    .file-add { color: var(--success); }
    .file-del { color: var(--error); }

    /* Action bar */
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .btn {
      padding: 6px 14px;
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
      font-family: inherit;
    }
    .btn:hover { background: var(--btn-hover); }
    .btn.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn.secondary:hover { background: var(--input-bg); }

    /* Gate result banner */
    .gate-banner {
      padding: 8px 14px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-weight: 500;
    }
    .gate-banner.passed {
      background: color-mix(in srgb, var(--success) 15%, transparent);
      color: var(--success);
      border: 1px solid var(--success);
    }
    .gate-banner.failed {
      background: color-mix(in srgb, var(--error) 15%, transparent);
      color: var(--error);
      border: 1px solid var(--error);
    }
  </style>
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
