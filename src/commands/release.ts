import * as vscode from "vscode";
import * as git from "../core/git";
import * as releaseCore from "../core/release";
import * as prGenerator from "../core/pr-generator";
import { state } from "../state";
import { getOutputChannel, sendNotify } from "./helpers";
import { cmdGate } from "./gate";

export async function cmdRelease() {
  if (!state.cfg) return;
  const clean = await git.isClean(state.cwd);
  if (!clean) { vscode.window.showWarningMessage("Dirty tree — commit first."); return; }
  state.dashboard.addLog("Analyzing release...", "info");
  const info = await releaseCore.analyzeRelease(state.cwd);
  if (info.commitCount === 0) { vscode.window.showInformationMessage("No new commits."); return; }
  const ch = getOutputChannel("Gait: Release"); ch.clear();
  ch.appendLine(`Current: v${info.currentVersion}\nBump: ${info.bumpType}\nNext: v${info.nextVersion}\n\n${info.changelog}`); ch.show(true);
  state.dashboard.addLog("Running gate...", "info");
  const gateOk = await cmdGate();
  if (!gateOk) { vscode.window.showErrorMessage("Gate failed — release aborted."); return; }
  const action = await vscode.window.showInformationMessage(`Release v${info.nextVersion}?`, "Tag Only", "Tag + Push", "Cancel");
  if (!action || action === "Cancel") return;
  const result = await releaseCore.executeRelease(state.cwd, info.nextVersion, action === "Tag + Push");
  if (result.success) { state.dashboard.addLog(`Released v${info.nextVersion}`, "success"); sendNotify("release.tagged", `v${info.nextVersion}`, {}); }
  else vscode.window.showErrorMessage(`Release failed: ${result.error}`);
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
