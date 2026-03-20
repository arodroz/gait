import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "./core/config";
import * as git from "./core/git";
import * as secrets from "./core/secrets";
import * as hooks from "./core/hooks";
import * as prereq from "./core/prereq";
import * as rollback from "./core/rollback";
import * as release from "./core/release";
import * as agentsmd from "./core/agentsmd";
import * as recover from "./core/recover";
import * as scripts from "./core/scripts";
import * as scriptDetect from "./core/script-detect";
import * as monorepo from "./core/monorepo";
import { ensureLinterSetup } from "./core/linter-setup";
import { runPipeline, runStage, type StageName } from "./core/pipeline";
import { HistoryLogger } from "./core/history";
import { BaselineStore } from "./core/baseline";
import { FlakyTracker } from "./core/flaky";
import { findUntested } from "./core/coverage";
import { AgentRunner } from "./core/agent";
import { buildFixPrompt, runAutofixLoop } from "./core/autofix";
import { StatusBarManager } from "./views/statusbar";
import { PipelineTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";

let statusBar: StatusBarManager;
let pipelineTree: PipelineTreeProvider;
let dashboard: DashboardPanel;
let cfg: config.Config | undefined;
let cwd: string;
let lastPipelineResult: import("./core/pipeline").PipelineResult | undefined;
let agent: AgentRunner;
const outputChannels = new Map<string, vscode.OutputChannel>();

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  cwd = workspaceFolder.uri.fsPath;

  statusBar = new StatusBarManager();
  pipelineTree = new PipelineTreeProvider();
  dashboard = new DashboardPanel(context.extensionUri);
  agent = new AgentRunner();

  context.subscriptions.push(statusBar, dashboard);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gait.pipeline", pipelineTree),
  );

  if (config.configExists(cwd)) loadConfig();

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
  };
  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Dashboard action handler
  dashboard.onAction(async (msg) => {
    switch (msg.command) {
      case "gate": await cmdGate(); break;
      case "lint": await cmdRunStage("lint"); break;
      case "test": await cmdRunStage("test"); break;
      case "typecheck": await cmdRunStage("typecheck"); break;
      case "build": await cmdRunStage("build"); break;
      case "runStage": await cmdRunStage(msg.data as StageName); break;
      case "runAgent": await cmdRunAgent(); break;
      case "pauseAgent": agent.pause(); dashboard.addLog("Agent paused", "warn"); break;
      case "resumeAgent": agent.resume(); dashboard.addLog("Agent resumed", "info"); break;
      case "killAgent": agent.kill(); dashboard.addLog("Agent killed", "error"); break;
      case "rollback": await cmdRollback(); break;
      case "release": await cmdRelease(); break;
      case "commitGateApprove":
        dashboard.updateState({ commitGateOpen: false });
        dashboard.addLog("Commit approved via gate modal", "success");
        break;
      case "commitGateClose":
        dashboard.updateState({ commitGateOpen: false });
        break;
      case "fixStage":
        await cmdFixStage(msg.data as string, false);
        break;
      case "autofixStage":
        await cmdFixStage(msg.data as string, true);
        break;
    }
  });

  // File watcher
  const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, false, false);
  watcher.onDidChange(() => refreshFiles());
  watcher.onDidCreate(() => refreshFiles());
  watcher.onDidDelete(() => refreshFiles());
  context.subscriptions.push(watcher);

  // Hook trigger watcher — polls for pre-commit hook signals
  if (config.configExists(cwd)) {
    const hookInterval = setInterval(() => {
      if (hooks.checkHookTrigger(config.gaitDir(cwd))) {
        // Open dashboard with commit gate modal
        dashboard.open();
        dashboard.updateState({ commitGateOpen: true });
        cmdGate().then((passed) => {
          dashboard.updateState({ commitGateOpen: true }); // keep modal open with results
          hooks.writeHookResult(config.gaitDir(cwd), passed !== false);
        });
      }
    }, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(hookInterval) });
  }

  // Agent event wiring
  agent.on("output", (line: string) => {
    dashboard.addLog(`[agent] ${line}`, "info");
    // Push live stats to dashboard
    dashboard.updateState({
      agentTokens: agent.estimateTokens(),
      agentContextPct: agent.estimateContextPct(),
      agentElapsed: agent.elapsed(),
    });
  });
  agent.on("done", async (_code: number, duration: number) => {
    const dur = (duration / 1000).toFixed(1);
    const tokens = agent.estimateTokens();
    const taskDesc = agent.currentSession?.prompt ?? "";
    const agentKind = agent.currentSession?.kind ?? "";
    dashboard.addLog(`Agent finished (${dur}s, ~${(tokens / 1000).toFixed(1)}k tokens)`, "success");
    dashboard.updateState({ agentRunning: false, agentPaused: false, agentTokens: tokens });

    // Auto-pipeline after agent
    const gatePassed = await cmdGate();

    // Build post-task review
    const stats = await git.diffStat(cwd).catch(() => []);
    const totalAdd = stats.reduce((s, f) => s + f.additions, 0);
    const totalDel = stats.reduce((s, f) => s + f.deletions, 0);
    dashboard.updateState({
      review: {
        taskDesc,
        agentKind,
        duration,
        tokens,
        filesChanged: stats.length,
        additions: totalAdd,
        deletions: totalDel,
        gatePassed: gatePassed !== false,
      },
    });

    logHistory("agent_session", { kind: agentKind, prompt: taskDesc, duration, tokens });
  });
  agent.on("error", (err: string) => {
    dashboard.addLog(`Agent error: ${err}`, "error");
    dashboard.updateState({ agentRunning: false, agentPaused: false });
  });

  vscode.commands.executeCommand("setContext", "gait.initialized", config.configExists(cwd));
}

