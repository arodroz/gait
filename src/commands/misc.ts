import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import * as git from "../core/git";
import * as prereq from "../core/prereq";
import * as rollback from "../core/rollback";
import * as release from "../core/release";
import * as recover from "../core/recover";
import * as agentsmd from "../core/agentsmd";
import * as scripts from "../core/scripts";
import * as scriptDetect from "../core/script-detect";
import * as snapshot from "../core/snapshot";
import * as depAudit from "../core/dep-audit";
import * as hookScripts from "../core/hook-scripts";
import * as workflow from "../core/workflow";
import * as memory from "../core/memory";
import * as prGenerator from "../core/pr-generator";
import { getProfile, listProfiles } from "../core/profiles";
import { state, cap } from "../state";
import { logHistory, sendNotify, getOutputChannel, updateDashboardInfo } from "./helpers";
import { cmdGate } from "./gate";

export async function cmdOpenDashboard() {
  state.dashboard.open();
  await updateDashboardInfo();
}

export async function cmdInstallHook() {
  const { installPreCommitHook } = await import("../core/hooks");
  const result = installPreCommitHook(state.cwd);
  vscode.window.showInformationMessage(`Gait: ${result.message}`);
}

export async function cmdRollback() {
  const commits = await rollback.recentCommits(state.cwd);
  if (!commits.length) { vscode.window.showInformationMessage("No commits."); return; }
  const picked = await vscode.window.showQuickPick(
    commits.map((c) => ({ label: c.hash.slice(0, 8), description: c.subject, detail: c.date, hash: c.hash, subject: c.subject })),
    { placeHolder: "Select commit to revert" },
  );
  if (!picked) return;
  let testCmd = ""; if (state.cfg) for (const s of Object.values(state.cfg.stacks)) { if (s.Test) { testCmd = s.Test; break; } }
  state.dashboard.addLog(`Simulating revert of ${picked.label}...`, "info");
  const sim = await rollback.simulateRollback(state.cwd, picked.hash, testCmd, (msg) => state.dashboard.addLog(`[rollback] ${msg}`, "info"));
  if (sim.error) { vscode.window.showErrorMessage(`Rollback: ${sim.error}`); return; }
  const detail = `${sim.filesAffected} file(s). Tests ${sim.testsPassed ? "PASS" : "FAIL"}.`;
  if (sim.canRevert) {
    const action = await vscode.window.showInformationMessage(`Revert "${picked.subject}"? ${detail}`, "Revert", "Cancel");
    if (action === "Revert") {
      const result = await rollback.applyRevert(state.cwd, picked.hash);
      if (result.success) { state.dashboard.addLog("Revert applied", "success"); logHistory("rollback", { commit: picked.hash }); }
      else vscode.window.showErrorMessage(`Revert failed: ${result.error}`);
    }
  } else {
    vscode.window.showWarningMessage(`Revert would break tests. ${detail}`);
    state.dashboard.addLog("Revert aborted — would cause failures", "warn");
  }
}

export async function cmdRelease() {
  if (!state.cfg) return;
  const clean = await git.isClean(state.cwd);
  if (!clean) { vscode.window.showWarningMessage("Dirty tree — commit first."); return; }
  state.dashboard.addLog("Analyzing release...", "info");
  const info = await release.analyzeRelease(state.cwd);
  if (info.commitCount === 0) { vscode.window.showInformationMessage("No new commits."); return; }
  const ch = getOutputChannel("Gait: Release"); ch.clear();
  ch.appendLine(`Current: v${info.currentVersion}\nBump: ${info.bumpType}\nNext: v${info.nextVersion}\n\n${info.changelog}`); ch.show(true);
  state.dashboard.addLog("Running gate...", "info");
  const gateOk = await cmdGate();
  if (!gateOk) { vscode.window.showErrorMessage("Gate failed — release aborted."); return; }
  const action = await vscode.window.showInformationMessage(`Release v${info.nextVersion}?`, "Tag Only", "Tag + Push", "Cancel");
  if (!action || action === "Cancel") return;
  const result = await release.executeRelease(state.cwd, info.nextVersion, action === "Tag + Push");
  if (result.success) { state.dashboard.addLog(`Released v${info.nextVersion}`, "success"); sendNotify("release.tagged", `v${info.nextVersion}`, {}); }
  else vscode.window.showErrorMessage(`Release failed: ${result.error}`);
}

