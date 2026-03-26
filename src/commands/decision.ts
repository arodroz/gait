import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as config from "../core/config";
import { state } from "../state";

export async function cmdAccept(actionId: string): Promise<void> {
  await writeDecision(actionId, "accept");
  state.dashboard.addLog(`Accepted: ${actionId}`, "success");
}

export async function cmdReject(actionId: string, note?: string): Promise<void> {
  await writeDecision(actionId, "reject", note);
  state.dashboard.addLog(`Rejected: ${actionId}${note ? ` — ${note}` : ""}`, "warn");
}

export async function cmdEditPrompt(actionId: string): Promise<void> {
  const note = await vscode.window.showInputBox({
    prompt: "Add a note for the agent (included in rejection message)",
    placeHolder: "Scope changes to the new route only, do not modify existing middleware",
  });
  if (note === undefined) return;
  await writeDecision(actionId, "reject", note);
  state.dashboard.addLog(`Rejected with note: ${actionId}`, "warn");
}

async function writeDecision(id: string, decision: "accept" | "reject", note?: string): Promise<void> {
  const decisionsDir = path.join(config.gaitDir(state.cwd), "decisions");
  await fs.promises.mkdir(decisionsDir, { recursive: true });
  const filePath = path.join(decisionsDir, `${id}.json`);
  await fs.promises.writeFile(
    filePath,
    JSON.stringify({ id, decision, note, ts: new Date().toISOString() }, null, 2),
  );
}