// --- Helpers ---

function loadConfig() {
  try {
    cfg = config.load(cwd);
    const stages = cfg.pipeline.stages as StageName[];
    statusBar.resetAll(stages);
    pipelineTree.reset(stages);
    updateDashboardInfo();
  } catch (err) {
    vscode.window.showErrorMessage(`Gait: failed to load config: ${err}`);
  }
}

async function updateDashboardInfo() {
  if (!cfg) return;
  const branchName = await git.branch(cwd).catch(() => "");
  const clean = await git.isClean(cwd).catch(() => true);
  const stacks = config.detectStacks(cwd);

  // Detect monorepo workspaces
  const workspaces = monorepo.detect(cwd);
  if (workspaces.length > 1) {
    dashboard.addLog(`Monorepo: ${workspaces.length} workspaces (${workspaces.map((w) => w.name).join(", ")})`, "info");
  }

  dashboard.updateState({
    project: cfg.project.name,
    version: "0.0.0",
    branch: branchName,
    stacks,
    clean,
    configuredStages: getConfiguredStages(),
  });
}

async function refreshFiles() {
  try {
    const stats = await git.diffStat(cwd);
    dashboard.updateState({
      files: stats.map((s) => ({
        path: s.path, additions: s.additions, deletions: s.deletions, status: "modified",
      })),
      clean: stats.length === 0,
    });
  } catch { /* ignore */ }
}

function getConfiguredStages(): string[] {
  if (!cfg) return [];
  const all: StageName[] = ["lint", "typecheck", "test", "build"];
  const keyMap: Record<StageName, keyof config.StackCommands> = {
    lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build",
  };
  const configured: string[] = [];
  for (const name of all) {
    for (const stack of Object.values(cfg.stacks)) {
      if (stack[keyMap[name]]) { configured.push(name); break; }
    }
  }
  return configured;
}

function getOutputChannel(name: string): vscode.OutputChannel {
  let ch = outputChannels.get(name);
  if (!ch) { ch = vscode.window.createOutputChannel(name); outputChannels.set(name, ch); }
  return ch;
}

