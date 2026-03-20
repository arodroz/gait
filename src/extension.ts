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
import { run } from "./core/runner";
import { HistoryLogger } from "./core/history";
import { BaselineStore } from "./core/baseline";
import { FlakyTracker } from "./core/flaky";
import { findUntested } from "./core/coverage";
import { parseTestOutput } from "./core/test-parser";
import { AgentRunner } from "./core/agent";
import { buildFixPrompt, runAutofixLoop } from "./core/autofix";
import { StatusBarManager } from "./views/statusbar";
import { PipelineTreeProvider, ActionsTreeProvider, InfoTreeProvider, ScriptsTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";

let statusBar: StatusBarManager;
let pipelineTree: PipelineTreeProvider;
let actionsTree: ActionsTreeProvider;
let infoTree: InfoTreeProvider;
let scriptsTree: ScriptsTreeProvider;
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
  actionsTree = new ActionsTreeProvider();
  infoTree = new InfoTreeProvider();
  scriptsTree = new ScriptsTreeProvider();
  dashboard = new DashboardPanel(context.extensionUri);
  agent = new AgentRunner();

  context.subscriptions.push(statusBar, dashboard);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gait.pipeline", pipelineTree),
    vscode.window.registerTreeDataProvider("gait.actions", actionsTree),
    vscode.window.registerTreeDataProvider("gait.scripts", scriptsTree),
    vscode.window.registerTreeDataProvider("gait.info", infoTree),
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
      case "requestState":
        // Re-push current state (for section collapse re-render)
        dashboard.updateState({});
        break;
      case "fixStage":
        await cmdFixStage(msg.data as string, false);
        break;
      case "autofixStage":
        await cmdFixStage(msg.data as string, true);
        break;
      case "openDiff": {
        const filePath = msg.data as string;
        const uri = vscode.Uri.file(path.join(cwd, filePath));
        await vscode.commands.executeCommand("git.openChange", uri);
        break;
      }
      case "openFile": {
        const filePath = msg.data as string;
        const doc = await vscode.workspace.openTextDocument(path.join(cwd, filePath));
        await vscode.window.showTextDocument(doc);
        break;
      }
      case "openFileAtChange": {
        const filePath = msg.data as string;
        const firstLine = await getFirstChangedLine(filePath);
        const doc = await vscode.workspace.openTextDocument(path.join(cwd, filePath));
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
    scriptsTree.update(scripts.listScripts(path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR)));
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

  // Detect monorepo workspaces + affected
  const workspaces = monorepo.detect(cwd);
  let affectedWs: monorepo.Workspace[] = [];
  let wsData: { name: string; path: string; kind: string; affected: boolean }[] = [];

  if (workspaces.length > 1) {
    const changedFiles = (await git.diffStat(cwd).catch(() => [])).map((s) => s.path);
    affectedWs = monorepo.affected(workspaces, changedFiles);
    wsData = workspaces.map((ws) => ({
      name: ws.name,
      path: ws.path,
      kind: ws.kind,
      affected: affectedWs.some((a) => a.path === ws.path),
    }));
    dashboard.addLog(
      `Monorepo: ${workspaces.length} workspaces, ${affectedWs.length} affected`,
      "info",
    );
  }

  // Get version from latest git tag
  const tagResult = await run("git", ["describe", "--tags", "--abbrev=0"], cwd, 5000).catch(() => null);
  const version = tagResult?.exitCode === 0 ? tagResult.stdout.trim().replace(/^v/, "") : "0.0.0";

  dashboard.updateState({
    project: cfg.project.name,
    version,
    branch: branchName,
    stacks,
    clean,
    configuredStages: getConfiguredStages(),
  });

  infoTree.update({ project: cfg.project.name, branch: branchName, stacks, clean, workspaces: wsData });
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
  const alreadyInitialized = config.configExists(cwd);

  // If already initialized, ask what to do
  if (alreadyInitialized) {
    const action = await vscode.window.showQuickPick(
      [
        { label: "Re-initialize", description: "Overwrite config with fresh defaults (backs up existing)" },
        { label: "Merge", description: "Keep existing config, add missing stacks and scripts only" },
        { label: "Cancel", description: "Do nothing" },
      ],
      { placeHolder: ".gait/ already exists. What would you like to do?" },
    );
    if (!action || action.label === "Cancel") return;

    if (action.label === "Re-initialize") {
      // Backup existing config
      const configPath = path.join(cwd, config.DOT_DIR, config.CONFIG_FILE);
      if (fs.existsSync(configPath)) {
        const backupPath = configPath + ".backup." + Date.now();
        fs.copyFileSync(configPath, backupPath);
        dashboard.addLog(`Backed up config to ${path.basename(backupPath)}`, "info");
      }
      await doFullInit(stacks, projectName);
    } else {
      // Merge: only add what's missing
      await doMergeInit(stacks);
    }
  } else {
    await doFullInit(stacks, projectName);
  }

  vscode.commands.executeCommand("setContext", "gait.initialized", true);
  loadConfig();
}

