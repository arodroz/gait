import * as vscode from "vscode";
import * as config from "../core/config";
import * as git from "../core/git";
import { run } from "../core/runner";
import { notify, type NotifyConfig, type NotifyPayload } from "../core/notify";
import { state, getOutputChannel, cap } from "../state";

export { getOutputChannel, cap };

export function sendNotify(event: import("../core/notify").NotifyEvent, message: string, details?: Record<string, unknown>) {
  if (!state.cfg) return;
  const notifyCfg = (state.cfg as any).notifications as NotifyConfig | undefined;
  if (!notifyCfg) return;
  const payload: NotifyPayload = { event, project: state.cfg.project.name, branch: "", message, details };
  git.branch(state.cwd).then((b) => { payload.branch = b; }).catch(() => {}).finally(() => {
    notify(notifyCfg, payload).catch(() => {});
  });
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
    state.statusBar.update(state.cfg.project.name, state.cfg.project.mode);
    state.agentsTree.update(state.cfg.agents.claude_enabled, state.cfg.agents.codex_enabled);
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

  const tagResult = await run("git", ["describe", "--tags", "--abbrev=0"], state.cwd, 5000).catch(() => null);
  const version = tagResult?.exitCode === 0 ? tagResult.stdout.trim().replace(/^v/, "") : "0.0.0";

  state.dashboard.updateState({
    project: state.cfg.project.name, version, branch: branchName,
    stacks, clean,
  });
  state.infoTree.update({
    project: state.cfg.project.name, branch: branchName, stacks, clean,
    mode: state.cfg.project.mode,
  });
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