function logHistory(kind: string, data: Record<string, unknown>) {
  try { new HistoryLogger(config.gaitDir(cwd)).log(kind as any, data); } catch { /* best-effort */ }
}

// --- Commands ---

async function cmdInit() {
  const stacks = config.detectStacks(cwd);
  const projectName = path.basename(cwd);
  const newCfg = config.defaultConfig(projectName, stacks);
  config.save(cwd, newCfg);

  const gitignorePath = path.join(cwd, config.DOT_DIR, ".gitignore");
  fs.writeFileSync(gitignorePath, "baseline_*.json\ncoverage.json\nflaky.json\nhistory/\n.hook-trigger\n.hook-result\n.lock\n");

  // Create default scripts
  scripts.createDefaults(path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR), newCfg.stacks);

  // Set up linter configs and install deps
  const linterResult = await ensureLinterSetup(cwd, stacks);
  const linterMsg: string[] = [];
  if (linterResult.created.length) linterMsg.push(`created: ${linterResult.created.join(", ")}`);
  if (linterResult.installed.length) linterMsg.push(`installed: ${linterResult.installed.join(", ")}`);
  if (linterResult.skipped.length) linterMsg.push(`skipped: ${linterResult.skipped.join(", ")}`);

  vscode.commands.executeCommand("setContext", "gait.initialized", true);
  loadConfig();

  const stackNames = stacks.join(", ") || "none detected";
  const linterInfo = linterMsg.length ? ` | Linter: ${linterMsg.join("; ")}` : "";
  vscode.window.showInformationMessage(`Gait initialized! Stacks: ${stackNames}${linterInfo}`);
}

