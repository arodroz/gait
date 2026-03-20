import * as vscode from "vscode";
import * as config from "../core/config";
import * as git from "../core/git";
import * as monorepo from "../core/monorepo";
import * as scripts from "../core/scripts";
import { run } from "../core/runner";
import { HistoryLogger } from "../core/history";
import { notify, type NotifyConfig, type NotifyPayload } from "../core/notify";
import type { StageName } from "../core/pipeline";
import { state, getOutputChannel, cap } from "../state";

export { getOutputChannel, cap };

export function logHistory(kind: string, data: Record<string, unknown>) {
  try { new HistoryLogger(config.gaitDir(state.cwd)).log(kind as any, data); } catch { /* best-effort */ }
}

export function sendNotify(event: import("../core/notify").NotifyEvent, message: string, details?: Record<string, unknown>) {
  if (!state.cfg) return;
  const notifyCfg = (state.cfg as any).notifications as NotifyConfig | undefined;
  if (!notifyCfg) return;
  const payload: NotifyPayload = { event, project: state.cfg.project.name, branch: "", message, details };
  git.branch(state.cwd).then((b) => { payload.branch = b; }).catch(() => {}).finally(() => {
    notify(notifyCfg, payload).catch(() => {});
  });
}

export function getStageCommand(name: StageName): string {
  if (!state.cfg) return "";
  const keyMap: Record<string, keyof config.StackCommands> = {
    lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build",
  };
  for (const stack of Object.values(state.cfg.stacks)) {
    const key = keyMap[name];
    if (key && stack[key]) return stack[key];
  }
  return "";
}

export function getConfiguredStages(): string[] {
  if (!state.cfg) return [];
  const all: StageName[] = ["lint", "typecheck", "test", "build"];
  const keyMap: Record<string, keyof config.StackCommands> = {
    lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build",
  };
  const configured: string[] = [];
  for (const name of all) {
    for (const stack of Object.values(state.cfg.stacks)) {
      if (stack[keyMap[name]]) { configured.push(name); break; }
    }
  }
  return configured;
}

export async function getFirstChangedLine(filePath: string): Promise<number> {
  try {
    const result = await run("git", ["diff", "-U0", filePath], state.cwd, 10_000);
    const match = result.stdout.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch { return 0; }
}

export function loadConfig() {
  try {
    state.cfg = config.load(state.cwd);
    const stages = state.cfg.pipeline.stages as StageName[];
    state.statusBar.resetAll(stages);
    state.pipelineTree.reset(stages);
    scripts.listScripts && state.scriptsTree.update(
      scripts.listScripts(require("path").join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR)),
    );
    updateDashboardInfo();
  } catch (err) {
    vscode.window.showErrorMessage(`Gait: failed to load config: ${err}`);
  }
}

export async function updateDashboardInfo() {
  if (!state.cfg) return;
  const branchName = await git.branch(state.cwd).catch(() => "");
  const clean = await git.isClean(state.cwd).catch(() => true);
  const stacks = config.detectStacks(state.cwd);

  const workspaces = monorepo.detect(state.cwd);
  let wsData: { name: string; path: string; kind: string; affected: boolean }[] = [];
  if (workspaces.length > 1) {
    const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
    const affectedWs = monorepo.affected(workspaces, changedFiles);
    wsData = workspaces.map((ws) => ({
      name: ws.name, path: ws.path, kind: ws.kind,
      affected: affectedWs.some((a) => a.path === ws.path),
    }));
    state.dashboard.addLog(`Monorepo: ${workspaces.length} workspaces, ${affectedWs.length} affected`, "info");
  }

  const tagResult = await run("git", ["describe", "--tags", "--abbrev=0"], state.cwd, 5000).catch(() => null);
  const version = tagResult?.exitCode === 0 ? tagResult.stdout.trim().replace(/^v/, "") : "0.0.0";

  state.dashboard.updateState({
    project: state.cfg.project.name, version, branch: branchName,
    stacks, clean, configuredStages: getConfiguredStages(),
  });
  state.infoTree.update({ project: state.cfg.project.name, branch: branchName, stacks, clean, workspaces: wsData });
}

export async function refreshFiles() {
  try {
    const stats = await git.diffStat(state.cwd);
    state.dashboard.updateState({
      files: stats.map((s) => ({ path: s.path, additions: s.additions, deletions: s.deletions, status: "modified" })),
      clean: stats.length === 0,
    });
  } catch { /* ignore */ }
}
