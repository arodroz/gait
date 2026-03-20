import * as vscode from "vscode";
import * as config from "./core/config";
import { AgentRunner } from "./core/agent";
import { CostTracker } from "./core/cost-tracker";
import { StatusBarManager } from "./views/statusbar";
import { PipelineTreeProvider, ActionsTreeProvider, InfoTreeProvider, ScriptsTreeProvider } from "./views/sidebar";
import { DashboardPanel } from "./views/dashboard";
import type { PipelineResult } from "./core/pipeline";

/** Shared extension state — singleton initialized in activate() */
export const state = {
  cwd: "",
  cfg: undefined as config.Config | undefined,
  statusBar: undefined as unknown as StatusBarManager,
  pipelineTree: undefined as unknown as PipelineTreeProvider,
  actionsTree: undefined as unknown as ActionsTreeProvider,
  infoTree: undefined as unknown as InfoTreeProvider,
  scriptsTree: undefined as unknown as ScriptsTreeProvider,
  dashboard: undefined as unknown as DashboardPanel,
  agent: undefined as unknown as AgentRunner,
  costTracker: undefined as unknown as CostTracker,
  lastPipelineResult: undefined as PipelineResult | undefined,
  currentProfile: "default",
  diffPollInterval: undefined as NodeJS.Timeout | undefined,
  outputChannels: new Map<string, vscode.OutputChannel>(),
};

export function getOutputChannel(name: string): vscode.OutputChannel {
  let ch = state.outputChannels.get(name);
  if (!ch) { ch = vscode.window.createOutputChannel(name); state.outputChannels.set(name, ch); }
  return ch;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