async function doFullInit(stacks: config.Stack[], projectName: string) {
  const newCfg = config.defaultConfig(projectName, stacks);
  config.save(cwd, newCfg);

  // .gitignore — append if exists, create if not
  const gitignorePath = path.join(cwd, config.DOT_DIR, ".gitignore");
  const gitignoreContent = "baseline_*.json\ncoverage.json\nflaky.json\nhistory/\n.hook-trigger\n.hook-result\n.lock\n";
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    const toAdd = gitignoreContent.split("\n").filter((l) => l && !existing.includes(l));
    if (toAdd.length) fs.appendFileSync(gitignorePath, "\n" + toAdd.join("\n") + "\n");
  } else {
    fs.mkdirSync(path.join(cwd, config.DOT_DIR), { recursive: true });
    fs.writeFileSync(gitignorePath, gitignoreContent);
  }

  // Scripts — only create if file doesn't exist
  const scriptsDir = path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const [stack, cmds] of Object.entries(newCfg.stacks)) {
    const existing = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir) : [];
    const write = (name: string, content: string) => {
      if (!existing.includes(name)) {
        fs.writeFileSync(path.join(scriptsDir, name), content, { mode: 0o755 });
      }
    };
    if (cmds.Lint) write(`${stack}_lint.sh`, scripts.generateScript("lint", `Run ${stack} linter`, cmds.Lint));
    if (cmds.Test) write(`${stack}_test.sh`, scripts.generateScript("test", `Run ${stack} tests`, cmds.Test, ["lint"]));
    if (cmds.Typecheck) write(`${stack}_typecheck.sh`, scripts.generateScript("typecheck", `Run ${stack} type checker`, cmds.Typecheck));
    if (cmds.Build) write(`${stack}_build.sh`, scripts.generateScript("build", `Build ${stack} project`, cmds.Build));
  }

  // Linter setup — ask before installing deps
  const linterResult = await ensureLinterSetup(cwd, stacks);
  const msgs: string[] = [];
  if (linterResult.created.length) msgs.push(`Linter configs: ${linterResult.created.join(", ")}`);
  if (linterResult.installed.length) msgs.push(`Installed: ${linterResult.installed.join(", ")}`);
  if (linterResult.skipped.length) msgs.push(`Skipped: ${linterResult.skipped.join(", ")}`);

  const stackNames = stacks.join(", ") || "none detected";
  const details = msgs.length ? ` | ${msgs.join("; ")}` : "";
  vscode.window.showInformationMessage(`Gait initialized! Stacks: ${stackNames}${details}`);
}

