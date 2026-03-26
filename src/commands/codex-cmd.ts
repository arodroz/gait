import * as vscode from "vscode";
import * as config from "../core/config";
import { runCodexWithInterception } from "../agents/codex-bridge";
import { state } from "../state";

export async function cmdRunCodex(): Promise<void> {
  if (!state.cfg) {
    vscode.window.showWarningMessage("Run 'HITL-Gate: Initialize Project' first.");
    return;
  }

  if (!state.cfg.agents.codex_enabled) {
    const enable = await vscode.window.showWarningMessage(
      "Codex is not enabled in config. Enable it?",
      "Enable",
      "Cancel",
    );
    if (enable !== "Enable") return;
    // User should manually set codex_enabled = true in config
    vscode.window.showInformationMessage("Set `codex_enabled = true` in .gait/config.toml");
    return;
  }

  const task = await vscode.window.showInputBox({
    prompt: "What should Codex do?",
    placeHolder: "Implement the user authentication feature",
  });
  if (!task) return;

  state.dashboard.addLog(`Starting Codex: ${task.slice(0, 80)}...`, "info");
  state.dashboard.updateState({ agentRunning: true, agentKind: "codex", agentPrompt: task.slice(0, 80), agentPaused: false });

  try {
    const result = await runCodexWithInterception(
      task,
      state.cwd,
      config.gaitDir(state.cwd),
      (line) => state.dashboard.addLog(`[codex] ${line}`, "info"),
    );

    state.dashboard.addLog(`Codex finished (exit ${result.exitCode})`, result.exitCode === 0 ? "success" : "warn");
  } catch (err) {
    state.dashboard.addLog(`Codex error: ${err}`, "error");
  } finally {
    state.dashboard.updateState({ agentRunning: false, agentPaused: false });
  }
}