export async function cmdRecover() {
  const items = await recover.recover(state.cwd, config.gaitDir(state.cwd));
  if (!items.length) { vscode.window.showInformationMessage("Nothing to recover."); return; }
  vscode.window.showInformationMessage(`Recovered ${items.filter((i) => i.cleaned).length}/${items.length} items.`);
}

export async function cmdPreflight() {
  const stacks = config.detectStacks(state.cwd);
  const results = await prereq.runDefaultChecks(stacks);
  const ch = getOutputChannel("Gait: Preflight"); ch.clear();
  for (const r of results) ch.appendLine(`${r.passed ? "✓" : "✗"} ${r.name}${r.error ? ` — ${r.error}` : ""}`);
  ch.show(true);
  vscode.window.showInformationMessage(results.every((r) => r.passed) ? "All prerequisites met." : "Some missing — see output.");
}

export async function cmdGenerateAgentsMd() {
  if (!state.cfg) return;
  const content = agentsmd.generate(state.cfg, config.detectStacks(state.cwd));
  fs.writeFileSync(path.join(state.cwd, "AGENTS.md"), content);
  const doc = await vscode.workspace.openTextDocument(path.join(state.cwd, "AGENTS.md"));
  await vscode.window.showTextDocument(doc);
  state.dashboard.addLog("Generated AGENTS.md", "success");
}

export async function cmdRunScript() {
  const scriptsDir = path.join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  const available = scripts.listScripts(scriptsDir);
  if (!available.length) { vscode.window.showInformationMessage("No scripts."); return; }
  const picked = await vscode.window.showQuickPick(
    available.map((s) => ({ label: s.name, description: s.description, detail: s.depends.length ? `depends: ${s.depends.join(", ")}` : undefined, script: s })),
    { placeHolder: "Select script" },
  );
  if (!picked) return;
  state.dashboard.addLog(`Running "${picked.script.name}" with deps...`, "info");
  const { results, allPassed } = await scripts.runWithDeps(picked.script, available, state.cwd, (name) => state.dashboard.addLog(`  dep: ${name}...`, "info"));
  for (const { name, result } of results) { const dur = (result.duration / 1000).toFixed(1); state.dashboard.addLog(`  ${name} ${result.passed ? "passed" : "FAILED"} (${dur}s)`, result.passed ? "success" : "error"); }
  const totalDur = results.reduce((s, r) => s + r.result.duration, 0);
  if (allPassed) vscode.window.showInformationMessage(`Script passed (${(totalDur / 1000).toFixed(1)}s)`);
  else vscode.window.showErrorMessage(`Script failed`);
  logHistory("stage_run", { script: picked.script.name, passed: allPassed });
}

export async function cmdListScripts() {
  const available = scripts.listScripts(path.join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR));
  if (!available.length) { vscode.window.showInformationMessage("No scripts."); return; }
  const ch = getOutputChannel("Gait: Scripts"); ch.clear();
  for (const s of available) { ch.appendLine(`${s.name}  ${s.description || ""}\n  timeout: ${s.timeout / 1000}s  expect: ${s.expect}${s.depends.length ? `  depends: ${s.depends.join(", ")}` : ""}\n`); }
  ch.show(true);
}

