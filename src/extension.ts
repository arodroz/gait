import * as vscode from "vscode";
import * as config from "./core/config";
import * as hooks from "./core/hooks";
import * as snapshot from "./core/snapshot";
import * as memory from "./core/memory";
import { parseDuration } from "./core/util";
import { AgentRunner } from "./core/agent";
import { CostTracker } from "./core/cost-tracker";
import { StatusBarManager } from "./views/statusbar";
import { PipelineTreeProvider, ActionsTreeProvider, InfoTreeProvider, ScriptsTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";
import { state } from "./state";
import { loadConfig, refreshFiles, sendNotify, getFirstChangedLine } from "./commands/helpers";
import { cmdInit } from "./commands/init";
import { cmdGate, cmdRunStage } from "./commands/gate";
import { cmdRunAgent, cmdFixStage, cmdCodeReview, cmdGenerateTests, cmdEditMemory, cmdViewMemory, cmdCostSummary } from "./commands/agent";
import { cmdOpenDashboard, cmdInstallHook, cmdRollback, cmdRelease, cmdRecover, cmdPreflight,
  cmdGenerateAgentsMd, cmdRunScript, cmdListScripts, cmdDetectScripts, cmdSnapshot,
  cmdRestoreSnapshot, cmdSwitchProfile, cmdCreatePR, cmdRunWorkflow, cmdAuditDeps,
  cmdInstallAllHooks, cmdManageHooks } from "./commands/misc";
import type { StageName } from "./core/pipeline";
import * as path from "path";
import * as git from "./core/git";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  state.cwd = workspaceFolder.uri.fsPath;

  // Initialize components
  state.statusBar = new StatusBarManager();
  state.pipelineTree = new PipelineTreeProvider();
  state.actionsTree = new ActionsTreeProvider();
  state.infoTree = new InfoTreeProvider();
  state.scriptsTree = new ScriptsTreeProvider();
  state.dashboard = new DashboardPanel(context.extensionUri);
  state.agent = new AgentRunner();
  state.costTracker = new CostTracker(config.gaitDir(state.cwd));

  context.subscriptions.push(state.statusBar, state.dashboard);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gait.pipeline", state.pipelineTree),
    vscode.window.registerTreeDataProvider("gait.actions", state.actionsTree),
    vscode.window.registerTreeDataProvider("gait.scripts", state.scriptsTree),
    vscode.window.registerTreeDataProvider("gait.info", state.infoTree),
  );

  if (config.configExists(state.cwd)) loadConfig();

  // Register all commands
  const commands: Record<string, () => Promise<unknown>> = {
    "gait.init": cmdInit,
    "gait.gate": cmdGate,
    "gait.runLint": () => cmdRunStage("lint"),
    "gait.runTest": () => cmdRunStage("test"),
    "gait.runTypecheck": () => cmdRunStage("typecheck"),
    "gait.runBuild": () => cmdRunStage("build"),
    "gait.openDashboard": cmdOpenDashboard,
    "gait.release": cmdRelease,
    "gait.installHook": cmdInstallHook,
    "gait.runAgent": cmdRunAgent,
    "gait.rollback": cmdRollback,
    "gait.recover": cmdRecover,
    "gait.preflight": cmdPreflight,
    "gait.generateAgentsMd": cmdGenerateAgentsMd,
    "gait.runScript": cmdRunScript,
    "gait.listScripts": cmdListScripts,
    "gait.detectScripts": cmdDetectScripts,
    "gait.snapshot": cmdSnapshot,
    "gait.restoreSnapshot": cmdRestoreSnapshot,
    "gait.switchProfile": cmdSwitchProfile,
    "gait.createPR": cmdCreatePR,
    "gait.runWorkflow": cmdRunWorkflow,
    "gait.costSummary": cmdCostSummary,
    "gait.editMemory": cmdEditMemory,
    "gait.viewMemory": cmdViewMemory,
    "gait.codeReview": cmdCodeReview,
    "gait.generateTestsForFile": cmdGenerateTests,
    "gait.auditDeps": cmdAuditDeps,
    "gait.installAllHooks": cmdInstallAllHooks,
    "gait.manageHooks": cmdManageHooks,
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Dashboard action handler
  state.dashboard.onAction(async (msg) => {
    switch (msg.command) {
      case "gate": await cmdGate(); break;
      case "lint": await cmdRunStage("lint"); break;
      case "test": await cmdRunStage("test"); break;
      case "typecheck": await cmdRunStage("typecheck"); break;
      case "build": await cmdRunStage("build"); break;
      case "runStage": await cmdRunStage(msg.data as StageName); break;
      case "runAgent": await cmdRunAgent(); break;
      case "pauseAgent": state.agent.pause(); state.dashboard.addLog("Agent paused", "warn"); break;
      case "resumeAgent": state.agent.resume(); state.dashboard.addLog("Agent resumed", "info"); break;
      case "killAgent": state.agent.kill(); state.dashboard.addLog("Agent killed", "error"); break;
      case "rollback": await cmdRollback(); break;
      case "release": await cmdRelease(); break;
      case "commitGateApprove": state.dashboard.updateState({ commitGateOpen: false }); state.dashboard.addLog("Commit approved", "success"); break;
      case "commitGateClose": state.dashboard.updateState({ commitGateOpen: false }); break;
      case "requestState": state.dashboard.updateState({}); break;
      case "switchProfile": await cmdSwitchProfile(); break;
      case "restoreSnapshot": await cmdRestoreSnapshot(); break;
      case "createPR": await cmdCreatePR(); break;
      case "fixStage": await cmdFixStage(msg.data as string, false); break;
      case "autofixStage": await cmdFixStage(msg.data as string, true); break;
      case "openDiff": {
        const uri = vscode.Uri.file(path.join(state.cwd, msg.data as string));
        await vscode.commands.executeCommand("git.openChange", uri);
        break;
      }
      case "openFile": {
        const doc = await vscode.workspace.openTextDocument(path.join(state.cwd, msg.data as string));
        await vscode.window.showTextDocument(doc);
        break;
      }
      case "openFileAtChange": {
        const firstLine = await getFirstChangedLine(msg.data as string);
        const doc = await vscode.workspace.openTextDocument(path.join(state.cwd, msg.data as string));
        const editor = await vscode.window.showTextDocument(doc);
        if (firstLine > 0) {
          const pos = new vscode.Position(firstLine - 1, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
        break;
      }
    }
  });

  // File watcher
  const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, false, false);
  watcher.onDidChange(() => refreshFiles());
  watcher.onDidCreate(() => refreshFiles());
  watcher.onDidDelete(() => refreshFiles());
  context.subscriptions.push(watcher);

  // Hook trigger watcher
  if (config.configExists(state.cwd)) {
    const hookInterval = setInterval(() => {
      if (hooks.checkHookTrigger(config.gaitDir(state.cwd))) {
        const savedProfile = state.currentProfile;
        state.currentProfile = (state.cfg?.pipeline as any)?.commit_profile ?? "full";
        state.dashboard.open();
        state.dashboard.updateState({ commitGateOpen: true });
        cmdGate().then((passed) => {
          state.currentProfile = savedProfile;
          state.dashboard.updateState({ commitGateOpen: true });
          hooks.writeHookResult(config.gaitDir(state.cwd), passed !== false);
        });
      }
    }, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(hookInterval) });
  }

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
    const retention = parseDuration((state.cfg?.pipeline as any)?.snapshot_retention ?? "24h");
    snapshot.prune(state.cwd, config.gaitDir(state.cwd), retention).catch(() => {});

    const dur = (duration / 1000).toFixed(1);
    const tokens = state.agent.estimateTokens();
    const taskDesc = state.agent.currentSession?.prompt ?? "";
    const agentKind = state.agent.currentSession?.kind ?? "";
    state.dashboard.addLog(`Agent finished (${dur}s, ~${(tokens / 1000).toFixed(1)}k tokens)`, "success");
    state.dashboard.updateState({ agentRunning: false, agentPaused: false, agentTokens: tokens });

    state.costTracker.estimateFromLines(agentKind, taskDesc, state.agent.currentSession?.lines ?? 0, duration);
    sendNotify("agent.done", `Agent ${agentKind} finished (${dur}s)`, { tokens, duration: dur });

    const gatePassed = await cmdGate();

    const stats = await git.diffStat(state.cwd).catch(() => []);
    state.dashboard.updateState({
      review: {
        taskDesc, agentKind, duration, tokens,
        filesChanged: stats.length,
        additions: stats.reduce((s, f) => s + f.additions, 0),
        deletions: stats.reduce((s, f) => s + f.deletions, 0),
        gatePassed: gatePassed !== false,
      },
    });
    sendNotify(gatePassed ? "gate.passed" : "gate.failed", `Gate ${gatePassed ? "passed" : "failed"} after agent`, {});
  });

  state.agent.on("error", (err: string) => {
    if (state.diffPollInterval) { clearInterval(state.diffPollInterval); state.diffPollInterval = undefined; }
    state.dashboard.addLog(`Agent error: ${err}`, "error");
    state.dashboard.updateState({ agentRunning: false, agentPaused: false });
  });

  vscode.commands.executeCommand("setContext", "gait.initialized", config.configExists(state.cwd));
}

export function deactivate() {
  if (state.diffPollInterval) clearInterval(state.diffPollInterval);
}
