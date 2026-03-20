export interface StageResult {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  output: string;
  error: string;
  duration: number;
}

export interface LogEntry {
  time: string;
  message: string;
  level: "info" | "success" | "error" | "warn";
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface DashboardState {
  project: string;
  version: string;
  branch: string;
  stacks: string[];
  clean: boolean;
  stages: StageResult[];
  log: LogEntry[];
  files: FileChange[];
  pipelineRunning: boolean;
  lastGate?: { passed: boolean; duration: number };
  configuredStages: string[];
  agentRunning?: boolean;
  agentPaused?: boolean;
  agentKind?: string;
  agentPrompt?: string;
  agentTokens?: number;
  agentContextPct?: number;
  agentElapsed?: number;
  review?: {
    taskDesc: string;
    agentKind: string;
    duration: number;
    tokens: number;
    filesChanged: number;
    additions: number;
    deletions: number;
    gatePassed: boolean;
  };
  regressions?: string[];
  flakyTests?: string[];
  coverage?: { file: string; name: string }[];
  coverageStatus?: "running" | "done" | "error";
  coverageError?: string;
  commitGateOpen?: boolean;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function el(tag: string, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}
