import * as vscode from "vscode";
import * as hookScripts from "../core/hook-scripts";
import { state } from "../state";

export async function cmdInstallHook() {
  const { installPreCommitHook } = await import("../core/hooks");
  const result = installPreCommitHook(state.cwd);
  vscode.window.showInformationMessage(`Gait: ${result.message}`);
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
