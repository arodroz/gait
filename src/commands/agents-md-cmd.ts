import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import { generate } from "../core/agentsmd";
import { ActionLogger } from "../core/action-logger";
import { state } from "../state";

export async function cmdGenerateAgentsMd(): Promise<void> {
  if (!state.cfg) {
    vscode.window.showWarningMessage("Run 'HITL-Gate: Initialize Project' first.");
    return;
  }

  const stacks = config.detectStacks(state.cwd);
  const logger = new ActionLogger(config.gaitDir(state.cwd));
  const recentActions = await logger.readRecent(50);
  const content = generate(state.cfg, stacks, recentActions);

  const filePath = path.join(state.cwd, "AGENTS.md");
  fs.writeFileSync(filePath, content);

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  state.dashboard.addLog("AGENTS.md generated", "success");
}
