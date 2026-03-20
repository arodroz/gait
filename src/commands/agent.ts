import * as vscode from "vscode";
import * as path from "path";
import * as config from "../core/config";
import * as git from "../core/git";
import * as prereq from "../core/prereq";
import * as snapshot from "../core/snapshot";
import * as prompts from "../core/prompts";
import * as memory from "../core/memory";
import { getCurrentDiffs } from "../core/diff-watcher";
import { buildFixPrompt, runAutofixLoop } from "../core/autofix";
import { blameError, enhancePromptWithBlame } from "../core/blame";
import { findUntested } from "../core/coverage";
import { generateTests } from "../core/test-gen";
import { reviewDiff } from "../core/review";
import type { StageName } from "../core/pipeline";
import { state } from "../state";
import { getStageCommand, getOutputChannel } from "./helpers";
import { cmdGate } from "./gate";

export async function cmdRunAgent() {
  if (state.agent.running) {
    const action = await vscode.window.showQuickPick(["Pause", "Resume", "Kill"], { placeHolder: "Agent is running" });
    if (action === "Pause") state.agent.pause();
    else if (action === "Resume") state.agent.resume();
    else if (action === "Kill") state.agent.kill();
    return;
  }

  const available: string[] = [];
  if ((await prereq.commandExists("claude")).passed) available.push("claude");
  if ((await prereq.commandExists("codex")).passed) available.push("codex");
  if (!available.length) { vscode.window.showWarningMessage("No AI agents on PATH."); return; }

  const kind = await vscode.window.showQuickPick(available, { placeHolder: "Select agent" });
  if (!kind) return;

  // Prompt template picker
  const templates = prompts.listTemplates(config.gaitDir(state.cwd));
  let prompt: string | undefined;
  if (templates.length > 0) {
    const choice = await vscode.window.showQuickPick(
      [{ label: "Custom prompt", description: "Type your own" }, ...templates.map((t) => ({ label: t.name, description: t.description }))],
      { placeHolder: "Select prompt template or custom" },
    );
    if (!choice) return;
    if (choice.label === "Custom prompt") {
      prompt = await vscode.window.showInputBox({ prompt: "Enter prompt", placeHolder: "Fix the failing test..." });
    } else {
      const tmpl = templates.find((t) => t.name === choice.label)!;
      const vars: Record<string, string> = {};
      for (const v of tmpl.variables) { const val = await vscode.window.showInputBox({ prompt: `Value for {{${v}}}` }); if (val === undefined) return; vars[v] = val; }
      prompt = prompts.interpolate(tmpl.body, vars);
    }
  } else {
    prompt = await vscode.window.showInputBox({ prompt: "Enter prompt", placeHolder: "Fix the failing test..." });
  }
  if (!prompt) return;

  // Budget check
  const budget = (state.cfg?.pipeline as any)?.daily_budget_usd ?? 0;
  if (budget > 0 && !state.costTracker.canRun(budget)) {
    vscode.window.showWarningMessage(`Daily budget ($${budget}) exceeded.`);
    return;
  }

  // Snapshot
  const snap = await snapshot.take(state.cwd, config.gaitDir(state.cwd));
  state.dashboard.addLog(`Snapshot: ${snap.id}`, "info");

  // Prepend memory
  const memoryPrefix = memory.buildPromptPrefix(config.gaitDir(state.cwd));
  const fullPrompt = memoryPrefix ? `${memoryPrefix}\n\n---\n\n${prompt}` : prompt;

  state.dashboard.addLog(`Starting ${kind} agent...`, "info");
  state.dashboard.updateState({ agentRunning: true, agentKind: kind, agentPrompt: prompt.slice(0, 80), agentPaused: false });

  // Diff polling
  state.diffPollInterval = setInterval(async () => {
    const diffs = await getCurrentDiffs(state.cwd);
    if (diffs.length > 0) {
      state.dashboard.updateState({
        files: diffs.map((d) => {
          const adds = (d.hunks.match(/^\+[^+]/gm) || []).length;
          const dels = (d.hunks.match(/^-[^-]/gm) || []).length;
          return { path: d.file, additions: adds, deletions: dels, status: "modified" };
        }),
      });
    }
  }, 2000);

  try {
    await state.agent.start(kind as any, fullPrompt, state.cwd);
  } catch (err) {
    if (state.diffPollInterval) { clearInterval(state.diffPollInterval); state.diffPollInterval = undefined; }
    state.dashboard.addLog(`Failed to start agent: ${err}`, "error");
    state.dashboard.updateState({ agentRunning: false });
  }
}