async function doMergeInit(stacks: config.Stack[]) {
  const existing = config.load(cwd);

  // Add missing stacks only
  let added = 0;
  for (const stack of stacks) {
    if (!existing.stacks[stack]) {
      existing.stacks[stack] = config.defaultCommands(stack);
      added++;
    }
  }

  if (added > 0) {
    config.save(cwd, existing);
    dashboard.addLog(`Merged ${added} new stack(s) into config`, "success");
  }

  // Scripts — only add missing ones
  const scriptsDir = path.join(cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  fs.mkdirSync(scriptsDir, { recursive: true });
  const existingScripts = fs.readdirSync(scriptsDir);
  let scriptsAdded = 0;
  for (const [stack, cmds] of Object.entries(existing.stacks)) {
    const write = (name: string, content: string) => {
      if (!existingScripts.includes(name)) {
        fs.writeFileSync(path.join(scriptsDir, name), content, { mode: 0o755 });
        scriptsAdded++;
      }
    };
    if (cmds.Lint) write(`${stack}_lint.sh`, scripts.generateScript("lint", `Run ${stack} linter`, cmds.Lint));
    if (cmds.Test) write(`${stack}_test.sh`, scripts.generateScript("test", `Run ${stack} tests`, cmds.Test, ["lint"]));
    if (cmds.Typecheck) write(`${stack}_typecheck.sh`, scripts.generateScript("typecheck", `Run ${stack} type checker`, cmds.Typecheck));
    if (cmds.Build) write(`${stack}_build.sh`, scripts.generateScript("build", `Build ${stack} project`, cmds.Build));
  }

  // Linter setup for new stacks only
  const newStacks = stacks.filter((s) => !existing.stacks[s]);
  if (newStacks.length) {
    await ensureLinterSetup(cwd, newStacks);
  }

  vscode.window.showInformationMessage(
    `Gait merge: ${added} stack(s) added, ${scriptsAdded} script(s) created`,
  );
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

  // Monorepo: scope tests to affected workspaces (unless triggered by commit hook = full suite)
  let effectiveCfg = cfg;
  const workspaces = monorepo.detect(cwd);
  if (workspaces.length > 1 && !cfg.pipeline.autofix) {
    const changedFiles = (await git.diffStat(cwd).catch(() => [])).map((s) => s.path);
    const affectedWs = monorepo.affected(workspaces, changedFiles);

    if (affectedWs.length > 0 && affectedWs.length < workspaces.length) {
      // Build scoped config: replace test/lint commands with affected-only versions
      effectiveCfg = JSON.parse(JSON.stringify(cfg)) as config.Config;
      const scopedTest = affectedWs.map((ws) => monorepo.scopedTestCommand(ws, "")).filter(Boolean).join(" && ");
      const scopedLint = affectedWs.map((ws) => monorepo.scopedLintCommand(ws, "")).filter(Boolean).join(" && ");

      for (const stack of Object.values(effectiveCfg.stacks)) {
        if (scopedTest && stack.Test) stack.Test = scopedTest;
        if (scopedLint && stack.Lint) stack.Lint = scopedLint;
      }

      dashboard.addLog(
        `Scoped to ${affectedWs.length} affected workspace(s): ${affectedWs.map((w) => w.name).join(", ")}`,
        "info",
      );
    }
  }

  const result = await runPipeline(effectiveCfg, cwd, {
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
  pipelineTree.setGateResult(result.passed, result.duration);
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
    const stack = cfg ? Object.keys(cfg.stacks)[0] ?? "" : "";

    const testStage = result.stages.find((s) => s.name === "test");
    if (testStage && testStage.status !== "skipped") {
      // Parse test output into structured results
      const testOutput = testStage.output + "\n" + testStage.error;
      const currentResults = parseTestOutput(testOutput, stack);

      if (currentResults.length > 0) {
        // Diff against baseline
        const report = baselineStore.diff(currentResults, branchName);

        // Update flaky tracker
        for (const t of currentResults) {
          const key = `${t.package}/${t.name}`;
          flakyTracker.update(key, t.passed);
        }
        flakyTracker.save();

        const flakyList = flakyTracker.flakyTests();
        const regressions = report.regressions
          .map((r) => `${r.package}/${r.name}`)
          .filter((name) => !flakyTracker.isFlaky(name));

        if (regressions.length > 0) {
          dashboard.addLog(`${regressions.length} regression(s) detected`, "error");
          for (const r of regressions.slice(0, 5)) {
            dashboard.addLog(`  REGRESSION: ${r}`, "error");
          }
          dashboard.updateState({ regressions, flakyTests: flakyList });
        } else {
          dashboard.updateState({ regressions: [], flakyTests: flakyList });
        }

        if (report.newTests.length > 0) {
          dashboard.addLog(`${report.newTests.length} new test(s) detected`, "info");
        }

        // Save current results as new baseline (only if tests passed)
        if (testStage.status === "passed") {
          baselineStore.save({ branch: branchName, tests: currentResults, updatedAt: "" });
          dashboard.addLog(`Baseline saved: ${currentResults.length} test(s) on ${branchName}`, "info");
        }
      }
    }
  } catch { /* baseline check is best-effort */ }

  // Untested new code detection
  try {
    const stagedFiles = await git.stagedFiles(cwd).catch(() => [] as string[]);
    const changedFiles = stagedFiles.length > 0 ? stagedFiles : (await git.diffStat(cwd)).map((s) => s.path);
    if (changedFiles.length > 0 && cfg) {
      const stack = Object.keys(cfg.stacks)[0] ?? "";
      dashboard.addLog(`Running coverage analysis (${stack})...`, "info");
      dashboard.updateState({ coverageStatus: "running" });
      const covResult = await findUntested(cwd, changedFiles, stack);
      if (covResult.error) {
        dashboard.addLog(`Coverage: ${covResult.error}`, "warn");
        dashboard.updateState({ coverageStatus: "error", coverageError: covResult.error, coverage: [] });
      } else if (covResult.uncovered.length > 0) {
        dashboard.addLog(`${covResult.uncovered.length} function(s) without test coverage`, "warn");
        for (const u of covResult.uncovered.slice(0, 5)) {
          dashboard.addLog(`  untested: ${u.file}:${u.name}`, "warn");
        }
        if (covResult.uncovered.length > 5) {
          dashboard.addLog(`  ...and ${covResult.uncovered.length - 5} more`, "warn");
        }
        dashboard.updateState({ coverageStatus: "done", coverage: covResult.uncovered, coverageError: undefined });
      } else {
        dashboard.addLog(`Coverage: all changed functions are tested`, "success");
        dashboard.updateState({ coverageStatus: "done", coverage: [], coverageError: undefined });
      }
    }
  } catch (err) {
    dashboard.addLog(`Coverage check failed: ${err}`, "warn");
  }

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

  const hasDeps = picked.script.depends.length > 0;
  if (hasDeps) {
    dashboard.addLog(`Running "${picked.script.name}" with deps: ${picked.script.depends.join(" → ")} → ${picked.script.name}`, "info");
  } else {
    dashboard.addLog(`Running script "${picked.script.name}"...`, "info");
  }

  const { results, allPassed } = await scripts.runWithDeps(
    picked.script,
    available,
    cwd,
    (name) => dashboard.addLog(`  Running dep: ${name}...`, "info"),
  );

  for (const { name, result } of results) {
    const dur = (result.duration / 1000).toFixed(1);
    if (result.passed) {
      dashboard.addLog(`  ${name} passed (${dur}s)`, "success");
    } else {
      dashboard.addLog(`  ${name} FAILED (${dur}s)`, "error");
      const ch = getOutputChannel(`Gait: Script`);
      ch.clear();
      if (result.error) ch.appendLine(result.error);
      if (result.output) ch.appendLine(result.output);
      ch.show(true);
    }
  }

  const totalDur = results.reduce((s, r) => s + r.result.duration, 0);
  if (allPassed) {
    vscode.window.showInformationMessage(`Script "${picked.script.name}" passed (${(totalDur / 1000).toFixed(1)}s)`);
  } else {
    const failed = results.filter((r) => !r.result.passed).map((r) => r.name);
    vscode.window.showErrorMessage(`Script failed: ${failed.join(", ")}`);
  }
  logHistory("stage_run", { script: picked.script.name, passed: allPassed, duration: totalDur });
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

async function getFirstChangedLine(filePath: string): Promise<number> {
  try {
    const result = await run("git", ["diff", "-U0", filePath], cwd, 10_000);
    // Parse unified diff for first @@ hunk header: @@ -a,b +c,d @@
    const match = result.stdout.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
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
