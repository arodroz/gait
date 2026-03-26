import * as vscode from "vscode";
import type { HitlConfig } from "./core/config";
import { AgentRunner } from "./core/agent";
import { CostTracker } from "./core/cost-tracker";
import { StatusBarManager } from "./views/statusbar";
import { ActionsTreeProvider, InfoTreeProvider, DecisionsTreeProvider, AgentsTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";

/** Shared extension state — singleton initialized in activate() */
export const state = {
  cwd: "",
  cfg: undefined as HitlConfig | undefined,
  statusBar: undefined as unknown as StatusBarManager,
  decisionsTree: undefined as unknown as DecisionsTreeProvider,
  actionsTree: undefined as unknown as ActionsTreeProvider,
  infoTree: undefined as unknown as InfoTreeProvider,
  agentsTree: undefined as unknown as AgentsTreeProvider,
  dashboard: undefined as unknown as DashboardPanel,
  agent: undefined as unknown as AgentRunner,
  costTracker: undefined as unknown as CostTracker,
  diffPollInterval: undefined as NodeJS.Timeout | undefined,
  outputChannels: new Map<string, vscode.OutputChannel>(),

  interceptorWatcher: undefined as vscode.Disposable | undefined,
};

export function getOutputChannel(name: string): vscode.OutputChannel {
  let ch = state.outputChannels.get(name);
  if (!ch) { ch = vscode.window.createOutputChannel(name); state.outputChannels.set(name, ch); }
  return ch;
}