export async function cmdFixStage(stageName: string, autoLoop: boolean) {
  const failedStage = state.lastPipelineResult?.stages.find((s) => s.name === stageName && s.status === "failed");
  if (!failedStage) { vscode.window.showWarningMessage(`No failure data for '${stageName}'`); return; }

  const available: string[] = [];
  if ((await prereq.commandExists("claude")).passed) available.push("claude");
  if ((await prereq.commandExists("codex")).passed) available.push("codex");
  if (!available.length) { vscode.window.showWarningMessage("No AI agents on PATH."); return; }

  const agentKind = available.length === 1 ? available[0] : await vscode.window.showQuickPick(available, { placeHolder: "Select agent" });
  if (!agentKind) return;

  const stageCmd = getStageCommand(stageName as StageName);

  if (autoLoop) {
    const blameInfo = await blameError(state.cwd, failedStage.error + "\n" + failedStage.output);
    const blameCtx = blameInfo ? enhancePromptWithBlame("", blameInfo) : undefined;
    if (blameInfo) state.dashboard.addLog(`Blame: ${blameInfo.commitHash.slice(0, 8)} by ${blameInfo.author}`, "info");
    state.dashboard.addLog(`Auto-fix loop: ${stageName} (max 3)`, "info");
    const fixed = await runAutofixLoop(failedStage, state.cwd, agentKind as any, 3, () => cmdGate(),
      {
        onAttemptStart: (n, max) => { state.dashboard.addLog(`Fix ${n}/${max}...`, "info"); state.dashboard.updateState({ agentRunning: true, agentKind, agentPaused: false }); },
        onAttemptEnd: (r) => { state.dashboard.updateState({ agentRunning: false }); state.dashboard.addLog(r.success ? `Fixed on ${r.attempt}` : `Attempt ${r.attempt} failed`, r.success ? "success" : "warn"); },
        onAgentOutput: (line) => state.dashboard.addLog(`[fix] ${line}`, "info"),
        onGateStart: () => state.dashboard.addLog("Re-running gate...", "info"),
        onGateResult: (passed) => { if (passed) state.dashboard.addLog("Gate passed!", "success"); },
      }, stageCmd, blameCtx);
    if (!fixed) { memory.addCorrection(config.gaitDir(state.cwd), failedStage.error.slice(0, 200), "Autofix failed", "autofix"); vscode.window.showWarningMessage("Auto-fix exhausted."); }
  } else {
    let fullPrompt = buildFixPrompt(failedStage, state.cwd, stageCmd);
    const memPrefix = memory.buildPromptPrefix(config.gaitDir(state.cwd));
    if (memPrefix) fullPrompt = memPrefix + "\n\n---\n\n" + fullPrompt;
    const blame = await blameError(state.cwd, failedStage.error + "\n" + failedStage.output);
    if (blame) { fullPrompt = enhancePromptWithBlame(fullPrompt, blame); state.dashboard.addLog(`Blame: ${blame.commitHash.slice(0, 8)}`, "info"); }
    const extra = await vscode.window.showInputBox({ prompt: "Extra context (optional)", placeHolder: "Leave empty to send as-is" });
    if (extra === undefined) return;
    const finalPrompt = extra ? `${extra}\n\n---\n\n${fullPrompt}` : fullPrompt;
    state.dashboard.addLog(`Sending fix to ${agentKind}...`, "info");
    state.dashboard.updateState({ agentRunning: true, agentKind, agentPrompt: `Fix: ${stageName}`, agentPaused: false });
    try { await state.agent.start(agentKind as any, finalPrompt, state.cwd); } catch (err) { state.dashboard.addLog(`Failed: ${err}`, "error"); state.dashboard.updateState({ agentRunning: false }); }
  }
}