async function cmdGate(): Promise<boolean> {
  if (!cfg) {
    vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first.");
    return false;
  }

  const stages = cfg.pipeline.stages as StageName[];
  statusBar.resetAll(stages);
  pipelineTree.reset(stages);
  dashboard.resetStages(stages);
  dashboard.addLog("Pipeline started", "info");

  // Secret scan
  try {
    const stagedDiff = await git.diff(cwd, true);
    if (stagedDiff) {
      const findings = secrets.scanDiff(stagedDiff);
      if (findings.length > 0) {
        dashboard.addLog(`Secrets detected: ${findings.length} finding(s)`, "error");
        vscode.window.showErrorMessage(`Gait: ${findings.length} potential secret(s) in staged changes`);
        logHistory("secret_scan", { findings: findings.length });
        return false;
      }
    }
  } catch { /* no staged changes */ }

  const result = await runPipeline(cfg, cwd, {
    onStageStart: (name) => {
      statusBar.setStageStatus(name, "running");
      pipelineTree.refresh([{ name, status: "running", output: "", error: "", duration: 0 }]);
      dashboard.updateStage({ name, status: "running", output: "", error: "", duration: 0 });
      dashboard.addLog(`${cap(name)} started...`, "info");
    },
    onStageComplete: (r) => {
      statusBar.setStageStatus(r.name, r.status, r.duration);
      pipelineTree.refresh([r]);
      dashboard.updateStage(r);
      const dur = (r.duration / 1000).toFixed(1);
      if (r.status === "passed") dashboard.addLog(`${cap(r.name)} passed (${dur}s)`, "success");
      else if (r.status === "failed") dashboard.addLog(`${cap(r.name)} FAILED (${dur}s)`, "error");
    },
  });

  lastPipelineResult = result;
  statusBar.setGateStatus(result.passed, result.duration);
  dashboard.setPipelineResult(result);

  const dur = (result.duration / 1000).toFixed(1);
  if (result.passed) {
    dashboard.addLog(`Pipeline PASSED (${dur}s)`, "success");
    vscode.window.showInformationMessage(`Gait: Pipeline passed (${dur}s)`);
  } else {
    const failedStages = result.stages.filter((s) => s.status === "failed");
    const failed = failedStages.map((s) => s.name);
    dashboard.addLog(`Pipeline FAILED [${failed.join(", ")}] (${dur}s)`, "error");
    vscode.window.showErrorMessage(`Gait: Pipeline failed — ${failed.join(", ")}`);

    // Option D: auto-fix when config says so
    if (cfg?.pipeline.autofix && failedStages.length > 0) {
      const agentKind = (cfg.pipeline.autofix_agent ?? "claude") as import("./core/agent").AgentKind;
      const maxAttempts = cfg.pipeline.autofix_max_attempts ?? 3;
      dashboard.addLog(`Autofix enabled — launching ${agentKind} (max ${maxAttempts} attempts)`, "info");
      const fixed = await runAutofixLoop(
        failedStages[0], cwd, agentKind, maxAttempts,
        () => cmdGate(),
        {
          onAttemptStart: (n, max) => {
            dashboard.addLog(`Autofix attempt ${n}/${max}...`, "info");
            dashboard.updateState({ agentRunning: true, agentKind: agentKind, agentPaused: false });
          },
          onAttemptEnd: (r) => {
            dashboard.updateState({ agentRunning: false });
            dashboard.addLog(r.success ? `Fixed on attempt ${r.attempt}` : `Attempt ${r.attempt} failed`, r.success ? "success" : "warn");
          },
          onAgentOutput: (line) => dashboard.addLog(`[autofix] ${line}`, "info"),
          onGateStart: () => dashboard.addLog("Re-running gate...", "info"),
          onGateResult: (passed) => { if (passed) dashboard.addLog("Gate passed after autofix!", "success"); },
        },
        getStageCommand(failedStages[0].name as StageName),
      );
      if (fixed) return true;
    }
  }

  logHistory("pipeline_run", {
    passed: result.passed, duration: result.duration,
    stages: result.stages.map((s) => ({ name: s.name, status: s.status, duration: s.duration })),
  });

  // Regression detection against baseline
  try {
    const branchName = await git.branch(cwd).catch(() => "main");
    const gaitDirPath = config.gaitDir(cwd);
    const baselineStore = new BaselineStore(gaitDirPath);
    const flakyTracker = new FlakyTracker(gaitDirPath);

    // Parse test stage output for test names (basic: count pass/fail lines)
    const testStage = result.stages.find((s) => s.name === "test");
    if (testStage && testStage.status !== "skipped") {
      // Update flaky tracker and check regressions
      const report = baselineStore.diff([], branchName); // empty until we have a test parser
      const flakyList = flakyTracker.flakyTests();
      const regressions = report.regressions
        .map((r) => `${r.package}/${r.name}`)
        .filter((name) => !flakyTracker.isFlaky(name));

      if (regressions.length > 0) {
        dashboard.addLog(`${regressions.length} regression(s) detected`, "error");
        dashboard.updateState({ regressions, flakyTests: flakyList });
      } else {
        dashboard.updateState({ regressions: [], flakyTests: flakyList });
      }
    }
  } catch { /* baseline check is best-effort */ }

  // Untested new code detection
  try {
    const stagedFiles = await git.stagedFiles(cwd).catch(() => [] as string[]);
    const changedFiles = stagedFiles.length > 0 ? stagedFiles : (await git.diffStat(cwd)).map((s) => s.path);
    if (changedFiles.length > 0 && cfg) {
      const stack = Object.keys(cfg.stacks)[0] ?? "";
      const untested = await findUntested(cwd, changedFiles, stack);
      if (untested.length > 0) {
        dashboard.addLog(`${untested.length} new function(s) without test coverage`, "warn");
        const names = untested.slice(0, 5).map((u) => `${u.file}:${u.name}`);
        for (const n of names) dashboard.addLog(`  untested: ${n}`, "warn");
        if (untested.length > 5) dashboard.addLog(`  ...and ${untested.length - 5} more`, "warn");
      }
    }
  } catch { /* coverage check is best-effort */ }

  return result.passed;
}

