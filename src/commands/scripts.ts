import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import * as scripts from "../core/scripts";
import * as scriptDetect from "../core/script-detect";
import { state } from "../state";
import { logHistory, getOutputChannel } from "./helpers";

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
  for (const { name, result } of results) {
    const dur = (result.duration / 1000).toFixed(1);
    state.dashboard.addLog(`  ${name} ${result.passed ? "passed" : "FAILED"} (${dur}s)`, result.passed ? "success" : "error");
  }
  const totalDur = results.reduce((s, r) => s + r.result.duration, 0);
  if (allPassed) vscode.window.showInformationMessage(`Script passed (${(totalDur / 1000).toFixed(1)}s)`);
  else vscode.window.showErrorMessage("Script failed");
  logHistory("stage_run", { script: picked.script.name, passed: allPassed });
}

export async function cmdListScripts() {
  const available = scripts.listScripts(path.join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR));
  if (!available.length) { vscode.window.showInformationMessage("No scripts."); return; }
  const ch = getOutputChannel("Gait: Scripts"); ch.clear();
  for (const s of available) {
    ch.appendLine(`${s.name}  ${s.description || ""}\n  timeout: ${s.timeout / 1000}s  expect: ${s.expect}${s.depends.length ? `  depends: ${s.depends.join(", ")}` : ""}\n`);
  }
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