export async function cmdCodeReview() {
  if (!state.cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }
  state.dashboard.addLog("Running AI code review...", "info");
  const diff = await git.diff(state.cwd, true).catch(() => "") || await git.diff(state.cwd, false).catch(() => "");
  if (!diff) { vscode.window.showInformationMessage("No changes to review."); return; }
  const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
  const reviewCfg = (state.cfg as any).review ?? {};
  const result = await reviewDiff(state.cwd, config.gaitDir(state.cwd), diff, changedFiles, reviewCfg.agent ?? "claude",
    (line) => state.dashboard.addLog(`[review] ${line}`, "info"));
  const dur = (result.duration / 1000).toFixed(1);
  if (result.findings.length === 0) { state.dashboard.addLog(`Review passed (${dur}s)`, "success"); vscode.window.showInformationMessage("No issues."); }
  else {
    const ch = getOutputChannel("Gait: Review"); ch.clear();
    for (const f of result.findings) { ch.appendLine(`[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.message}`); if (f.suggestion) ch.appendLine(`  Suggestion: ${f.suggestion}`); }
    ch.show(true);
    state.dashboard.addLog(`Review: ${result.findings.length} finding(s) (${dur}s)`, result.findings.some((f) => f.severity === "error") ? "error" : "warn");
  }
}

export async function cmdGenerateTests() {
  if (!state.cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }
  const files = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: "Select source file", filters: { "Source": ["ts", "js", "py", "go"] } });
  if (!files?.length) return;
  const sourceFile = path.relative(state.cwd, files[0].fsPath);
  const stack = Object.keys(state.cfg.stacks)[0] ?? "";
  let testCmd = ""; for (const s of Object.values(state.cfg.stacks)) { if (s.Test) { testCmd = s.Test; break; } }
  state.dashboard.addLog(`Analyzing coverage for ${sourceFile}...`, "info");
  const covResult = await findUntested(state.cwd, [sourceFile], stack);
  const uncovered = covResult.uncovered.length > 0 ? covResult.uncovered.map((u) => u.name) : ["(all exported functions)"];
  state.dashboard.addLog(`Generating tests for ${uncovered.length} function(s)...`, "info");
  const result = await generateTests(state.cwd, config.gaitDir(state.cwd), sourceFile, uncovered, testCmd, "claude",
    (line) => state.dashboard.addLog(`[testgen] ${line}`, "info"));
  if (result.passed) {
    state.dashboard.addLog(`Tests generated: ${result.testFile}`, "success");
    const doc = await vscode.workspace.openTextDocument(path.join(state.cwd, result.testFile));
    await vscode.window.showTextDocument(doc);
    memory.addPattern(config.gaitDir(state.cwd), "testing", `Generated tests for ${sourceFile}`, "learned");
  } else {
    state.dashboard.addLog(`Tests failed: ${result.error}`, "error");
    memory.addCorrection(config.gaitDir(state.cwd), `Test gen for ${sourceFile}`, result.error ?? "unknown", "autofix");
    vscode.window.showWarningMessage("Generated tests didn't pass. Reverted.");
  }
}

export async function cmdEditMemory() {
  const contextPath = path.join(config.gaitDir(state.cwd), "context.md");
  if (!state.cfg) return;
  const fs = await import("fs");
  if (!fs.existsSync(contextPath)) memory.createDefaults(config.gaitDir(state.cwd), state.cwd, state.cfg);
  const doc = await vscode.workspace.openTextDocument(contextPath);
  await vscode.window.showTextDocument(doc);
}

export async function cmdViewMemory() {
  const mem = memory.loadMemory(config.gaitDir(state.cwd));
  const ch = getOutputChannel("Gait: Memory"); ch.clear(); ch.appendLine(memory.formatMemory(mem)); ch.show(true);
}

export async function cmdCostSummary() {
  const budget = (state.cfg?.pipeline as any)?.daily_budget_usd ?? 0;
  const summary = state.costTracker.summary(budget);
  const ch = getOutputChannel("Gait: Costs"); ch.clear();
  ch.appendLine(`Today:      $${summary.today.toFixed(2)}${budget > 0 ? ` / $${budget.toFixed(2)} (${summary.budgetUsedPct}%)` : ""}`);
  ch.appendLine(`This week:  $${summary.thisWeek.toFixed(2)}`);
  ch.appendLine(`This month: $${summary.thisMonth.toFixed(2)}`);
  ch.appendLine(`Sessions:   ${summary.sessions}`);
  if (summary.overBudget) ch.appendLine("\nOVER BUDGET");
  ch.show(true);
}