async function cmdRunStage(name: StageName) {
  if (!cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }

  const keyMap: Record<StageName, keyof config.StackCommands> = {
    lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build",
  };
  let cmd = "";
  for (const stack of Object.values(cfg.stacks)) {
    if (stack[keyMap[name]]) { cmd = stack[keyMap[name]]; break; }
  }
  if (!cmd) { vscode.window.showWarningMessage(`No command configured for '${name}'`); return; }

  statusBar.setStageStatus(name, "running");
  dashboard.updateStage({ name, status: "running", output: "", error: "", duration: 0 });
  dashboard.addLog(`${cap(name)} started...`, "info");

  const result = await runStage(name, cmd, cwd, 300_000);
  statusBar.setStageStatus(name, result.status, result.duration);
  pipelineTree.refresh([result]);
  dashboard.updateStage(result);

  const dur = (result.duration / 1000).toFixed(1);
  if (result.status === "passed") {
    dashboard.addLog(`${cap(name)} passed (${dur}s)`, "success");
  } else {
    dashboard.addLog(`${cap(name)} FAILED (${dur}s)`, "error");
    if (result.error) {
      const ch = getOutputChannel(`Gait: ${cap(name)}`);
      ch.clear();
      ch.appendLine(result.error);
      if (result.output) ch.appendLine(result.output);
      ch.show(true);
    }
  }
}

async function cmdOpenDashboard() {
  dashboard.open();
  await updateDashboardInfo();
}

async function cmdInstallHook() {
  const result = hooks.installPreCommitHook(cwd);
  if (result.installed) {
    vscode.window.showInformationMessage(`Gait: ${result.message}`);
  } else {
    vscode.window.showErrorMessage(`Gait: ${result.message}`);
  }
}

async function cmdRunAgent() {
  if (agent.running) {
    const action = await vscode.window.showQuickPick(["Pause", "Resume", "Kill"], { placeHolder: "Agent is running" });
    if (action === "Pause") agent.pause();
    else if (action === "Resume") agent.resume();
    else if (action === "Kill") agent.kill();
    return;
  }

  // Offline mode: check which agents are available
  const available: string[] = [];
  const claudeCheck = await prereq.commandExists("claude");
  const codexCheck = await prereq.commandExists("codex");
  if (claudeCheck.passed) available.push("claude");
  if (codexCheck.passed) available.push("codex");

  if (available.length === 0) {
    vscode.window.showWarningMessage("No AI agents found on PATH. Install claude or codex to use agent features.");
    return;
  }

  const kind = await vscode.window.showQuickPick(available, { placeHolder: "Select agent" });
  if (!kind) return;

  const prompt = await vscode.window.showInputBox({ prompt: "Enter prompt for the agent", placeHolder: "Fix the failing test..." });
  if (!prompt) return;

  dashboard.addLog(`Starting ${kind} agent...`, "info");
  dashboard.updateState({ agentRunning: true, agentKind: kind, agentPrompt: prompt, agentPaused: false });

  try {
    await agent.start(kind as any, prompt, cwd);
  } catch (err) {
    dashboard.addLog(`Failed to start agent: ${err}`, "error");
    dashboard.updateState({ agentRunning: false });
  }
}

