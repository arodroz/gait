import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import * as prereq from "../core/prereq";
import * as rollback from "../core/rollback";
import * as recover from "../core/recover";
import * as agentsmd from "../core/agentsmd";
import * as snapshot from "../core/snapshot";
import * as depAudit from "../core/dep-audit";
import * as workflow from "../core/workflow";
import * as memory from "../core/memory";
import { getProfile, listProfiles } from "../core/profiles";
import { state } from "../state";
import { logHistory, getOutputChannel, updateDashboardInfo } from "./helpers";
import { cmdGate } from "./gate";

export async function cmdOpenDashboard() {
  state.dashboard.open();
  await updateDashboardInfo();
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
  if (sim.canRevert) {
    const action = await vscode.window.showInformationMessage(`Revert "${picked.subject}"? ${sim.filesAffected} file(s)`, "Revert", "Cancel");
    if (action === "Revert") {
      const result = await rollback.applyRevert(state.cwd, picked.hash);
      if (result.success) { state.dashboard.addLog("Revert applied", "success"); logHistory("rollback", { commit: picked.hash }); }
      else vscode.window.showErrorMessage(`Failed: ${result.error}`);
    }
  } else { vscode.window.showWarningMessage("Revert would break tests."); state.dashboard.addLog("Revert aborted", "warn"); }
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
}

export async function cmdGenerateAgentsMd() {
  if (!state.cfg) return;
  fs.writeFileSync(path.join(state.cwd, "AGENTS.md"), agentsmd.generate(state.cfg, config.detectStacks(state.cwd)));
  const doc = await vscode.workspace.openTextDocument(path.join(state.cwd, "AGENTS.md"));
  await vscode.window.showTextDocument(doc);
}

export async function cmdSnapshot() {
  const snap = await snapshot.take(state.cwd, config.gaitDir(state.cwd));
  vscode.window.showInformationMessage(`Snapshot: ${snap.id}`);
}

export async function cmdRestoreSnapshot() {
  const snaps = snapshot.list(config.gaitDir(state.cwd));
  if (!snaps.length) { vscode.window.showInformationMessage("No snapshots."); return; }
  const picked = await vscode.window.showQuickPick(snaps.reverse().map((s) => ({ label: s.id, description: `${s.branch} @ ${s.commitHash.slice(0, 8)}`, snap: s })));
  if (!picked) return;
  if (await vscode.window.showWarningMessage(`Restore ${picked.label}?`, "Restore", "Cancel") !== "Restore") return;
  const result = await snapshot.restore(state.cwd, config.gaitDir(state.cwd), picked.snap.id);
  if (result.success) state.dashboard.addLog(`Restored`, "success");
  else vscode.window.showErrorMessage(`Failed: ${result.error}`);
}

export async function cmdSwitchProfile() {
  if (!state.cfg) return;
  const picked = await vscode.window.showQuickPick(
    listProfiles(state.cfg).map((p) => ({ label: p, description: getProfile(state.cfg!, p).stages.join(" → ") })),
    { placeHolder: `Current: ${state.currentProfile}` },
  );
  if (picked) { state.currentProfile = picked.label; state.dashboard.addLog(`Profile: ${picked.label}`, "info"); }
}

export async function cmdRunWorkflow() {
  const workflows = workflow.listWorkflows(config.gaitDir(state.cwd));
  if (!workflows.length) { vscode.window.showInformationMessage("No workflows."); return; }
  const picked = await vscode.window.showQuickPick(workflows.map((w) => ({ label: w.name, description: w.description, wf: w })));
  if (!picked) return;
  const task = await vscode.window.showInputBox({ prompt: "Task ({{task}})", placeHolder: "Add auth" });
  if (task === undefined) return;
  const snap = await snapshot.take(state.cwd, config.gaitDir(state.cwd));
  state.dashboard.addLog(`Workflow: ${picked.wf.name}`, "info");
  const progress = await workflow.runWorkflow(picked.wf, state.cwd, { task, memory: memory.buildPromptPrefix(config.gaitDir(state.cwd)) }, {
    onStepStart: (step, total, desc) => state.dashboard.addLog(`  ${step}/${total}: ${desc}`, "info"),
    onStepDone: (step, passed) => state.dashboard.addLog(`  ${step}: ${passed ? "ok" : "FAIL"}`, passed ? "success" : "error"),
    onAgentOutput: (line) => state.dashboard.addLog(`  [wf] ${line}`, "info"),
    runGate: (profile) => { if (profile) state.currentProfile = profile; return cmdGate(); },
  });
  if (progress.status !== "passed") {
    if (await vscode.window.showWarningMessage("Failed. Restore?", "Restore", "Keep") === "Restore")
      await snapshot.restore(state.cwd, config.gaitDir(state.cwd), snap.id);
  }
}

export async function cmdAuditDeps() {
  const stacks = config.detectStacks(state.cwd);
  const result = await depAudit.audit(state.cwd, stacks);
  if (!result.findings.length) { vscode.window.showInformationMessage("No vulnerabilities."); return; }
  const ch = getOutputChannel("Gait: Audit"); ch.clear(); ch.appendLine(depAudit.formatFindings(result.findings)); ch.show(true);
  if (depAudit.shouldBlock(result.findings, (state.cfg?.pipeline as any)?.audit?.block_severity ?? "high")) {
    if (await vscode.window.showErrorMessage(`${result.findings.length} vulnerability(ies)`, "Auto-fix", "Ignore") === "Auto-fix")
      await depAudit.autoFix(state.cwd, stacks);
  }
}
