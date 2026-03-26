import * as vscode from "vscode";
import * as config from "./core/config";
import * as snapshot from "./core/snapshot";
import { parseDuration } from "./core/util";
import { AgentRunner } from "./core/agent";
import { CostTracker } from "./core/cost-tracker";
import { ActionLogger } from "./core/action-logger";
import { Interceptor, type WebviewPendingData } from "./core/interceptor";
import { DecorationManager } from "./views/decorations";
import { StatusBarManager } from "./views/statusbar";
import { ActionsTreeProvider, InfoTreeProvider, DecisionsTreeProvider, AgentsTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";
import type { DashboardState } from "./views/dashboard";
import { state } from "./state";
import { loadConfig, refreshFiles, getFirstChangedLine } from "./commands/helpers";
import { getOutputChannel } from "./state";
import { cmdInit } from "./commands/init";
import { cmdRunAgent, cmdCodeReview, cmdEditMemory, cmdViewMemory, cmdCostSummary } from "./commands/agent";
import { cmdOpenDashboard, cmdRollback, cmdRecover, cmdPreflight,
  cmdSnapshot, cmdRestoreSnapshot, cmdRunWorkflow } from "./commands/misc";
import { cmdInstallClaudeHooks } from "./commands/claude-hooks-cmd";
import { cmdRunCodex } from "./commands/codex-cmd";
import { cmdOpenJournal, cmdExportJournal } from "./commands/journal";
import { cmdGenerateAgentsMd } from "./commands/agents-md-cmd";
import { detectLearnedPatterns, formatSuggestions } from "./core/learned-patterns";
import * as path from "path";
import * as git from "./core/git";

let decorationManager: DecorationManager | undefined;

function resolveWorkspacePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(state.cwd, filePath);
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  state.cwd = workspaceFolder.uri.fsPath;

  // Initialize components
  state.statusBar = new StatusBarManager();
  state.decisionsTree = new DecisionsTreeProvider();
  state.actionsTree = new ActionsTreeProvider();
  state.infoTree = new InfoTreeProvider();
  state.agentsTree = new AgentsTreeProvider();
  state.dashboard = new DashboardPanel(context.extensionUri);
  state.agent = new AgentRunner();
  state.costTracker = new CostTracker(config.gaitDir(state.cwd));

  context.subscriptions.push(state.statusBar, state.dashboard);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gait.decisions", state.decisionsTree),
    vscode.window.registerTreeDataProvider("gait.actions", state.actionsTree),
    vscode.window.registerTreeDataProvider("gait.info", state.infoTree),
    vscode.window.registerTreeDataProvider("gait.agents", state.agentsTree),
  );

  if (config.configExists(state.cwd)) {
    loadConfig();
    startInterceptor(context);
    startDecorations(context);
  }

  // Register commands
  const commands: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    "gait.init": cmdInit,
    "gait.openDashboard": cmdOpenDashboard,
    "gait.runAgent": cmdRunAgent,
    "gait.rollback": cmdRollback,
    "gait.recover": cmdRecover,
    "gait.preflight": cmdPreflight,
    "gait.snapshot": cmdSnapshot,
    "gait.restoreSnapshot": cmdRestoreSnapshot,
    "gait.runWorkflow": cmdRunWorkflow,
    "gait.costSummary": cmdCostSummary,
    "gait.editMemory": cmdEditMemory,
    "gait.viewMemory": cmdViewMemory,
    "gait.codeReview": cmdCodeReview,
    "gait.installClaudeHooks": () => cmdInstallClaudeHooks(context.extensionUri.fsPath),
    "gait.runCodex": cmdRunCodex,
    "gait.openJournal": cmdOpenJournal,
    "gait.exportJournal": cmdExportJournal,
    "gait.generateAgentsMd": cmdGenerateAgentsMd,
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Dashboard action handler
  context.subscriptions.push(state.dashboard.onAction(async (msg) => {
    switch (msg.command) {
      case "runAgent": await cmdRunAgent(); break;
      case "pauseAgent": state.agent.pause(); state.dashboard.addLog("Agent paused", "warn"); break;
      case "resumeAgent": state.agent.resume(); state.dashboard.addLog("Agent resumed", "info"); break;
      case "killAgent": state.agent.kill(); state.dashboard.addLog("Agent killed", "error"); break;
      case "rollback": await cmdRollback(); break;
      case "requestState": {
        // Populate recent decisions from the log when webview requests state
        if (sharedLogger) {
          sharedLogger.readRecent(10).then((records) => {
            state.dashboard.updateState({
              recentDecisions: records.reverse().map((r) => ({
                id: r.id, agent: r.agent, tool: r.tool, files: r.files,
                severity: r.severity, human_decision: r.human_decision,
                human_note: r.human_note, ts: r.ts, intent: r.intent,
              })),
            });
          }).catch(() => {});
        } else {
          state.dashboard.updateState({});
        }
        break;
      }
      case "restoreSnapshot": await cmdRestoreSnapshot(); break;
      case "openDiff": {
        try {
          const uri = vscode.Uri.file(resolveWorkspacePath(msg.data as string));
          await vscode.commands.executeCommand("git.openChange", uri);
        } catch { /* file may no longer exist */ }
        break;
      }
      case "openFile": {
        try {
          const doc = await vscode.workspace.openTextDocument(resolveWorkspacePath(msg.data as string));
          await vscode.window.showTextDocument(doc);
        } catch { vscode.window.showWarningMessage(`File not found: ${msg.data}`); }
        break;
      }
      case "openFileAtChange": {
        try {
          const firstLine = await getFirstChangedLine(msg.data as string);
          const doc = await vscode.workspace.openTextDocument(resolveWorkspacePath(msg.data as string));
          const editor = await vscode.window.showTextDocument(doc);
          if (firstLine > 0) {
            const pos = new vscode.Position(firstLine - 1, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
        } catch { vscode.window.showWarningMessage(`File not found: ${msg.data}`); }
        break;
      }
      case "decision": {
        const { id, decision, note } = msg.data as { id: string; decision: string; note?: string };
        // Try to resolve via interceptor first (rich webview flow)
        if (sharedInterceptor) {
          sharedInterceptor.resolveWebviewDecision(id, decision as "accept" | "reject" | "edit", note);
        } else {
          // Fallback: write decision file directly
          const decisionPath = path.join(config.gaitDir(state.cwd), "decisions", `${id}.json`);
          const fs = await import("fs");
          await fs.promises.mkdir(path.dirname(decisionPath), { recursive: true });
          await fs.promises.writeFile(decisionPath, JSON.stringify({ id, decision, note, ts: new Date().toISOString() }));
        }
        state.dashboard.updateState({ pendingDecision: undefined });
        state.dashboard.addLog(`Decision: ${decision} for ${id}`, decision === "accept" ? "success" : "warn");
        break;
      }
      case "editPrompt": {
        const actionId = msg.data as string;
        const note = await vscode.window.showInputBox({
          prompt: "Add a note for the agent (included in rejection message)",
          placeHolder: "Scope changes to the new route only, do not modify existing middleware",
        });
        if (note !== undefined) {
          if (sharedInterceptor) {
            sharedInterceptor.resolveWebviewDecision(actionId, "reject", note);
          } else {
            const decisionPath = path.join(config.gaitDir(state.cwd), "decisions", `${actionId}.json`);
            const fs = await import("fs");
            await fs.promises.mkdir(path.dirname(decisionPath), { recursive: true });
            await fs.promises.writeFile(decisionPath, JSON.stringify({ id: actionId, decision: "reject", note, ts: new Date().toISOString() }));
          }
          state.dashboard.updateState({ pendingDecision: undefined });
          state.dashboard.addLog(`Rejected with note: ${actionId}`, "warn");
        }
        break;
      }
    }
  }));

  // File watcher — scope to tracked files, exclude .git and node_modules
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, "{src,lib,app,packages}/**/*"),
    false, false, false,
  );
  let refreshDebounce: NodeJS.Timeout | undefined;
  const debouncedRefresh = () => {
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(() => refreshFiles(), 500);
  };
  watcher.onDidChange(debouncedRefresh);
  watcher.onDidCreate(debouncedRefresh);
  watcher.onDidDelete(debouncedRefresh);
  context.subscriptions.push(watcher);

  // Agent events
  state.agent.on("output", (line: string) => {
    state.dashboard.addLog(`[agent] ${line}`, "info");
    state.dashboard.updateState({
      agentTokens: state.agent.estimateTokens(),
      agentContextPct: state.agent.estimateContextPct(),
      agentElapsed: state.agent.elapsed(),
    });
  });

  state.agent.on("done", async (_code: number, duration: number) => {
    if (state.diffPollInterval) { clearInterval(state.diffPollInterval); state.diffPollInterval = undefined; }
    const retention = parseDuration(state.cfg?.snapshots.retention ?? "48h");
    snapshot.prune(state.cwd, config.gaitDir(state.cwd), retention).catch(() => {});

    const dur = (duration / 1000).toFixed(1);
    const tokens = state.agent.estimateTokens();
    const agentKind = state.agent.currentSession?.kind ?? "";
    state.dashboard.addLog(`Agent finished (${dur}s, ~${(tokens / 1000).toFixed(1)}k tokens)`, "success");
    state.dashboard.updateState({ agentRunning: false, agentPaused: false, agentTokens: tokens });

    state.costTracker.estimateFromLines(agentKind, state.agent.currentSession?.prompt ?? "", state.agent.currentSession?.lines ?? 0, duration);
    const stats = await git.diffStat(state.cwd).catch(() => []);
    state.dashboard.updateState({
      review: {
        taskDesc: state.agent.currentSession?.prompt ?? "", agentKind, duration, tokens,
        filesChanged: stats.length,
        additions: stats.reduce((s, f) => s + f.additions, 0),
        deletions: stats.reduce((s, f) => s + f.deletions, 0),
        gatePassed: true,
      },
    });

    // Refresh decorations after agent finishes
    decorationManager?.refreshAll();
  });

  state.agent.on("error", (err: string) => {
    if (state.diffPollInterval) { clearInterval(state.diffPollInterval); state.diffPollInterval = undefined; }
    state.dashboard.addLog(`Agent error: ${err}`, "error");
    state.dashboard.updateState({ agentRunning: false, agentPaused: false });
  });

  vscode.commands.executeCommand("setContext", "gait.initialized", config.configExists(state.cwd));
}