async function cmdRollback() {
  const commits = await rollback.recentCommits(cwd);
  if (!commits.length) {
    vscode.window.showInformationMessage("No commits to rollback.");
    return;
  }

  const items = commits.map((c) => ({
    label: c.hash.slice(0, 8),
    description: c.subject,
    detail: c.date,
    hash: c.hash,
    subject: c.subject,
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select commit to revert" });
  if (!picked) return;

  // Find test command
  let testCmd = "";
  if (cfg) {
    for (const stack of Object.values(cfg.stacks)) {
      if (stack.Test) { testCmd = stack.Test; break; }
    }
  }

  dashboard.addLog(`Simulating revert of ${picked.label} "${picked.subject}"...`, "info");
  const sim = await rollback.simulateRollback(cwd, picked.hash, testCmd, (msg) => {
    dashboard.addLog(`[rollback] ${msg}`, "info");
  });

  if (sim.error) {
    vscode.window.showErrorMessage(`Rollback: ${sim.error}`);
    dashboard.addLog(`Rollback failed: ${sim.error}`, "error");
    return;
  }

  const detail = `${sim.filesAffected} file(s) affected. Tests ${sim.testsPassed ? "PASS" : "FAIL"}.`;
  if (sim.canRevert) {
    const action = await vscode.window.showInformationMessage(
      `Revert "${picked.subject}"? ${detail}`,
      "Revert", "Cancel",
    );
    if (action === "Revert") {
      const result = await rollback.applyRevert(cwd, picked.hash);
      if (result.success) {
        dashboard.addLog("Revert applied", "success");
        vscode.window.showInformationMessage("Revert applied successfully.");
        logHistory("rollback", { commit: picked.hash, subject: picked.subject });
      } else {
        vscode.window.showErrorMessage(`Revert failed: ${result.error}`);
      }
    }
  } else {
    vscode.window.showWarningMessage(`Revert would break tests. ${detail}`);
    dashboard.addLog(`Revert would cause failures — aborted`, "warn");
  }
}

async function cmdRelease() {
  if (!cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }

  // Check clean working tree
  const clean = await git.isClean(cwd);
  if (!clean) {
    vscode.window.showWarningMessage("Working tree is dirty — commit or stash changes first.");
    return;
  }

  dashboard.addLog("Analyzing release...", "info");
  const info = await release.analyzeRelease(cwd);

  if (info.commitCount === 0) {
    vscode.window.showInformationMessage("No new commits since last release.");
    return;
  }

  const ch = getOutputChannel("Gait: Release");
  ch.clear();
  ch.appendLine(`Current: v${info.currentVersion}`);
  ch.appendLine(`Bump: ${info.bumpType}`);
  ch.appendLine(`Next: v${info.nextVersion}`);
  ch.appendLine(`Commits: ${info.commitCount}`);
  ch.appendLine("");
  ch.appendLine(info.changelog);
  ch.show(true);

  // Run gate first
  dashboard.addLog("Running gate before release...", "info");
  const gateOk = await cmdGate();
  if (!gateOk) {
    vscode.window.showErrorMessage("Gate failed — release aborted.");
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Release v${info.nextVersion}? (${info.bumpType} bump, ${info.commitCount} commits)`,
    "Tag Only", "Tag + Push", "Cancel",
  );

  if (action === "Cancel" || !action) return;

  const result = await release.executeRelease(cwd, info.nextVersion, action === "Tag + Push");
  if (result.success) {
    dashboard.addLog(`Released v${info.nextVersion}`, "success");
    vscode.window.showInformationMessage(`Released v${info.nextVersion}`);
    logHistory("commit", { tag: `v${info.nextVersion}`, bump: info.bumpType });
  } else {
    vscode.window.showErrorMessage(`Release failed: ${result.error}`);
  }
}

async function cmdRecover() {
  const items = await recover.recover(cwd, config.gaitDir(cwd));
  if (items.length === 0) {
    vscode.window.showInformationMessage("Nothing to recover. All clean.");
    return;
  }
  const cleaned = items.filter((i) => i.cleaned).length;
  vscode.window.showInformationMessage(`Recovered ${cleaned}/${items.length} items.`);
  for (const item of items) {
    dashboard.addLog(`Recovered ${item.type}: ${item.path}`, item.cleaned ? "success" : "error");
  }
}

async function cmdPreflight() {
  const stacks = config.detectStacks(cwd);
  const results = await prereq.runDefaultChecks(stacks);

  const ch = getOutputChannel("Gait: Preflight");
  ch.clear();
  let allOk = true;
  for (const r of results) {
    ch.appendLine(`${r.passed ? "✓" : "✗"} ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    if (!r.passed) allOk = false;
  }
  ch.show(true);

  if (allOk) {
    vscode.window.showInformationMessage("All prerequisites met.");
  } else {
    vscode.window.showWarningMessage("Some prerequisites are missing — see output.");
  }
}

async function cmdGenerateAgentsMd() {
  if (!cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }
  const stacks = config.detectStacks(cwd);
  const content = agentsmd.generate(cfg, stacks);
  const filePath = path.join(cwd, "AGENTS.md");
  fs.writeFileSync(filePath, content);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
  dashboard.addLog("Generated AGENTS.md", "success");
}

async function cmdRunScript() {
  const scriptsDir = path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  const available = scripts.listScripts(scriptsDir);
  if (!available.length) {
    vscode.window.showInformationMessage("No scripts found in .gait/scripts/");
    return;
  }

  const items = available.map((s) => ({
    label: s.name,
    description: s.description,
    detail: s.depends.length ? `depends: ${s.depends.join(", ")}` : undefined,
    script: s,
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select script to run" });
  if (!picked) return;

  dashboard.addLog(`Running script "${picked.script.name}"...`, "info");
  const result = await scripts.runScript(picked.script, cwd);
  const dur = (result.duration / 1000).toFixed(1);

  if (result.passed) {
    dashboard.addLog(`Script "${picked.script.name}" passed (${dur}s)`, "success");
    vscode.window.showInformationMessage(`Script "${picked.script.name}" passed (${dur}s)`);
  } else {
    dashboard.addLog(`Script "${picked.script.name}" FAILED (${dur}s)`, "error");
    const ch = getOutputChannel(`Gait: Script`);
    ch.clear();
    if (result.error) ch.appendLine(result.error);
    if (result.output) ch.appendLine(result.output);
    ch.show(true);
  }
  logHistory("stage_run", { script: picked.script.name, passed: result.passed, duration: result.duration });
}

async function cmdListScripts() {
  const scriptsDir = path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  const available = scripts.listScripts(scriptsDir);
  if (!available.length) {
    vscode.window.showInformationMessage("No scripts in .gait/scripts/");
    return;
  }

  const ch = getOutputChannel("Gait: Scripts");
  ch.clear();
  for (const s of available) {
    ch.appendLine(`${s.name}  ${s.description || "(no description)"}`);
    if (s.depends.length) ch.appendLine(`  depends: ${s.depends.join(", ")}`);
    ch.appendLine(`  timeout: ${s.timeout / 1000}s  expect: ${s.expect}`);
    ch.appendLine("");
  }
  ch.show(true);
}

async function cmdDetectScripts() {
  const gaitDirPath = config.gaitDir(cwd);
  const scriptsDir = path.join(gaitDirPath, config.SCRIPTS_DIR);
  const patterns = scriptDetect.detectPatterns(gaitDirPath);

  if (!patterns.length) {
    vscode.window.showInformationMessage("No repeated patterns found in history yet. Keep using gait and check back later.");
    return;
  }

  // Filter out already-scripted patterns
  const novel = patterns.filter((p) => !scriptDetect.isAlreadyScripted(scriptsDir, p.command));
  if (!novel.length) {
    vscode.window.showInformationMessage("All detected patterns already have scripts.");
    return;
  }

  const items = novel.map((p) => ({
    label: p.command,
    description: `${p.count} times`,
    detail: `Last used: ${new Date(p.lastUsed).toLocaleDateString()}`,
    pattern: p,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select pattern to save as script",
    canPickMany: true,
  });
  if (!picked?.length) return;

  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const item of picked) {
    const suggestion = scriptDetect.suggestScript(item.pattern);
    fs.writeFileSync(path.join(scriptsDir, suggestion.filename), suggestion.content, { mode: 0o755 });
    dashboard.addLog(`Created script: ${suggestion.filename}`, "success");
  }
  vscode.window.showInformationMessage(`Created ${picked.length} script(s) in .gait/scripts/`);
}

async function cmdFixStage(stageName: string, autoLoop: boolean) {
  // Find the failed stage result from last gate run
  // We need to get it from the dashboard state — store last pipeline result
  const failedStage = lastPipelineResult?.stages.find(
    (s) => s.name === stageName && s.status === "failed",
  );
  if (!failedStage) {
    vscode.window.showWarningMessage(`No failure data for stage '${stageName}'`);
    return;
  }

  // Check agent availability
  const claudeCheck = await prereq.commandExists("claude");
  const codexCheck = await prereq.commandExists("codex");
  const available: string[] = [];
  if (claudeCheck.passed) available.push("claude");
  if (codexCheck.passed) available.push("codex");

  if (available.length === 0) {
    vscode.window.showWarningMessage("No AI agents on PATH. Install claude or codex.");
    return;
  }

  const agentKind = available.length === 1
    ? available[0]
    : await vscode.window.showQuickPick(available, { placeHolder: "Select agent to fix" });
  if (!agentKind) return;

  // Find the command gait uses for this stage
  const stageCmd = getStageCommand(stageName as StageName);

  if (autoLoop) {
    // Option B: auto-fix loop
    dashboard.addLog(`Auto-fix loop: ${stageName} (max 3 attempts)`, "info");
    const fixed = await runAutofixLoop(
      failedStage, cwd, agentKind as any, 3,
      () => cmdGate(),
      {
        onAttemptStart: (n, max) => {
          dashboard.addLog(`Fix attempt ${n}/${max}...`, "info");
          dashboard.updateState({ agentRunning: true, agentKind, agentPaused: false });
        },
        onAttemptEnd: (result) => {
          dashboard.updateState({ agentRunning: false });
          if (result.success) {
            dashboard.addLog(`Fixed on attempt ${result.attempt}!`, "success");
          } else {
            dashboard.addLog(`Attempt ${result.attempt} failed`, "warn");
          }
        },
        onAgentOutput: (line) => dashboard.addLog(`[fix] ${line}`, "info"),
        onGateStart: () => dashboard.addLog("Re-running gate...", "info"),
        onGateResult: (passed) => {
          if (passed) dashboard.addLog("Gate passed after fix!", "success");
        },
      },
      stageCmd,
    );

    if (!fixed) {
      dashboard.addLog("Auto-fix exhausted all attempts", "error");
      vscode.window.showWarningMessage("Auto-fix couldn't resolve the issue after 3 attempts.");
    }
  } else {
    // Option C: scoped fix — full prompt with optional extra context
    const fullPrompt = buildFixPrompt(failedStage, cwd, stageCmd);

    const extraContext = await vscode.window.showInputBox({
      prompt: "Add extra context for the agent (optional, press Enter to send as-is)",
      placeHolder: "e.g., 'The error is in the config parser' or leave empty",
    });
    if (extraContext === undefined) return; // cancelled

    const finalPrompt = extraContext
      ? `${extraContext}\n\n---\n\n${fullPrompt}`
      : fullPrompt;

    dashboard.addLog(`Sending fix to ${agentKind} (${stageCmd || stageName})...`, "info");
    dashboard.updateState({
      agentRunning: true,
      agentKind,
      agentPrompt: `Fix: ${stageName}`,
      agentPaused: false,
    });

    try {
      await agent.start(agentKind as any, finalPrompt, cwd);
    } catch (err) {
      dashboard.addLog(`Fix agent failed to start: ${err}`, "error");
      dashboard.updateState({ agentRunning: false });
    }
  }
}

function getStageCommand(name: StageName): string {
  if (!cfg) return "";
  const keyMap: Record<StageName, keyof config.StackCommands> = {
    lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build",
  };
  for (const stack of Object.values(cfg.stacks)) {
    const key = keyMap[name];
    if (key && stack[key]) return stack[key];
  }
  return "";
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deactivate() {}
