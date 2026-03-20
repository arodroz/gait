/** Webview app — renders the Gait dashboard inside VS Code */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface StageResult {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  output: string;
  error: string;
  duration: number;
}

interface LogEntry {
  time: string;
  message: string;
  level: "info" | "success" | "error" | "warn";
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

interface DashboardState {
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
  commitGateOpen?: boolean;
}

const STAGE_ICONS: Record<string, string> = {
  pending: "\u25CB",
  running: "\u25CC",
  passed: "\u2713",
  failed: "\u2717",
  skipped: "\u2013",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Safe DOM builders ---

function el(tag: string, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") e.className = v;
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function text(s: string): Text {
  return document.createTextNode(s);
}

function buildHeader(state: DashboardState): HTMLElement {
  const header = el("div", { className: "header" });
  header.appendChild(el("h1", {}, state.project));
  header.appendChild(el("span", { className: "version" }, `v${state.version}`));
  header.appendChild(el("span", { className: `status-dot ${state.clean ? "clean" : "dirty"}` }));
  header.appendChild(el("span", { className: "branch" }, state.branch));
  header.appendChild(el("span", { className: "spacer" }));
  for (const s of state.stacks) {
    header.appendChild(el("span", { className: "stack-badge" }, s));
  }
  return header;
}

function buildGateBanner(state: DashboardState): HTMLElement | null {
  if (!state.lastGate) return null;
  const cls = state.lastGate.passed ? "passed" : "failed";
  const icon = state.lastGate.passed ? "\u2713" : "\u2717";
  const label = state.lastGate.passed ? "GATE PASSED" : "GATE BLOCKED";
  const dur = (state.lastGate.duration / 1000).toFixed(1);
  return el("div", { className: `gate-banner ${cls}` }, `${icon} ${label} (${dur}s)`);
}

function buildStages(stages: StageResult[]): HTMLElement {
  const container = el("div", { className: "stages" });
  for (const s of stages) {
    const badge = el("div", { className: `stage-badge ${s.status}` });
    badge.appendChild(el("span", { className: "icon" }, STAGE_ICONS[s.status] ?? "\u25CB"));
    badge.appendChild(el("span", {}, capitalize(s.name)));
    if (s.duration > 0) {
      badge.appendChild(el("span", { className: "dur" }, `${(s.duration / 1000).toFixed(1)}s`));
    }

    if (s.status === "failed") {
      // Fix button (click = scoped fix, shift+click = auto-fix loop)
      const fixBtn = el("span", {
        style: "margin-left: 6px; cursor: pointer; font-size: 0.8em; padding: 1px 6px; border: 1px solid var(--error); border-radius: 3px; color: var(--error);",
        title: "Click to fix with agent. Shift+click for auto-fix loop.",
      }, "Fix");
      fixBtn.addEventListener("click", (e) => {
        if ((e as MouseEvent).shiftKey) {
          vscode.postMessage({ command: "autofixStage", data: s.name });
        } else {
          vscode.postMessage({ command: "fixStage", data: s.name });
        }
      });
      badge.appendChild(fixBtn);
    } else {
      badge.addEventListener("click", () => {
        vscode.postMessage({ command: "runStage", data: s.name });
      });
    }

    container.appendChild(badge);
  }
  return container;
}

function buildFiles(files: FileChange[]): HTMLElement | null {
  if (!files.length) return null;
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);

  const section = el("div", { className: "section" });
  section.appendChild(
    el("div", { className: "section-title" }, `Changed Files \u2014 ${files.length} files +${totalAdd} -${totalDel}`),
  );

  const list = el("div", { className: "file-list" });
  for (const f of files) {
    const row = el("div", { className: "file-row" });
    row.appendChild(el("span", { className: "file-path" }, f.path));
    row.appendChild(el("span", { className: "file-add" }, `+${f.additions}`));
    row.appendChild(el("span", { className: "file-del" }, `-${f.deletions}`));
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function buildLog(log: LogEntry[]): HTMLElement {
  const section = el("div", { className: "section" });
  section.appendChild(el("div", { className: "section-title" }, "Log"));

  const logDiv = el("div", { className: "log" });
  if (!log.length) {
    logDiv.appendChild(el("span", { className: "log-empty" }, "No events yet \u2014 press a button to start"));
  } else {
    const visible = log.slice(-50).reverse();
    for (const entry of visible) {
      const row = el("div", { className: "log-entry" });
      row.appendChild(el("span", { className: "log-time" }, entry.time));
      row.appendChild(el("span", { className: `log-msg ${entry.level}` }, entry.message));
      logDiv.appendChild(row);
    }
  }
  section.appendChild(logDiv);
  return section;
}

function buildActions(state: DashboardState): HTMLElement {
  const bar = el("div", { className: "actions" });

  const addBtn = (label: string, command: string, primary = false) => {
    const btn = el("button", { className: primary ? "btn" : "btn secondary" }, label);
    if (state.pipelineRunning) btn.setAttribute("disabled", "true");
    btn.addEventListener("click", () => vscode.postMessage({ command }));
    bar.appendChild(btn);
  };

  addBtn("\u229B Run Gate", "gate", true);
  const stages = state.configuredStages ?? [];
  if (stages.includes("lint")) addBtn("Lint", "lint");
  if (stages.includes("test")) addBtn("Test", "test");
  if (stages.includes("typecheck")) addBtn("Typecheck", "typecheck");
  if (stages.includes("build")) addBtn("Build", "build");

  // Agent controls
  if (state.agentRunning) {
    if (state.agentPaused) {
      addBtn("\u25B6 Resume", "resumeAgent");
    } else {
      addBtn("\u23F8 Pause", "pauseAgent");
    }
    addBtn("\u2717 Kill", "killAgent");
  } else {
    addBtn("\u2699 Agent", "runAgent");
  }

  addBtn("Rollback", "rollback");
  addBtn("Release", "release");
  return bar;
}

function buildAgentPanel(state: DashboardState): HTMLElement | null {
  if (!state.agentRunning && !state.agentKind) return null;

  const section = el("div", { className: "section" });
  section.appendChild(el("div", { className: "section-title" }, "Agent"));

  if (state.agentRunning) {
    const status = state.agentPaused ? "paused" : "running";
    const indicator = el("div", { className: "agent-status" },
      `\u25CF ${state.agentKind}  ${status}`);
    indicator.style.color = state.agentPaused ? "var(--warn)" : "var(--success)";
    indicator.style.fontWeight = "600";
    section.appendChild(indicator);

    // Token/context stats
    if (state.agentTokens || state.agentContextPct) {
      const pct = state.agentContextPct ?? 0;
      const filled = Math.round(pct / 10);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
      const elapsed = state.agentElapsed ? `${Math.round(state.agentElapsed / 1000)}s` : "";
      const tokens = state.agentTokens ? `~${(state.agentTokens / 1000).toFixed(1)}k tokens` : "";
      const statsLine = el("div", { style: "color: var(--muted); margin-top: 4px; font-family: var(--vscode-editor-font-family);" },
        `  ctx: ${pct}% ${bar}  ${tokens}  ${elapsed}`);
      section.appendChild(statsLine);
    }

    if (state.agentPrompt) {
      const prompt = el("div", { style: "color: var(--muted); margin-top: 4px; font-style: italic;" },
        `"${state.agentPrompt.length > 60 ? state.agentPrompt.slice(0, 60) + "..." : state.agentPrompt}"`);
      section.appendChild(prompt);
    }
  } else if (state.agentKind) {
    section.appendChild(el("div", { style: "color: var(--muted);" }, `\u25CB ${state.agentKind}  done`));
  }

  return section;
}

function buildRegressions(state: DashboardState): HTMLElement | null {
  if (!state.regressions?.length) return null;
  const section = el("div", { className: "section" });
  section.appendChild(el("div", { className: "section-title", style: "color: var(--error);" },
    `Regressions \u2014 ${state.regressions.length} test(s) now failing`));
  for (const name of state.regressions) {
    section.appendChild(el("div", { style: "color: var(--error); margin-left: 8px;" }, `\u2717 ${name}`));
  }
  if (state.flakyTests?.length) {
    section.appendChild(el("div", { style: "color: var(--warn); margin-top: 8px;" },
      `${state.flakyTests.length} flaky test(s) exempted`));
  }
  return section;
}

function buildReview(state: DashboardState): HTMLElement | null {
  if (!state.review) return null;
  const r = state.review;
  const section = el("div", { className: "section" });
  section.appendChild(el("div", { className: "section-title" }, "Post-Task Review"));

  const dur = (r.duration / 1000).toFixed(1);
  const tokens = r.tokens > 0 ? `${(r.tokens / 1000).toFixed(1)}k tokens` : "";
  section.appendChild(el("div", {}, `Task: "${r.taskDesc}"`));
  section.appendChild(el("div", { style: "color: var(--muted);" },
    `Agent: ${r.agentKind}  Duration: ${dur}s  ${tokens}`));
  section.appendChild(el("div", { style: "margin-top: 4px;" },
    `Changes: ${r.filesChanged} file(s)  +${r.additions} -${r.deletions}`));

  const gateEl = el("div", { style: `margin-top: 4px; font-weight: 600; color: var(--${r.gatePassed ? "success" : "error"});` },
    `Gate: ${r.gatePassed ? "\u2713 PASSED" : "\u2717 FAILED"}`);
  section.appendChild(gateEl);

  return section;
}

function renderToDOM(container: HTMLElement, state: DashboardState): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  container.appendChild(buildHeader(state));

  const banner = buildGateBanner(state);
  if (banner) container.appendChild(banner);

  const regressions = buildRegressions(state);
  if (regressions) container.appendChild(regressions);

  if (state.stages.length) container.appendChild(buildStages(state.stages));

  const agentPanel = buildAgentPanel(state);
  if (agentPanel) container.appendChild(agentPanel);

  const review = buildReview(state);
  if (review) container.appendChild(review);

  const files = buildFiles(state.files);
  if (files) container.appendChild(files);

  container.appendChild(buildLog(state.log));
  container.appendChild(buildActions(state));

  // Commit gate modal overlay
  const modal = buildCommitGateModal(state);
  if (modal) container.appendChild(modal);
}

function buildCommitGateModal(state: DashboardState): HTMLElement | null {
  if (!state.commitGateOpen || !state.lastGate) return null;

  const overlay = el("div", { className: "modal-overlay" });
  const modal = el("div", { className: "modal" });
  overlay.appendChild(modal);

  modal.appendChild(el("h2", {}, "\u229B Commit Gate"));

  // Stage results
  for (const s of state.stages) {
    const row = el("div", { className: "stage-row" });
    const icons: Record<string, string> = { passed: "\u2713", failed: "\u2717", skipped: "\u2013", running: "\u25CC", pending: "\u25CB" };
    const colors: Record<string, string> = { passed: "var(--success)", failed: "var(--error)", skipped: "var(--muted)", running: "var(--warn)", pending: "var(--muted)" };
    const icon = el("span", { className: "icon" }, icons[s.status] ?? "\u25CB");
    icon.style.color = colors[s.status] ?? "";
    row.appendChild(icon);
    row.appendChild(el("span", {}, capitalize(s.name)));
    if (s.duration > 0) {
      row.appendChild(el("span", { className: "dur" }, `${(s.duration / 1000).toFixed(1)}s`));
    }
    modal.appendChild(row);
  }

  // Result banner
  const passed = state.lastGate.passed;
  const dur = (state.lastGate.duration / 1000).toFixed(1);
  const resultDiv = el("div", { className: `modal-result ${passed ? "passed" : "failed"}` },
    `${passed ? "\u2713 PASSED" : "\u2717 BLOCKED"} (${dur}s)`);
  modal.appendChild(resultDiv);

  // Action buttons
  const actions = el("div", { className: "modal-actions" });
  if (passed) {
    const commitBtn = el("button", { className: "btn" }, "Commit");
    commitBtn.addEventListener("click", () => vscode.postMessage({ command: "commitGateApprove" }));
    actions.appendChild(commitBtn);
  }
  const cancelBtn = el("button", { className: "btn secondary" }, passed ? "Cancel" : "Close");
  cancelBtn.addEventListener("click", () => vscode.postMessage({ command: "commitGateClose" }));
  actions.appendChild(cancelBtn);
  modal.appendChild(actions);

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) vscode.postMessage({ command: "commitGateClose" });
  });

  return overlay;
}

// --- Message handler ---
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "state") {
    const app = document.getElementById("app");
    if (app) renderToDOM(app, msg.data);
  }
});

// Initial loading state
const appEl = document.getElementById("app");
if (appEl) {
  appEl.appendChild(el("div", { className: "log-empty", style: "padding: 40px; text-align: center;" }, "Loading..."));
}