let sharedLogger: ActionLogger | undefined;
let sharedInterceptor: Interceptor | undefined;

function startInterceptor(context: vscode.ExtensionContext) {
  if (!state.cfg) return;
  const gaitDir = config.gaitDir(state.cwd);
  sharedLogger = new ActionLogger(gaitDir);
  const interceptor = new Interceptor(state.cwd, gaitDir, state.cfg, sharedLogger, async (action, decision, evaluation) => {
    const level = decision.decision === "reject" ? "warn" : "info";
    state.dashboard.addLog(
      `[${action.agent}] ${action.tool} ${action.files.join(", ")} → ${decision.decision} (${evaluation.severity})`,
      level,
    );

    // Record rejections as corrections in memory for future agent context
    if (decision.decision === "reject" && decision.note) {
      try {
        const { addCorrection } = await import("./core/memory");
        addCorrection(gaitDir, `${action.intent} → ${action.files.join(", ")}`, decision.note, "user");
      } catch { /* memory write is best-effort */ }
    }

    // Update decisions tree + dashboard recent decisions
    const records = await sharedLogger!.readRecent(20);
    state.decisionsTree.update(records);
    state.dashboard.updateState({
      pendingDecision: undefined,
      recentDecisions: records.slice(-10).reverse().map((r) => ({
        id: r.id, agent: r.agent, tool: r.tool, files: r.files,
        severity: r.severity, human_decision: r.human_decision,
        human_note: r.human_note, ts: r.ts, intent: r.intent,
      })),
    });

    // Refresh decorations
    decorationManager?.refreshAll();
  }, (pendingData: WebviewPendingData) => {
    // Show rich decision UI in the webview dashboard
    state.dashboard.open();
    state.dashboard.updateState({ pendingDecision: pendingData as DashboardState["pendingDecision"] });
  }, (queue: NonNullable<DashboardState["pendingQueue"]>) => {
    state.dashboard.updateState({ pendingQueue: queue as DashboardState["pendingQueue"] });
  });

  sharedInterceptor = interceptor;
  const disposable = interceptor.start();
  state.interceptorWatcher = disposable;
  context.subscriptions.push(disposable);

  // Load initial decisions tree + check for learned patterns
  sharedLogger.readRecent(50).then((records) => {
    state.decisionsTree.update(records.slice(-20));
    state.dashboard.updateState({
      recentDecisions: records.slice(-10).reverse().map((r) => ({
        id: r.id, agent: r.agent, tool: r.tool, files: r.files,
        severity: r.severity, human_decision: r.human_decision,
        human_note: r.human_note, ts: r.ts, intent: r.intent,
      })),
    });

    const suggestions = detectLearnedPatterns(records);
    if (suggestions.length > 0) {
      const msg = formatSuggestions(suggestions);
      vscode.window.showInformationMessage(
        `HITL-Gate: ${suggestions.length} path pattern(s) frequently rejected. View suggestions?`,
        "View",
      ).then((choice) => {
        if (choice === "View") {
          const ch = getOutputChannel("HITL-Gate: Suggestions");
          ch.clear();
          ch.appendLine(msg);
          ch.show(true);
        }
      });
    }
  }).catch((err) => console.warn("[hitlgate] Failed to load initial decisions:", err));
}

function startDecorations(context: vscode.ExtensionContext) {
  const gaitDir = config.gaitDir(state.cwd);
  const logger = sharedLogger ?? new ActionLogger(gaitDir);
  decorationManager = new DecorationManager(context.extensionUri.fsPath, state.cwd, logger);

  // Apply decorations when editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) decorationManager?.applyToEditor(editor);
    }),
  );

  // Clear decorations on git commit
  const commitWatcher = vscode.workspace.createFileSystemWatcher("**/.git/COMMIT_EDITMSG");
  commitWatcher.onDidChange(() => decorationManager?.clearAll());
  context.subscriptions.push(commitWatcher);

  context.subscriptions.push({ dispose: () => decorationManager?.dispose() });

  // Apply to current editor
  if (vscode.window.activeTextEditor) {
    decorationManager.applyToEditor(vscode.window.activeTextEditor);
  }
}

export function deactivate() {
  if (state.diffPollInterval) clearInterval(state.diffPollInterval);
  if (state.interceptorWatcher) state.interceptorWatcher.dispose();
  decorationManager?.dispose();
  for (const ch of state.outputChannels.values()) ch.dispose();
  state.outputChannels.clear();
  state.agent?.kill();
}