export async function cmdDetectScripts() {
  const scriptsDir = path.join(config.gaitDir(state.cwd), config.SCRIPTS_DIR);
  const patterns = scriptDetect.detectPatterns(config.gaitDir(state.cwd));
  if (!patterns.length) { vscode.window.showInformationMessage("No patterns yet."); return; }
  const novel = patterns.filter((p) => !scriptDetect.isAlreadyScripted(scriptsDir, p.command));
  if (!novel.length) { vscode.window.showInformationMessage("All patterns already scripted."); return; }
  const picked = await vscode.window.showQuickPick(novel.map((p) => ({ label: p.command, description: `${p.count}x`, pattern: p })), { placeHolder: "Save as script", canPickMany: true });
  if (!picked?.length) return;
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const item of picked) { const s = scriptDetect.suggestScript(item.pattern); fs.writeFileSync(path.join(scriptsDir, s.filename), s.content, { mode: 0o755 }); }
  vscode.window.showInformationMessage(`Created ${picked.length} script(s).`);
}

export async function cmdSnapshot() {
  const snap = await snapshot.take(state.cwd, config.gaitDir(state.cwd));
  state.dashboard.addLog(`Snapshot: ${snap.id}`, "success");
  vscode.window.showInformationMessage(`Snapshot: ${snap.id}`);
}

export async function cmdRestoreSnapshot() {
  const snaps = snapshot.list(config.gaitDir(state.cwd));
  if (!snaps.length) { vscode.window.showInformationMessage("No snapshots."); return; }
  const picked = await vscode.window.showQuickPick(snaps.reverse().map((s) => ({ label: s.id, description: `${s.branch} @ ${s.commitHash.slice(0, 8)}`, snap: s })), { placeHolder: "Restore snapshot" });
  if (!picked) return;
  const confirm = await vscode.window.showWarningMessage(`Restore ${picked.label}? Discards current changes.`, "Restore", "Cancel");
  if (confirm !== "Restore") return;
  const result = await snapshot.restore(state.cwd, config.gaitDir(state.cwd), picked.snap.id);
  if (result.success) state.dashboard.addLog(`Restored ${picked.snap.id}`, "success");
  else vscode.window.showErrorMessage(`Restore failed: ${result.error}`);
}

export async function cmdSwitchProfile() {
  if (!state.cfg) return;
  const profiles = listProfiles(state.cfg);
  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => { const pr = getProfile(state.cfg!, p); return { label: p, description: pr.stages.join(" → ") }; }),
    { placeHolder: `Current: ${state.currentProfile}` },
  );
  if (!picked) return;
  state.currentProfile = picked.label;
  state.dashboard.addLog(`Profile: ${state.currentProfile}`, "info");
}

export async function cmdCreatePR() {
  const branchName = await git.branch(state.cwd);
  if (branchName === "main" || branchName === "master") { vscode.window.showWarningMessage("Create a branch first."); return; }
  state.dashboard.addLog("Generating PR...", "info");
  const summary = await prGenerator.generate(state.cwd);
  if (summary.commits === 0) { vscode.window.showInformationMessage("No commits for PR."); return; }
  const ch = getOutputChannel("Gait: PR"); ch.clear(); ch.appendLine(`Title: ${summary.title}\n${summary.body}`); ch.show(true);
  const action = await vscode.window.showInformationMessage(`Create PR "${summary.title}"?`, "Create PR", "Edit Title", "Cancel");
  if (!action || action === "Cancel") return;
  let title = summary.title;
  if (action === "Edit Title") { const edited = await vscode.window.showInputBox({ value: title }); if (!edited) return; title = edited; }
  const result = await prGenerator.createPR(state.cwd, title, summary.body, summary.baseBranch);
  if (result.success) { state.dashboard.addLog(`PR: ${result.url}`, "success"); sendNotify("release.tagged", `PR: ${title}`, { url: result.url }); }
  else vscode.window.showErrorMessage(`PR failed: ${result.error}`);
}

