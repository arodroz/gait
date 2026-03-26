import * as vscode from "vscode";
import * as path from "path";
import { installHooks, checkHooksInstalled } from "../agents/claude-hooks";
import { state } from "../state";

export async function cmdInstallClaudeHooks(extensionPath: string): Promise<void> {
  const bridgePath = path.join(extensionPath, "out", "hitlgate-bridge.js");
  const status = await checkHooksInstalled(state.cwd, bridgePath);

  if (status.installed && !status.stale) {
    vscode.window.showInformationMessage("HITL-Gate: Claude Code hooks are already installed and up to date.");
    return;
  }

  await installHooks(state.cwd, bridgePath);

  if (status.stale) {
    vscode.window.showInformationMessage("HITL-Gate: Claude Code hooks updated.");
  } else {
    vscode.window.showInformationMessage("HITL-Gate: Claude Code hooks installed. Claude Code will now route actions through HITL-Gate.");
  }

  state.dashboard.addLog("Claude Code hooks installed", "success");
}
