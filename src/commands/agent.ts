import * as vscode from "vscode";
import * as path from "path";
import * as config from "../core/config";
import * as git from "../core/git";
import * as prereq from "../core/prereq";
import * as snapshot from "../core/snapshot";
import * as prompts from "../core/prompts";
import * as memory from "../core/memory";
import { getCurrentDiffs } from "../core/diff-watcher";
import { reviewDiff } from "../core/review";
import { state } from "../state";
import { getOutputChannel } from "./helpers";

export async function cmdRunAgent() {
  if (state.agent.running) {
    const action = await vscode.window.showQuickPick(["Pause", "Resume", "Kill"], { placeHolder: "Agent is running" });
    if (action === "Pause") state.agent.pause();
    else if (action === "Resume") state.agent.resume();
    else if (action === "Kill") state.agent.kill();
    return;
  }

  // Budget check
  const budgetLimit = state.cfg?.budget?.daily_limit_usd ?? 0;
  if (budgetLimit > 0 && !state.costTracker.canRun(budgetLimit)) {
    const override = await vscode.window.showWarningMessage(
      `Daily budget ($${budgetLimit}) exceeded. Continue anyway?`, "Continue", "Cancel",
    );
    if (override !== "Continue") return;
  }

  const available: string[] = [];
  if (state.cfg?.agents.claude_enabled && (await prereq.commandExists("claude")).passed) available.push("claude");
  if (state.cfg?.agents.codex_enabled && (await prereq.commandExists("codex")).passed) available.push("codex");
  if (!available.length) { vscode.window.showWarningMessage("No AI agents enabled or on PATH."); return; }

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

  // Snapshot (if enabled in config)
  const snap = state.cfg?.snapshots.auto_snapshot !== false
    ? await snapshot.take(state.cwd, config.gaitDir(state.cwd))
    : null;
  if (snap) state.dashboard.addLog(`Snapshot: ${snap.id}`, "info");

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
    await state.agent.start(kind as "claude" | "codex", fullPrompt, state.cwd);
  } catch (err) {
    if (state.diffPollInterval) { clearInterval(state.diffPollInterval); state.diffPollInterval = undefined; }
    state.dashboard.addLog(`Failed to start agent: ${err}`, "error");
    state.dashboard.updateState({ agentRunning: false });
  }
}

export async function cmdCodeReview() {
  if (!state.cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }
  state.dashboard.addLog("Running AI code review...", "info");
  const diff = await git.diff(state.cwd, true).catch(() => "") || await git.diff(state.cwd, false).catch(() => "");
  if (!diff) { vscode.window.showInformationMessage("No changes to review."); return; }
  const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
  const result = await reviewDiff(state.cwd, config.gaitDir(state.cwd), diff, changedFiles, "claude",
    (line) => state.dashboard.addLog(`[review] ${line}`, "info"));
  const dur = (result.duration / 1000).toFixed(1);
  if (result.findings.length === 0) { state.dashboard.addLog(`Review passed (${dur}s)`, "success"); vscode.window.showInformationMessage("No issues."); }
  else {
    const ch = getOutputChannel("Gait: Review"); ch.clear();
    for (const f of result.findings) { ch.appendLine(`[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.message}`); if (f.suggestion) ch.appendLine(`  Suggestion: ${f.suggestion}`); }
    ch.show(true);
    state.dashboard.addLog(`Review: ${result.findings.length} finding(s) (${dur}s)`, result.findings.some((f) => f.severity === "error") ? "error" : "warn");

    // Enhance findings with blame context for the most critical finding
    const errorFindings = result.findings.filter((f) => f.severity === "error");
    if (errorFindings.length > 0) {
      const { blameError } = await import("../core/blame");
      const errorText = errorFindings.map((f) => `${f.file}:${f.line}`).join("\n");
      const blame = await blameError(state.cwd, errorText);
      if (blame) {
        ch.appendLine(`\nRoot cause: commit ${blame.commitHash.slice(0, 8)} (${blame.author}, ${blame.date}): ${blame.summary}`);
      }
    }
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
  const summary = state.costTracker.summary(0);
  const ch = getOutputChannel("Gait: Costs"); ch.clear();
  ch.appendLine(`Today:      $${summary.today.toFixed(2)}`);
  ch.appendLine(`This week:  $${summary.thisWeek.toFixed(2)}`);
  ch.appendLine(`This month: $${summary.thisMonth.toFixed(2)}`);
  ch.appendLine(`Sessions:   ${summary.sessions}`);
  ch.show(true);
}