export async function cmdRunWorkflow() {
  const workflows = workflow.listWorkflows(config.gaitDir(state.cwd));
  if (!workflows.length) { vscode.window.showInformationMessage("No workflows."); return; }
  const picked = await vscode.window.showQuickPick(workflows.map((w) => ({ label: w.name, description: w.description, detail: `${w.steps.length} steps`, wf: w })), { placeHolder: "Select workflow" });
  if (!picked) return;
  const taskInput = await vscode.window.showInputBox({ prompt: "Task ({{task}} variable)", placeHolder: "Add auth" });
  if (taskInput === undefined) return;
  const snap = await snapshot.take(state.cwd, config.gaitDir(state.cwd));
  state.dashboard.addLog(`Workflow: ${picked.wf.name} (snapshot: ${snap.id})`, "info");
  const progress = await workflow.runWorkflow(picked.wf, state.cwd, { task: taskInput, memory: memory.buildPromptPrefix(config.gaitDir(state.cwd)) }, {
    onStepStart: (step, total, desc) => state.dashboard.addLog(`  Step ${step}/${total}: ${desc}`, "info"),
    onStepDone: (step, passed) => state.dashboard.addLog(`  Step ${step}: ${passed ? "passed" : "FAILED"}`, passed ? "success" : "error"),
    onAgentOutput: (line) => state.dashboard.addLog(`  [wf] ${line}`, "info"),
    runGate: (profile) => { if (profile) state.currentProfile = profile; return cmdGate(); },
  });
  if (progress.status === "passed") { state.dashboard.addLog(`Workflow completed`, "success"); }
  else {
    const action = await vscode.window.showWarningMessage("Workflow failed. Restore?", "Restore", "Keep");
    if (action === "Restore") { await snapshot.restore(state.cwd, config.gaitDir(state.cwd), snap.id); state.dashboard.addLog("Restored", "info"); }
  }
}

export async function cmdAuditDeps() {
  const stacks = config.detectStacks(state.cwd);
  state.dashboard.addLog("Auditing dependencies...", "info");
  const result = await depAudit.audit(state.cwd, stacks);
  if (result.error) { state.dashboard.addLog(`Audit error: ${result.error}`, "error"); return; }
  if (!result.findings.length) { state.dashboard.addLog("No vulnerabilities", "success"); vscode.window.showInformationMessage("No vulnerabilities."); return; }
  const ch = getOutputChannel("Gait: Audit"); ch.clear(); ch.appendLine(depAudit.formatFindings(result.findings)); ch.show(true);
  const blockSev = (state.cfg?.pipeline as any)?.audit?.block_severity ?? "high";
  if (depAudit.shouldBlock(result.findings, blockSev)) {
    const action = await vscode.window.showErrorMessage(`${result.findings.length} vulnerability(ies)`, "Auto-fix", "Ignore");
    if (action === "Auto-fix") await depAudit.autoFix(state.cwd, stacks);
  }
}

export async function cmdInstallAllHooks() {
  const { results } = hookScripts.installAll(state.cwd);
  for (const r of results) state.dashboard.addLog(`${r.hook}: ${r.message}`, r.installed ? "success" : "warn");
  vscode.window.showInformationMessage(`Installed ${results.filter((r) => r.installed).length}/4 hooks.`);
}

export async function cmdManageHooks() {
  const st = hookScripts.status(state.cwd);
  const picked = await vscode.window.showQuickPick(
    st.map((s) => ({ label: s.hook, description: s.installed ? (s.managedByGait ? "gait" : "custom") : "not installed", picked: s.managedByGait, hookStatus: s })),
    { canPickMany: true, placeHolder: "Toggle hooks" },
  );
  if (!picked) return;
  const want = new Set(picked.map((p) => p.label));
  for (const s of st) {
    if (want.has(s.hook) && !s.managedByGait) { hookScripts.install(state.cwd, s.hook); state.dashboard.addLog(`Installed ${s.hook}`, "success"); }
    else if (!want.has(s.hook) && s.managedByGait) { hookScripts.uninstall(state.cwd, s.hook); state.dashboard.addLog(`Uninstalled ${s.hook}`, "info"); }
  }
}
